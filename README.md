# factures-inpi 🧾

**Récupération et renommage automatiques des factures INPI** — pensé pour
les cabinets d'expertise comptable qui déposent des formalités au
Guichet unique et veulent récupérer leurs justificatifs sans cliquer
500 fois sur « duplicata ».

Le robot se connecte à l'[extranet compte client
INPI](https://compte-client.inpi.fr), parcourt tout le relevé de compte,
télécharge chaque **duplicata** (factures de paiement de commande et
reçus de remboursement) et le renomme proprement :

```
2026-06-05 - INPI - Facture 19581400 - DUPONT SARL.pdf
2026-06-09 - INPI - Remboursement 19102258 - SCI MARTIN.pdf
```

La **référence client** que vous saisissez lors de la formalité se
retrouve dans le nom du fichier : le classement par dossier client est
immédiat.

À chaque exécution, seules les **nouvelles** opérations sont
téléchargées (un index local mémorise ce qui a déjà été récupéré).
Planifié chaque semaine, le dossier reste à jour tout seul.

## Prérequis

- Windows (testé sur Windows 11 ; fonctionne aussi sur macOS/Linux en
  lançant les commandes `npm` à la main)
- [Node.js](https://nodejs.org) (version LTS)
- Un compte client INPI (celui avec lequel vous payez vos formalités sur
  compte-client.inpi.fr)

## Installation

```
git clone https://github.com/<votre-compte>/factures-inpi.git
cd factures-inpi
```

1. Double-cliquer sur **`install.cmd`** (installe les dépendances et le
   navigateur, crée le fichier `.env`).
2. Ouvrir **`.env`** avec le Bloc-notes et renseigner :
   ```
   INPI_USERNAME=votre_numero_de_compte
   INPI_PASSWORD=votre_mot_de_passe
   ```
3. Double-cliquer sur **`connexion.cmd`** : le navigateur s'ouvre et la
   première récupération se fait sous vos yeux. Selon l'ancienneté du
   compte, la première passe peut prendre de quelques minutes à une
   heure (tout l'historique est remonté).
4. Double-cliquer sur **`planifier.cmd`** pour créer la tâche planifiée
   Windows (chaque lundi à 9h00, modifiable dans le Planificateur de
   tâches).

C'est tout. Les factures arrivent dans `Documents\Factures INPI`.

## Configuration (fichier `.env`)

| Variable | Rôle | Défaut |
|---|---|---|
| `INPI_USERNAME` / `INPI_PASSWORD` | Identifiants du compte client INPI | — |
| `DOWNLOAD_DIR` | Dossier de destination | `Documents\Factures INPI` |
| `FILENAME_PATTERN` | Modèle de nom de fichier | `{date} - INPI - {type} {numero} - {refclient}.pdf` |
| `INPI_FROM_DATE` | Début de l'historique (JJ/MM/AAAA) | `01/01/2010` |

Variables disponibles dans `FILENAME_PATTERN` : `{date}` (AAAA-MM-JJ),
`{numero}` (n° de commande), `{refclient}`, `{type}` (Facture /
Remboursement), `{montant}`.

## Utilisation manuelle

| Commande | Effet |
|---|---|
| `run.cmd` ou `npm start` | Récupération silencieuse (headless) |
| `connexion.cmd` ou `npm run connexion` | Avec navigateur visible |

Journal dans `logs\inpi-AAAA-MM-JJ.log` ; en cas de problème, une
capture d'écran de ce que voyait le robot est enregistrée dans `logs\`.

## Sécurité

- Les identifiants restent **sur votre poste**, dans le fichier `.env`
  (exclu de git par le `.gitignore`).
- Le robot ne fait que lire le relevé et télécharger des duplicatas —
  aucune action d'achat, de modification ou de suppression.

## Limites connues

- L'extranet INPI est une vieille application : si l'INPI la refond, les
  sélecteurs devront être adaptés (ouvrez une issue avec la capture
  d'écran générée dans `logs\`).
- Pas de gestion du changement de mot de passe : si le compte expire,
  l'exécution échoue avec un message explicite dans le log.

## Licence

MIT — utilisez, modifiez, partagez librement entre consœurs et confrères.
