# <img src="assets/brand/logo.png" alt="" width="36" align="top"> Clide

Un poste de travail Windows pour mener plusieurs chantiers Claude Code de front.
Les terminaux sont dans l'application ; les panneaux, eux, ne demandent rien à
Claude : ils relisent les fichiers qu'il laisse derrière lui.

## Filiation

L'idée vient de **ClaudeTerm**, l'application macOS de Jérôme Laval, publiée sous
PolyForm Noncommercial 1.0.0.

Rien n'en est repris. ClaudeTerm est écrit en Swift avec SwiftUI et SwiftTerm ;
celui-ci est en TypeScript, sur Node et un navigateur. La couche de lecture est
reconstruite à partir de ce que Claude Code écrit réellement sur cette machine, et
non transposée : le format a divergé de celui que décrit l'original — ni
`sessions-index.json` ni `~/.claude/plans` n'existent plus, et huit types d'events
sont apparus depuis.

Cette parenté est une dette intellectuelle, et elle est citée comme telle.

Plan d'implémentation, mesures et arbitrages : [`docs/workflow.md`](docs/workflow.md).
Pistes pour la suite : [`docs/pistes.md`](docs/pistes.md).

## État

| Tâche | Contenu | État |
|---|---|---|
| T0.2 | workspace pnpm, TypeScript strict, vitest | fait |
| A1 | fixtures anonymisées, 22 types d'events | fait |
| A2 | `TranscriptReader` : parcours récursif, lecture incrémentale | fait |
| A3 | `SessionProjection` | fait |
| **G1** | rejeu du corpus réel sans exception ni ligne illisible | **franchi** |
| A3b | `SessionIndex` : index persistant, invalidation mtime+taille | fait |
| A4 | `FileHistoryResolver` : résolution des sauvegardes et diff | fait |
| A5 | `SkillStore` : skills et commandes, projet et perso | fait |
| A6 | `McpStore` : trois portées, secrets masqués | fait |
| A7 | `SettingsEditor` : éditions chirurgicales `jsonc` | fait |
| **G2** | `settings.json` réel modifié sans perdre un caractère ailleurs | **franchi** |
| A8 | `ScriptStore` : scripts, espaces de travail, gestionnaire | fait |
| A9 | `LinkStore` : projets liés | fait |
| B1 | Serveur HTTP + WebSocket, jeton d'accès, API sur `core/` | fait |
| B2 | `PtyManager` : terminaux ConPTY | fait |
| B3 | Client xterm.js dans le navigateur | fait |
| B4 | Profil PowerShell chaîné + parseur OSC | fait |
| B5 | Onglets et états idle / running / failed | fait |
| C1 | Fenêtre à trois colonnes, onglets, barre d'état | fait |
| C2 | Panneaux History et Activité | fait |
| C3 | Panneau Fichiers avec diff par session | fait |
| C4 | Panneaux Skills, MCP, Scripts, Liens, Réglages, en lecture et en écriture | fait |
| C5 | Panneau Process, arbre Claude, arrêt gardé | fait |
| C6 | Notifications : hooks, file d'événements, pastille d'onglet | fait |
| C7 | Panneau Plan : lu dans l'appel à `ExitPlanMode` | fait |
| C8 | Démarrage en un clic, `clide.cmd` | fait |
| — | Panneau Worktrees : état git, sessions rattachées, retrait gardé | fait |
| B6 | Emballage Electron : fenêtre native, installateur NSIS | fait |

Le plan est bouclé.

## Lancer

Double-cliquer **`clide.cmd`** : il installe les dépendances au premier
lancement, démarre le serveur et ouvre le navigateur sur la bonne URL. Fermer la
fenêtre arrête le serveur et les terminaux qu'il a ouverts.

En ligne de commande :

```
pnpm install
pnpm start                  # démarre et ouvre le navigateur
CLIDE_NO_OPEN=1 …      # démarre sans ouvrir le navigateur
CLIDE_PORT=7790 …      # port fixe plutôt qu'un port libre
```

## Documentation

Le guide d'utilisation est dans [`docs/guide/`](docs/guide/index.md) : un site
VitePress, lisible tel quel sur GitHub, et servi par l'application elle-même sous
`/docs/` — le bouton 📖 de la barre de titre ou `Ctrl+Maj+H` l'ouvre, dans le
navigateur comme dans l'application de bureau.

```
pnpm docs:dev       # prévisualisation, http://localhost:5175/docs/
pnpm docs:build     # site statique, que l'application sert
```

- [Présentation et lancement](docs/guide/index.md)
- [Terminaux](docs/guide/terminaux.md)
- [La session](docs/guide/session.md) — plan, activité, fichiers, captures, schéma, rédaction
- [Aperçu du serveur de développement](docs/guide/apercu.md)
- [Git et worktrees](docs/guide/git.md)
- [La colonne du projet](docs/guide/projet.md) — liens, scripts, skills, MCP
- [Le panneau global](docs/guide/panneau-global.md) — History, recherche, chantiers, coûts
- [Personnaliser](docs/guide/personnaliser.md)
- [Sécurité et données](docs/guide/securite.md)

## Commandes

```
pnpm install
pnpm test          # suite complète, rejeu du corpus local compris
pnpm typecheck
pnpm fixtures      # régénère les fixtures depuis ~/.claude
```

Le rejeu du corpus (`packages/core/test/corpus.test.ts`) s'ignore de lui-même là où
`~/.claude/projects` n'existe pas, pour que la suite reste verte en CI. Son rapport
atterrit dans `packages/core/reports/corpus-g1.json`.

## Application de bureau et mesures

**node-pty n'est pas recompilé.** Il est livré en N-API, donc son binaire vaut
pour Node comme pour Electron — vérifié en ouvrant un vrai terminal ConPTY depuis
l'application empaquetée. C'est ce qui a permis de reporter l'emballage sans
s'interdire d'y venir.

L'installateur pèse ~120 Mo, dont l'essentiel est le runtime Electron ; l'application
elle-même tient en 38 Mo, dont 10 pour node-pty et ses binaires. Tout ce qui passe
par une commande du système — `git`, `gh`, `glab`, `netstat`, `claude -p` — part
du processus principal d'Electron avec le `PATH` de la session Windows : rien à
configurer de plus que pour la version navigateur. **Il n'est pas signé** :
SmartScreen avertira au premier lancement.

Le logo a pour source `assets/brand/logo.webp` (580 × 510). Ses déclinaisons en
sont tirées, centrées sur un carré transparent sans être déformées :
`assets/brand/logo.png` (512 px), l'icône multi-tailles
`packages/desktop/build/icon.ico` de l'exécutable et de l'installateur, et les
favicons et logos des dossiers `public/` du client et du guide. Elles se
régénèrent à la main si la source change.

Mesures sur le corpus local (77 transcripts, 240 Mo), cache système chaud :

| Opération | Coût |
|---|---|
| Indexation complète | ~1,7 s |
| Liste de 65 sessions depuis l'index | **8 ms** |
| Rafraîchissement incrémental | 55 ms, 75 réutilisés / 2 réindexés |

Sur un cache système froid, l'indexation complète monte à ~30 s : c'est exactement
ce que l'index existe pour ne pas refaire à chaque ouverture de panneau.

## Structure

```
packages/core/          TypeScript pur : ni Electron, ni Windows, ni PTY
  src/paths.ts          localisation de ~/.claude, encodage des chemins projet
  src/transcript/       events, lecture incrémentale des .jsonl, inventaire
  src/session/          projection d'un flux d'events, index persistant
  src/files/            résolution des sauvegardes et diff par session
  src/settings/         édition chirurgicale de settings.json
  src/skills/           skills et commandes, projet et perso
  src/mcp/              serveurs MCP des trois portées
  src/scripts/          scripts npm et espaces de travail
  src/links/            projets liés
  src/session/activity.ts  déroulé lisible d'une session
packages/server/        Node : terminaux ConPTY, HTTP + WebSocket, API
  src/platform/processes.ts  arbre des processus Claude (Win32_Process)
  src/platform/git.ts   worktrees : inventaire, état, retrait gardé
  src/notifications/    hooks Claude Code, file d'événements, surveillance
  src/pty/osc.ts        marqueurs d'intégration shell (OSC 7 et 7771)
  src/pty/shell-profile.ts  profil PowerShell injecté dans les terminaux
  src/pty/manager.ts    cycle de vie des terminaux
  src/server.ts         jeton d'accès, fichiers statiques, WebSocket
packages/web/           client React : Vite, Tailwind 4, shadcn/ui, xterm.js
packages/desktop/       fenêtre Electron, pont contextBridge, empaquetage NSIS
tools/make-fixtures.mjs anonymisation des transcripts réels vers les fixtures
```

Le cœur n'a que deux dépendances, toutes deux en JavaScript pur : `jsonc-parser`
pour éditer du JSON sans le réécrire, `diff` pour produire des diffs comparables à
ceux de git. Réimplémenter l'un ou l'autre aurait fait porter le risque exactement
là où la recette exige l'exactitude.

Le client est en **React 19 + Tailwind 4 + shadcn/ui**, construit par Vite. Le
serveur sert son `dist` et ne sait rien d'autre de lui : le contrat entre les deux
est l'API HTTP, pas un typage partagé.

**Les instances xterm vivent hors de React.** Chacune possède un nœud du DOM, un
tampon de plusieurs milliers de lignes et un canevas ; les faire vivre au rythme
des rendus les réinitialiserait à chaque changement d'onglet. React ne reçoit que
leur état.

`core/` ne connaît aucune API de plateforme : c'est la condition pour que les tests
portent et pour que l'ajout d'Electron ne contamine pas la logique.

## Ce que la lecture des transcripts doit encaisser

Le format n'est pas documenté par Claude Code et bouge. Trois règles en découlent,
chacune couverte par un test :

- **Un type d'event inconnu se compte, il ne fait pas échouer la lecture.**
  `SessionProjection.unknownTypes` les remonte pour qu'un panneau puisse le signaler.
- **Une ligne illisible n'interrompt pas les suivantes**, et une ligne incomplète
  attend la suite du fichier plutôt que d'être comptée comme une anomalie.
- **Une session peut changer de dossier** en cours de route (`relocated`, worktrees).
  L'indexer sur son `cwd` initial la rangerait au mauvais endroit : utiliser
  `effectiveCwd`.

## Deux points de vocabulaire du format

- `backupFileName: null` dans un `file-history-delta` signifie que le fichier
  **n'existait pas** : c'est une création, son diff part du vide. C'est le cas
  majoritaire (625 sur 1117 fichiers suivis dans le corpus de référence), pas un
  cas limite.
- Les sous-agents ont leurs propres transcripts, dans
  `<sessionId>/subagents/agent-<id>.jsonl`. Un parcours à plat les rate.
- L'état « avant » d'un fichier est sa **première** sauvegarde nommée. Les versions
  suivantes (`@v2`, `@v3`) sont des états intermédiaires de la session ; partir de
  la dernière donnerait le diff de la dernière édition, pas celui de la session.
- Le `name` du frontmatter d'un skill **ne suit pas le nom de son dossier**. Sur
  cette machine, `skills/git/SKILL.md` déclare `name: commit` : c'est `/commit`
  qui le déclenche. Afficher le dossier tromperait sur ce que tape l'utilisateur.
- `~/.claude.json` porte des jetons d'accès dans les `headers` et `env` des
  serveurs MCP. Les listings les masquent par défaut en gardant les clés ;
  les révéler demande `{ reveal: true }`.

## Ce que le corpus vivant impose aux tests

Les sessions Claude Code en cours écrivent pendant que les tests tournent. Un test
qui exige qu'aucun transcript n'ait changé entre deux passes échoue au hasard. Les
assertions portent donc sur des propriétés stables — « le rafraîchissement réutilise
l'essentiel de l'index et coûte une fraction de l'indexation complète » — et jamais
sur l'immobilité du disque.

## Licence

Clide est publié sous licence MIT, reproduite dans `LICENSE`. ClaudeTerm, dont
vient l'idée, garde sa propre licence : aucun de ses fichiers n'est repris ici.
