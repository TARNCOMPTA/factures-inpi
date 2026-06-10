#!/usr/bin/env node
/**
 * factures-inpi — Interface graphique locale
 *
 * Petit serveur web sans dépendance (module http de Node) qui s'ouvre
 * dans le navigateur : configuration du .env, lancement de la
 * récupération avec suivi des logs en direct, création de la tâche
 * planifiée Windows, accès au dossier des factures.
 *
 * Usage : node src/interface.js   (ou double-clic sur interface.cmd)
 * L'interface n'écoute que sur 127.0.0.1 — rien n'est exposé au réseau.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execFile } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ENV_FILE = path.join(ROOT, '.env');
const ENV_EXAMPLE = path.join(ROOT, '.env.example');
const SCRIPT = path.join(ROOT, 'src', 'inpi-factures.js');
const RUN_CMD = path.join(ROOT, 'run.cmd');
const PORT = Number(process.env.INTERFACE_PORT || 3939);
const TASK_NAME = 'Factures INPI';

// ------------------------------------------------------------- état .env ---
const ENV_KEYS = ['INPI_USERNAME', 'INPI_PASSWORD', 'DOWNLOAD_DIR', 'FILENAME_PATTERN', 'INPI_FROM_DATE'];

function readEnv() {
  let text = '';
  if (fs.existsSync(ENV_FILE)) text = fs.readFileSync(ENV_FILE, 'utf8');
  else if (fs.existsSync(ENV_EXAMPLE)) text = fs.readFileSync(ENV_EXAMPLE, 'utf8');
  const map = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z_]+)\s*=(.*)$/.exec(line);
    if (m) map[m[1]] = m[2].trim();
  }
  return map;
}

// Met à jour les clés connues en préservant le reste du fichier (commentaires…)
function writeEnv(updates) {
  let lines = [];
  if (fs.existsSync(ENV_FILE)) lines = fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/);
  else if (fs.existsSync(ENV_EXAMPLE)) lines = fs.readFileSync(ENV_EXAMPLE, 'utf8').split(/\r?\n/);

  for (const key of ENV_KEYS) {
    if (!(key in updates)) continue;
    const value = String(updates[key] || '').trim();
    let found = false;
    lines = lines.map((line) => {
      const m = new RegExp('^\\s*#?\\s*(' + key + ')\\s*=').exec(line);
      if (m && !found) { found = true; return key + '=' + value; }
      return line;
    });
    if (!found) lines.push(key + '=' + value);
  }
  fs.writeFileSync(ENV_FILE, lines.join('\n'));
}

function outDir() {
  const env = readEnv();
  return env.DOWNLOAD_DIR || path.join(os.homedir(), 'Documents', 'Factures INPI');
}

// --------------------------------------------------------- exécution robot ---
let child = null;
let logBuffer = [];
let lastExit = null;

function pushLog(chunk) {
  for (const line of chunk.toString('utf8').split(/\r?\n/)) {
    if (line.trim()) logBuffer.push(line);
  }
  if (logBuffer.length > 500) logBuffer = logBuffer.slice(-500);
}

function startRun(visible) {
  if (child) return false;
  logBuffer = [];
  lastExit = null;
  const args = [SCRIPT];
  if (visible) args.push('--login');
  child = spawn(process.execPath, args, { cwd: ROOT, windowsHide: true });
  child.stdout.on('data', pushLog);
  child.stderr.on('data', pushLog);
  child.on('exit', (code) => {
    lastExit = code;
    child = null;
    pushLog(Buffer.from(code === 0 ? '[interface] Exécution terminée.' : `[interface] Exécution terminée avec le code ${code}.`));
  });
  return true;
}

function stopRun() {
  if (!child) return false;
  try { execFile('taskkill', ['/pid', String(child.pid), '/t', '/f']); } catch { child.kill(); }
  return true;
}

// ------------------------------------------------------------ tâche Windows ---
function scheduleQuery(cb) {
  execFile('schtasks', ['/query', '/tn', TASK_NAME, '/fo', 'list'], { windowsHide: true }, (err, stdout) => {
    if (err) return cb(null);
    // « exécution » peut arriver mal encodé (console OEM) → motif tolérant
    const next = /(?:Proch\S+\s+ex\S+cution|Next Run Time)\s*:\s*(\d.+)/i.exec(stdout);
    cb(next ? next[1].trim() : 'programmée');
  });
}

function scheduleCreate(day, time, cb) {
  const days = { MON: 'MON', TUE: 'TUE', WED: 'WED', THU: 'THU', FRI: 'FRI', SAT: 'SAT', SUN: 'SUN' };
  const args = ['/create', '/tn', TASK_NAME, '/tr', '"' + RUN_CMD + '"', '/st', time, '/f'];
  if (day === 'DAILY') args.push('/sc', 'daily');
  else args.push('/sc', 'weekly', '/d', days[day] || 'MON');
  execFile('schtasks', args, { windowsHide: true }, (err, stdout, stderr) => cb(err ? (stderr || err.message) : null));
}

// --------------------------------------------------------------- statut ---
function pdfStats() {
  try {
    const dir = outDir();
    const files = fs.readdirSync(dir).filter((f) => /\.pdf$/i.test(f));
    return { count: files.length, dir };
  } catch {
    return { count: 0, dir: outDir() };
  }
}

// ------------------------------------------------------------------ HTML ---
const PAGE = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Factures INPI</title>
<style>
  :root { --bleu: #006a8e; --bleu2: #0090b8; --fond: #f2f5f7; --ok: #1e8a4c; --err: #c0392b; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", system-ui, sans-serif; margin: 0; background: var(--fond); color: #233; }
  header { background: var(--bleu); color: #fff; padding: 18px 28px; }
  header h1 { margin: 0; font-size: 22px; font-weight: 600; }
  header p { margin: 4px 0 0; opacity: .85; font-size: 13px; }
  main { max-width: 980px; margin: 24px auto; padding: 0 16px; display: grid; gap: 18px; }
  .card { background: #fff; border-radius: 10px; padding: 20px 24px; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
  .card h2 { margin: 0 0 14px; font-size: 16px; color: var(--bleu); }
  .row { display: flex; gap: 16px; flex-wrap: wrap; align-items: center; }
  .stat { font-size: 32px; font-weight: 700; color: var(--bleu); }
  .stat small { display: block; font-size: 12px; font-weight: 400; color: #678; }
  label { display: block; font-size: 13px; margin: 10px 0 4px; color: #456; }
  input, select { width: 100%; padding: 8px 10px; border: 1px solid #cdd6dc; border-radius: 6px; font-size: 14px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 18px; }
  button { background: var(--bleu); color: #fff; border: 0; border-radius: 6px; padding: 10px 18px; font-size: 14px; cursor: pointer; }
  button:hover { background: var(--bleu2); }
  button.sec { background: #e4ebef; color: #234; }
  button.sec:hover { background: #d4dee4; }
  button.danger { background: var(--err); }
  button:disabled { opacity: .5; cursor: default; }
  #log { background: #10222b; color: #cfe8d8; font-family: Consolas, monospace; font-size: 12px;
         border-radius: 8px; padding: 12px; height: 260px; overflow-y: auto; white-space: pre-wrap; }
  .badge { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; }
  .badge.run { background: #fff3cd; color: #8a6d00; }
  .badge.idle { background: #e2f0e8; color: var(--ok); }
  .msg { font-size: 13px; margin-left: 10px; }
  .msg.ok { color: var(--ok); } .msg.err { color: var(--err); }
</style>
</head>
<body>
<header>
  <h1>🧾 Factures INPI</h1>
  <p>Récupération et renommage automatiques des factures du compte client INPI</p>
</header>
<main>

  <div class="card">
    <div class="row" style="justify-content: space-between;">
      <div class="stat"><span id="count">…</span><small id="dir"></small></div>
      <div>
        <span id="state" class="badge idle">inactif</span>
        <button class="sec" onclick="openFolder()">📂 Ouvrir le dossier</button>
      </div>
    </div>
  </div>

  <div class="card">
    <h2>Configuration</h2>
    <div class="grid2">
      <div>
        <label>N° de compte / identifiant INPI</label>
        <input id="INPI_USERNAME" autocomplete="off">
      </div>
      <div>
        <label>Mot de passe</label>
        <input id="INPI_PASSWORD" type="password" autocomplete="off">
      </div>
    </div>
    <label>Dossier de destination des factures</label>
    <input id="DOWNLOAD_DIR" placeholder="Documents\\Factures INPI (par défaut)">
    <div class="grid2">
      <div>
        <label>Modèle de nom de fichier</label>
        <input id="FILENAME_PATTERN" placeholder="{date} - INPI - {type} {numero} - {refclient}.pdf">
      </div>
      <div>
        <label>Récupérer l'historique depuis (JJ/MM/AAAA)</label>
        <input id="INPI_FROM_DATE" placeholder="01/01/2010">
      </div>
    </div>
    <p style="font-size:12px;color:#678">Variables du modèle : {date} {numero} {refclient} {type} {montant} — les identifiants restent sur ce poste (fichier .env local).</p>
    <div class="row">
      <button onclick="saveConfig()">💾 Enregistrer</button>
      <span id="cfgmsg" class="msg"></span>
    </div>
  </div>

  <div class="card">
    <h2>Récupération</h2>
    <div class="row">
      <button id="btnRun" onclick="run(false)">▶ Lancer maintenant</button>
      <button id="btnRunV" class="sec" onclick="run(true)">🖥 Lancer avec navigateur visible</button>
      <button id="btnStop" class="danger" onclick="stop()" disabled>■ Arrêter</button>
      <span id="runmsg" class="msg"></span>
    </div>
    <div id="log" style="margin-top:14px">Aucune exécution en cours.</div>
  </div>

  <div class="card">
    <h2>Automatisation</h2>
    <div class="row">
      <div style="min-width:160px">
        <label>Fréquence</label>
        <select id="schedDay">
          <option value="MON">Chaque lundi</option>
          <option value="TUE">Chaque mardi</option>
          <option value="WED">Chaque mercredi</option>
          <option value="THU">Chaque jeudi</option>
          <option value="FRI">Chaque vendredi</option>
          <option value="DAILY">Tous les jours</option>
        </select>
      </div>
      <div style="min-width:110px">
        <label>Heure</label>
        <input id="schedTime" type="time" value="09:00">
      </div>
      <div style="align-self:flex-end">
        <button onclick="schedule()">⏰ Planifier</button>
      </div>
      <span id="schedmsg" class="msg" style="align-self:flex-end"></span>
    </div>
    <p id="schedinfo" style="font-size:13px;color:#678"></p>
  </div>

</main>
<script>
function $(id) { return document.getElementById(id); }
var KEYS = ['INPI_USERNAME','INPI_PASSWORD','DOWNLOAD_DIR','FILENAME_PATTERN','INPI_FROM_DATE'];

function api(url, opts) {
  return fetch(url, opts).then(function (r) { return r.json(); });
}

function loadConfig() {
  api('/api/config').then(function (cfg) {
    KEYS.forEach(function (k) { $(k).value = cfg[k] || ''; });
  });
}

function saveConfig() {
  var body = {};
  KEYS.forEach(function (k) { body[k] = $(k).value; });
  api('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(function () { flash('cfgmsg', 'Enregistré ✓', true); })
    .catch(function () { flash('cfgmsg', 'Erreur d\\'enregistrement', false); });
}

function run(visible) {
  api('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visible: visible }) })
    .then(function (r) {
      if (!r.ok) flash('runmsg', r.error || 'Déjà en cours', false);
    });
}

function stop() {
  api('/api/stop', { method: 'POST' });
}

function openFolder() {
  api('/api/open-folder', { method: 'POST' });
}

function schedule() {
  api('/api/schedule', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ day: $('schedDay').value, time: $('schedTime').value }) })
    .then(function (r) {
      flash('schedmsg', r.ok ? 'Tâche planifiée ✓' : (r.error || 'Erreur'), r.ok);
      refresh();
    });
}

function flash(id, text, ok) {
  var el = $(id);
  el.textContent = text;
  el.className = 'msg ' + (ok ? 'ok' : 'err');
  setTimeout(function () { el.textContent = ''; }, 5000);
}

function refresh() {
  api('/api/status').then(function (s) {
    $('count').textContent = s.pdfCount;
    $('dir').textContent = s.outDir;
    $('state').textContent = s.running ? 'en cours…' : 'inactif';
    $('state').className = 'badge ' + (s.running ? 'run' : 'idle');
    $('btnRun').disabled = s.running;
    $('btnRunV').disabled = s.running;
    $('btnStop').disabled = !s.running;
    if (s.log && s.log.length) {
      var el = $('log');
      var atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 30;
      el.textContent = s.log.join('\\n');
      if (atBottom) el.scrollTop = el.scrollHeight;
    }
    $('schedinfo').textContent = s.schedule
      ? 'Tâche planifiée active — prochaine exécution : ' + s.schedule
      : 'Aucune tâche planifiée pour le moment.';
  });
}

loadConfig();
refresh();
setInterval(refresh, 2000);
</script>
</body>
</html>`;

// ---------------------------------------------------------------- serveur ---
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  if (req.method === 'GET' && url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(PAGE);
  }

  if (req.method === 'GET' && url === '/api/config') {
    const env = readEnv();
    const out = {};
    for (const k of ENV_KEYS) out[k] = env[k] || '';
    return json(res, 200, out);
  }

  if (req.method === 'POST' && url === '/api/config') {
    const body = await readBody(req);
    writeEnv(body);
    return json(res, 200, { ok: true });
  }

  if (req.method === 'GET' && url === '/api/status') {
    const stats = pdfStats();
    return scheduleQuery((next) => json(res, 200, {
      running: !!child,
      lastExit,
      pdfCount: stats.count,
      outDir: stats.dir,
      log: logBuffer.slice(-200),
      schedule: next,
    }));
  }

  if (req.method === 'POST' && url === '/api/run') {
    const body = await readBody(req);
    const env = readEnv();
    if (!env.INPI_USERNAME || !env.INPI_PASSWORD) {
      return json(res, 200, { ok: false, error: 'Renseignez d’abord vos identifiants INPI.' });
    }
    const ok = startRun(!!body.visible);
    return json(res, 200, ok ? { ok: true } : { ok: false, error: 'Une exécution est déjà en cours.' });
  }

  if (req.method === 'POST' && url === '/api/stop') {
    return json(res, 200, { ok: stopRun() });
  }

  if (req.method === 'POST' && url === '/api/open-folder') {
    const dir = outDir();
    fs.mkdirSync(dir, { recursive: true });
    spawn('explorer.exe', [dir], { detached: true });
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url === '/api/schedule') {
    const body = await readBody(req);
    const time = /^\d{2}:\d{2}$/.test(body.time || '') ? body.time : '09:00';
    return scheduleCreate(body.day || 'MON', time, (err) =>
      json(res, 200, err ? { ok: false, error: err.trim() } : { ok: true })
    );
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}`;
  console.log(`Interface Factures INPI disponible : ${url}`);
  console.log('Fermez cette fenêtre pour quitter l’interface.');
  // Ouvre le navigateur par défaut (sauf si lancé avec --no-open)
  if (!process.argv.includes('--no-open')) {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, windowsHide: true });
  }
});
