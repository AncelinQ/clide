# claude-ide

Poste de travail Windows pour piloter Claude Code sur plusieurs projets : terminal
intégré, un onglet par projet, et des panneaux qui lisent ce que Claude Code écrit
déjà sur disque.

Inspiré de **ClaudeTerm** (macOS, Swift, de Jérôme Laval). Le code n'est pas traduit :
la couche de lecture est reconstruite, parce que le format des transcripts a divergé
de celui que décrit l'original.

Plan d'implémentation, mesures et arbitrages : [`docs/workflow.md`](docs/workflow.md).

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
| C4 | Panneaux Skills, MCP, Scripts, Liens, Réglages | fait |
| C5 | Panneau Process, arbre Claude, arrêt gardé | fait |
| C6 | Notifications | à faire |
| C7 | Panneau Plan | **sans source** — état vide explicite |
| B6 | Emballage Electron | **reporté, décidé à l'usage** |

## Lancer

```
pnpm install
pnpm start        # affiche une URL 127.0.0.1 avec son jeton — à ouvrir au navigateur
```

**Electron n'est pas là, et c'est délibéré.** Le critère n'était pas le poids du
binaire mais l'endroit où tourne `core/` : 2000 lignes qui importent `node:fs`.
Tauri ou Wails obligeraient à le réécrire en Rust ou en Go. Electron et un serveur
local le font tourner tel quel — et le serveur local est ce qu'Electron
encapsulerait de toute façon. L'emballer plus tard n'exigera pas de refaire l'app :
node-pty est compilé en N-API, son binaire vaut pour Node comme pour Electron.

Ce qui manque sans fenêtre native : la pastille de barre des tâches, les raccourcis
globaux, et le glisser-déposer **depuis l'Explorateur Windows** — un navigateur
donne le contenu d'un fichier déposé, jamais son chemin. Le glisser interne et le
dépôt d'images passent, eux, par le serveur.

Mesures sur le corpus local (77 transcripts, 240 Mo), cache système chaud :

| Opération | Coût |
|---|---|
| Indexation complète | ~1,7 s |
| Liste de 65 sessions depuis l'index | **8 ms** |
| Rafraîchissement incrémental | 55 ms, 75 réutilisés / 2 réindexés |

Sur un cache système froid, l'indexation complète monte à ~30 s : c'est exactement
ce que l'index existe pour ne pas refaire à chaque ouverture de panneau.

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
  src/pty/osc.ts        marqueurs d'intégration shell (OSC 7 et 7771)
  src/pty/shell-profile.ts  profil PowerShell injecté dans les terminaux
  src/pty/manager.ts    cycle de vie des terminaux
  src/server.ts         jeton d'accès, fichiers statiques, WebSocket
packages/web/           client sans outil de construction : HTML, CSS, un module
tools/make-fixtures.mjs anonymisation des transcripts réels vers les fixtures
```

Deux dépendances, toutes deux en JavaScript pur : `jsonc-parser` pour éditer du
JSON sans le réécrire, `diff` pour produire des diffs comparables à ceux de git.
Réimplémenter l'un ou l'autre aurait fait porter le risque exactement là où la
recette exige l'exactitude.

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

## Pourquoi le serveur exige un jeton

Il n'écoute que sur `127.0.0.1`, et cela ne suffit pas : n'importe quelle page web
ouverte dans le navigateur peut joindre cette adresse, et **une connexion WebSocket
n'est pas soumise à la politique d'origine**. Sans contrôle, un site visité
pourrait ouvrir un shell sur la machine.

D'où deux verrous, tous deux couverts par des tests : un jeton tiré au démarrage,
exigé sur chaque requête et sur la négociation WebSocket, et le refus de toute
origine qui n'est pas la nôtre.

## Ce que le corpus vivant impose aux tests

Les sessions Claude Code en cours écrivent pendant que les tests tournent. Un test
qui exige qu'aucun transcript n'ait changé entre deux passes échoue au hasard. Les
assertions portent donc sur des propriétés stables — « le rafraîchissement réutilise
l'essentiel de l'index et coûte une fraction de l'indexation complète » — et jamais
sur l'immobilité du disque.
