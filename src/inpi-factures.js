#!/usr/bin/env node
/**
 * factures-inpi — Récupération automatique des factures INPI
 * pour les cabinets d'expertise comptable (et toute entreprise
 * disposant d'un compte client INPI).
 *
 * Site : Extranet Compte Client INPI (https://compte-client.inpi.fr/ExtranetCCL)
 *
 * Fonctionnement :
 * - Connexion par le formulaire (j_username / j_password du .env)
 * - La page d'accueil est le relevé de compte client ; chaque opération
 *   (paiement de commande, remboursement) a un bouton « duplicata » qui
 *   télécharge le justificatif PDF
 * - Le robot sélectionne « Tout » + période large, clique chaque
 *   « duplicata » non encore récupéré, et renomme le PDF d'après les
 *   informations de la ligne (date, n° commande, RéfClient, montant)
 * - Un index local (data/telechargees.json) évite les doublons :
 *   chaque exécution ne télécharge que les nouvelles opérations
 *
 * Usage :
 *   node src/inpi-factures.js            → headless (tâche planifiée)
 *   node src/inpi-factures.js --login    → fenêtre visible (mise au point)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });

const { chromium } = require('playwright');

// ---------------------------------------------------------------- config ---
const HEADFUL = process.argv.includes('--login') || process.argv.includes('--visible');
const BASE_URL = (process.env.INPI_BASE_URL || 'https://compte-client.inpi.fr/ExtranetCCL').replace(/\/+$/, '');
const LOGIN_URL = `${BASE_URL}/login.jsp`;
const FROM_DATE = process.env.INPI_FROM_DATE || '01/01/2010'; // début de période pour « Tout »

const OUT_DIR = process.env.DOWNLOAD_DIR || path.join(os.homedir(), 'Documents', 'Factures INPI');
const PATTERN = process.env.FILENAME_PATTERN || '{date} - INPI - {type} {numero} - {refclient}.pdf';

const DATA_DIR = path.join(ROOT, 'data');
const LOG_DIR = path.join(ROOT, 'logs');
const INDEX_FILE = path.join(DATA_DIR, 'telechargees.json');

for (const d of [DATA_DIR, LOG_DIR, OUT_DIR]) fs.mkdirSync(d, { recursive: true });

// ------------------------------------------------------------------- log ---
const today = new Date().toISOString().slice(0, 10);
const logFile = path.join(LOG_DIR, `inpi-${today}.log`);
function log(msg) {
  const line = `[${new Date().toLocaleString('fr-FR')}] ${msg}`;
  console.log(line);
  fs.appendFileSync(logFile, line + '\n');
}

// ----------------------------------------------------------------- index ---
function loadIndex() {
  try { return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')); } catch { return {}; }
}
function saveIndex(idx) {
  fs.writeFileSync(INDEX_FILE, JSON.stringify(idx, null, 2));
}

// ------------------------------------------------------------ utilitaires ---
function sanitize(name) {
  return name.replace(/[\\/:*?"<>|\r\n]+/g, '-').replace(/\s+/g, ' ').trim();
}

function frDateToIso(d) {
  const m = /(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/.exec(d || '');
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/**
 * Analyse le texte d'une ligne du relevé, p.ex. :
 *  "05/06/2026 Paiement commande N° 19581400 (GU_33955096) RéfClient DUPONT 05/06/2026 72,61 duplicata"
 *  "09/06/2026 Approvisionnement (Rembt 7771698 CDE 19102258 Formalité J00240823682 RéfClient DUPONT) 09/06/2026 1,78 duplicata"
 */
function parseRow(row) {
  const date = frDateToIso(row);
  const commande = (/(?:CDE|N°)\s*(\d{4,})/i.exec(row) || [])[1];
  const rembt = (/Rembt\s*(\d{4,})/i.exec(row) || [])[1];
  const gu = (/\(GU[_-]?([A-Z0-9_]+)\)/i.exec(row) || [])[1];
  const refclient = ((/R[ée]f\s*Client\s+(.+?)\s*(?:\)|\d{2}\/\d{2}\/\d{4})/i.exec(row) || [])[1] || '').trim();
  const montant = ((/(\d[\d\s ]*,\d{2})\s*duplicata/i.exec(row) || [])[1] || '').replace(/[\s ]/g, '');
  const type = /approvisionnement|rembt|rembours/i.test(row) ? 'Remboursement'
    : /paiement/i.test(row) ? 'Facture'
    : 'Document';

  const numero = commande || rembt || gu || '';
  // Clé unique : l'id le plus spécifique + date + montant
  const key = ['INPI', type, rembt || gu || numero, date, montant].filter(Boolean).join('|') || row.slice(0, 100);
  return { date, numero, refclient, montant, type, key };
}

function buildFileName(meta) {
  const base = PATTERN
    .replace('{date}', meta.date || today)
    .replace('{numero}', meta.numero || 'sans-numero')
    .replace('{refclient}', meta.refclient || '')
    .replace('{type}', meta.type || 'Document')
    .replace('{montant}', meta.montant ? `${meta.montant}€` : '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s*-\s*(?=\.pdf$)/i, ''); // tiret orphelin si refclient vide
  let name = sanitize(base);
  if (!/\.pdf$/i.test(name)) name += '.pdf';
  return name;
}

// -------------------------------------------------------------- connexion ---
async function isOnLoginPage(page) {
  if (/login\.jsp/i.test(page.url())) return true;
  return page.locator('#j_username').first().isVisible().catch(() => false);
}

async function login(page) {
  const user = process.env.INPI_USERNAME;
  const pass = process.env.INPI_PASSWORD;
  if (!user || !pass) {
    throw new Error('Renseignez INPI_USERNAME et INPI_PASSWORD dans le fichier .env (voir .env.example).');
  }

  log('Connexion à l’extranet compte client INPI…');
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.fill('#j_username', user);
  await page.fill('#j_password', pass);
  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    page.click('#connect'),
  ]);
  await page.waitForTimeout(2500);

  if (await isOnLoginPage(page)) {
    throw new Error('Échec de la connexion (identifiants refusés). Vérifiez INPI_USERNAME / INPI_PASSWORD dans le .env.');
  }
  log('Connexion réussie.');
}

// ------------------------------------------------- collecte des factures ---
// Sélectionne « Tout » + période large puis relance la recherche
async function showAllOperations(page) {
  const radios = page.locator('input[type=radio]');
  if (await radios.count() >= 2) {
    await radios.nth(1).check().catch(() => {}); // 0=7 dernières opérations, 1=Tout
    await page.waitForTimeout(1500);
  }
  // Champ « Période du » : premier input texte au format date
  const dateInputs = page.locator('input[type=text]');
  const n = await dateInputs.count();
  for (let i = 0; i < n; i++) {
    const el = dateInputs.nth(i);
    const val = await el.inputValue().catch(() => '');
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(val)) {
      const editable = await el.isEditable().catch(() => false);
      if (editable) await el.fill(FROM_DATE).catch(() => {});
      break; // seul le 1er champ (début de période) nous intéresse
    }
  }
  const search = page.locator('button:has-text("Rechercher")').first();
  if (await search.isVisible().catch(() => false)) {
    await search.click().catch(() => {});
    await page.waitForTimeout(3500);
  }
  const count = await page.locator('text=/Nombre d.op[ée]rations\\s*:\\s*\\d+/i').first().innerText().catch(() => '');
  if (count) log(count.trim());
}

async function closeStrayPages(context, mainPage) {
  for (const p of context.pages()) {
    if (p !== mainPage) await p.close().catch(() => {});
  }
}

async function downloadAll(page, context) {
  const index = loadIndex();
  let downloaded = 0;
  let skipped = 0;
  let pageNum = 1;

  await showAllOperations(page);

  while (true) {
    const dups = page.locator('button:has-text("duplicata"), a:has-text("duplicata")');
    const n = await dups.count();
    log(`Page ${pageNum} : ${n} opération(s) avec duplicata.`);

    for (let i = 0; i < n; i++) {
      const el = dups.nth(i);
      const row = await el.evaluate((node) => {
        const r = node.closest('tr');
        return r ? r.innerText.replace(/\s+/g, ' ').trim() : '';
      }).catch(() => '');
      const meta = parseRow(row);

      if (index[meta.key]) { skipped++; continue; }

      let download;
      try {
        [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 30000 }),
          el.click(),
        ]);
      } catch (e) {
        log(`  Duplicata ligne ${i + 1} ignoré (${e.message.split('\n')[0]})`);
        await closeStrayPages(context, page);
        continue;
      }

      const tmp = path.join(os.tmpdir(), `inpi-${Date.now()}-${i}.pdf`);
      await download.saveAs(tmp);
      await closeStrayPages(context, page); // le téléchargement passe par un popup

      let fileName = buildFileName(meta);
      let target = path.join(OUT_DIR, fileName);
      let k = 2;
      while (fs.existsSync(target)) {
        target = path.join(OUT_DIR, fileName.replace(/\.pdf$/i, ` (${k}).pdf`));
        k++;
      }
      fs.copyFileSync(tmp, target);
      fs.unlinkSync(tmp);

      index[meta.key] = {
        fichier: path.basename(target),
        date: meta.date,
        numero: meta.numero,
        refclient: meta.refclient,
        montant: meta.montant,
        type: meta.type,
        recupereLe: new Date().toISOString(),
      };
      saveIndex(index);
      downloaded++;
      log(`  ✔ ${path.basename(target)}`);
    }

    // Pagination éventuelle (relevés longs)
    const next = page
      .locator('a:has-text("Suivant"), button:has-text("Suivant"), a:has-text(">>"), button:has-text(">>"), a[title*="suivant" i], button[title*="suivant" i]')
      .first();
    const canNext = await next.isVisible().catch(() => false) && await next.isEnabled().catch(() => true);
    if (!canNext || pageNum >= 1000) break;
    await next.click().catch(() => {});
    await page.waitForTimeout(3000);
    pageNum++;
  }

  if (skipped) log(`${skipped} duplicata déjà récupéré(s) lors d'exécutions précédentes.`);
  if (!downloaded && !skipped) {
    await page.screenshot({ path: path.join(LOG_DIR, `aucune-facture-${Date.now()}.png`), fullPage: true }).catch(() => {});
    log('Aucun duplicata trouvé — capture d’écran enregistrée dans logs\\ pour diagnostic.');
  }
  return downloaded;
}

// ------------------------------------------------------------------ main ---
(async () => {
  log(`=== Récupération des factures INPI (${HEADFUL ? 'fenêtre visible' : 'headless'}) ===`);
  log(`Site : ${BASE_URL} — destination : ${OUT_DIR}`);

  const browser = await chromium.launch({ headless: !HEADFUL });
  const context = await browser.newContext({ acceptDownloads: true, locale: 'fr-FR' });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);

  try {
    await login(page);
    const n = await downloadAll(page, context);
    log(`=== Terminé : ${n} nouvelle(s) facture(s) téléchargée(s) dans ${OUT_DIR} ===`);
  } catch (e) {
    log(`ERREUR : ${e.message}`);
    await page.screenshot({ path: path.join(LOG_DIR, `erreur-${Date.now()}.png`), fullPage: true }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
