# claude-ide

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
| C8 | Démarrage en un clic, `claude-ide.cmd` | fait |
| — | Panneau Worktrees : état git, sessions rattachées, retrait gardé | fait |
| B6 | Emballage Electron : fenêtre native, installateur NSIS | fait |

Le plan est bouclé.

## Lancer

Double-cliquer **`claude-ide.cmd`** : il installe les dépendances au premier
lancement, démarre le serveur et ouvre le navigateur sur la bonne URL. Fermer la
fenêtre arrête le serveur et les terminaux qu'il a ouverts.

En ligne de commande :

```
pnpm install
pnpm start                  # démarre et ouvre le navigateur
CLAUDE_IDE_NO_OPEN=1 …      # démarre sans ouvrir le navigateur
CLAUDE_IDE_PORT=7790 …      # port fixe plutôt qu'un port libre
```

## Disposition

Celle de ClaudeTerm, et sa règle : **gauche = le projet, centre = la session,
droite = ce qui ne dépend d'aucun projet.**

```
┌ barre de titre : (projet A) (projet B) (+)                              ┐
├──────────────┬────────────────────────────────────┬────────────────────┤
│ fil d'Ariane │ onglets terminaux        + ✦claude │ ⚙ 🕐 ✦ ⛓ ⚙ 🔔      │
│ fichiers     │ ┌────────────────────────────────┐ │ filtre             │
│              │ │  terminal, ou état vide        │ │                    │
│              │ └────────────────────────────────┘ │ Process · History  │
│ ──────────── │ dossier · mode · état              │ Skills · MCP       │
│ 🔗📦✦⛓⑂  ⓘ ˅ │ ────────────────────────────────── │ Réglages · Alertes │
│ mode courant │ 📋 📈 📄  bloc session        ⓘ ˅  │                    │
└──────────────┴────────────────────────────────────┴────────────────────┘
```

Chaque projet ouvert a son onglet, ses terminaux et son navigateur de fichiers.
Les blocs à modes se replient (`˅`) et expliquent le mode courant (`ⓘ`).

La session regardée vient de **History**, à droite, et ne déplace pas le projet
courant : c'est une lecture, pas un déplacement. La reprendre — bouton
« reprendre », qui lance `claude --resume` — ouvre son projet, parce que là c'est
une action.

Les fichiers cachés sont écartés de la liste, `node_modules` aussi.

## Thème

Sombre par défaut, clair quand le système le demande, et un bouton dans la barre
de titre qui force l'un ou l'autre. Le réglage explicite l'emporte sur le système,
et le suivi est immédiat — aucun rechargement.

Les couleurs sont des variables CSS, **y compris les seize couleurs ANSI du
terminal**. xterm peint sur un canevas et ne lit pas la feuille de style : sa
palette lui est repassée à chaque changement. Sans cela, le jaune et le cyan
réglés pour un fond noir deviennent illisibles sur blanc — c'est tout le terminal
qui suit l'apparence, pas seulement son fond.


## Préférences

Le bouton de réglage de la barre de titre ouvre les préférences propres à
l'application, rangées avec le thème dans sa configuration — jamais dans
`settings.json`, qui appartient à Claude Code. Elles portent pour l'instant la
police du terminal et sa taille, appliquées aussitôt aux terminaux ouverts.

Une page ne peut pas lister les polices installées : la liste est faite de
polices à chasse fixe courantes, dont on ne garde que celles qui changent la
largeur d'un texte par rapport à deux polices proportionnelles.
## Deux façons de l'utiliser

**En application de bureau.** `pnpm package` produit un installateur NSIS ; le
raccourci lance une fenêtre native. Elle démarre le serveur local dans son propre
processus et charge la même URL qu'un navigateur : **une seule implémentation du
client**, et la page garde une origine `http://127.0.0.1` plutôt qu'un `file://`
privilégié.

Ce que la fenêtre native ajoute, et qui justifiait l'emballage :

- **Le glisser-déposer depuis l'Explorateur Windows.** Un navigateur livre le
  contenu d'un fichier déposé, jamais son chemin ; Electron le donne, et le chemin
  s'écrit dans le terminal. C'était la seule fonction réellement perdue sans lui.
- **Le clignotement du bouton de la barre des tâches** quand un onglet attend.

Le pont passe par `contextBridge` : la page n'a pas accès à Node, exactement comme
dans un navigateur, et n'expose que ces deux capacités.

**Dans un navigateur.** `claude-ide.cmd` ou `pnpm start` : même application, sans
fenêtre native ni glisser-déposer externe. Rien n'est dupliqué entre les deux.

**node-pty n'est pas recompilé.** Il est livré en N-API, donc son binaire vaut
pour Node comme pour Electron — vérifié en ouvrant un vrai terminal ConPTY depuis
l'application empaquetée. C'est ce qui a permis de reporter l'emballage sans
s'interdire d'y venir.

L'installateur pèse ~111 Mo, dont l'essentiel est le runtime Electron ; l'application
elle-même tient en 17 Mo. **Il n'est pas signé** : SmartScreen avertira au premier
lancement. Aucune icône n'est fournie non plus — celle d'Electron est utilisée.

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

## Ce que les panneaux écrivent

Les magasins lisent et écrivent ; l'interface expose les deux. Quatre garde-fous,
tous couverts par des tests :

- **Les routes qui écrivent sont séparées des lectures et réservées à POST**, pour
  qu'aucune ne parte sur une simple navigation.
- **Un nom de dossier de skill est validé avant de composer un chemin** : il sert
  à une suppression récursive, et un `..` ou un séparateur la ferait sortir du
  dossier des skills. Un nom de serveur MCP ne peut pas porter de point, qui
  désignerait une clé imbriquée plutôt qu'un serveur.
- **L'édition brute de `settings.json` est analysée avant d'atteindre le disque**,
  et l'original est sauvegardé avant la première modification.
- **Seule la portée projet des serveurs MCP s'écrit.** `~/.claude.json` porte aussi
  l'historique et l'état de chaque projet : les portées perso et locale passent par
  la CLI `claude mcp`.

Les suppressions demandent un second clic plutôt qu'une fenêtre de confirmation :
cela écarte le geste involontaire sans bloquer la page.

## L'état des serveurs MCP

Les panneaux listent les serveurs depuis les fichiers de configuration, ce qui
est immédiat mais ne dit pas s'ils répondent. Cet état-là n'existe nulle part sur
le disque : il faut interroger chaque serveur, ce que fait `claude mcp list`.

- **C'est une route à part, déclenchée par un bouton.** La commande prend une
  quinzaine de secondes sur une vingtaine de serveurs. La liaison à la liste se
  fait par nom, et l'état vient se poser sur des lignes déjà affichées.
- **Seuls le nom et l'état sont retenus.** La cible que la commande rappelle est
  déjà connue des panneaux, qui la tiennent de la configuration.
- **La commande révèle les connecteurs claude.ai**, rattachés au compte et
  absents de tout fichier local. Ils n'apparaissent donc qu'une fois l'état lu,
  dans leur propre section.
- **Une sortie en échec reste exploitable** : un serveur injoignable peut faire
  sortir la commande en erreur, et ce qu'elle a écrit avant est l'état des
  autres.

## Dossiers liés

Le front dépend de l'API et du design system, qui vivent dans d'autres dépôts.
Déclarer ces dossiers évite d'avoir à redire à Claude où ils sont et à quoi ils
servent. Trois fichiers y suffisent, tous écrits dans le projet :

| Fichier | Rôle |
|---|---|
| `.claude/settings.local.json` | les chemins dans `permissions.additionalDirectories`, et une règle `deny` par dossier en lecture seule |
| `.claude/claude-ide.json` | les rôles, qui n'ont pas d'équivalent natif |
| `.claude/claude-ide-prompt.md` | le texte décrivant les liens, passé à Claude en `--append-system-prompt-file` |

Trois choses méritent d'être dites :

- **L'accès et le sens sont deux mécanismes distincts.** `additionalDirectories`
  donne à Claude le droit de lire un dossier, rien de plus : sans le fichier de
  prompt, il y a accès sans savoir ce qu'il y trouvera. Le fichier est retiré
  avec le dernier lien, pour ne pas décrire des dossiers dont le projet ne
  dépend plus, et un projet sans lien n'en reçoit jamais.
- **Le drapeau est posé par une fonction `claude` du profil du shell**, pas par
  la commande d'ouverture d'un onglet. Un `claude` tapé à la main en profite donc
  autant qu'un onglet Claude, et `--resume` comme le reste des arguments passent
  au travers. La fonction s'efface devant un appel qui pose déjà son propre
  prompt système, et le drapeau n'est ajouté que si le fichier existe — Claude
  Code refuse de démarrer sur un fichier absent. L'exécutable est résolu avant
  que la fonction du même nom soit définie, sans quoi elle s'appellerait
  elle-même.
- **La règle de refus est un `Edit`, jamais un `Write`.** C'est la seule forme
  que Claude Code confronte aux écritures de fichiers, et elle couvre tous les
  outils qui en font ; un `Write` visant un chemin reste sans effet et se fait
  signaler au démarrage de chaque session.

## Worktrees

Le panneau lit `git worktree list --porcelain`, puis l'état de chacun : fichiers
non commités, avance et retard sur la branche amont. C'est ce qui distingue un
worktree encore en cours d'un worktree simplement oublié.

Deux points méritent d'être dits :

- **Les chemins sont résolus des deux côtés avant d'être comparés.** Git rend
  toujours sa propre résolution : un dossier atteint par un nom court
  `ADM-A~1.QUI`, par une jonction ou dans une autre casse ressort sous sa forme
  longue. Sans cette résolution, aucune session ne se rattache à son worktree.
- **Le retrait refuse un worktree qui porte du travail non commité.**
  `git worktree remove --force` saurait le faire ; ce forçage n'est pas exposé,
  parce que ce travail-là ne se retrouve nulle part. Le dépôt principal et tout
  chemin hors du projet sont refusés de la même façon.

## Ouvrir un fichier

Dans le Finder, un clic sélectionne et un double-clic ouvre avec l'application
par défaut ; le menu contextuel insère le chemin dans le prompt, montre le fichier
dans l'Explorateur ou copie son chemin. Ce que Windows exécuterait au lieu de
l'ouvrir — `.cmd`, `.ps1`, et `.js`, confié par défaut à Windows Script Host —
est montré dans l'Explorateur à la place : un double-clic dans un dépôt ne lance
rien. L'ouverture passe par `explorer.exe`, sans shell pour relire le chemin.

## Lancer un script

Un script déjà en cours n'est pas relancé : son onglet revient au premier plan.
Sinon, un shell du projet qui ne fait rien le reçoit, et on n'ouvre un onglet que
s'il n'y en a aucun. La commande est précédée d'Échap, qui vide la ligne en cours
sous PSReadLine, et d'un `Set-Location` si le shell n'est pas déjà dans le bon
dossier.

## Pourquoi le serveur exige un jeton

Il n'écoute que sur `127.0.0.1`, et cela ne suffit pas : n'importe quelle page web
ouverte dans le navigateur peut joindre cette adresse, et **une connexion WebSocket
n'est pas soumise à la politique d'origine**. Sans contrôle, un site visité
pourrait ouvrir un shell sur la machine.

D'où deux verrous, tous deux couverts par des tests : un jeton tiré au démarrage,
exigé sur chaque requête et sur la négociation WebSocket, et le refus de toute
origine qui n'est pas la nôtre.

## Notifications

Claude Code signale trois choses par ses hooks : une permission demandée, une
attente de réponse, une réponse terminée — et, par `UserPromptSubmit`, la reprise
qui les rend caduques. L'installation, depuis le panneau
**Notifications**, déclare ces hooks dans `settings.json` et dépose un script qui
déverse chaque événement dans une file que le serveur surveille.

Trois décisions de conception :

- **Le type vient du `matcher`, pas de la charge utile.** Une entrée de hook par
  type, et le type est passé en argument du script : la documentation fixe les
  valeurs de `matcher`, pas le champ qui les porterait dans le JSON reçu.
  `Stop` n'accepte pas de `matcher` — en poser un ferait taire le hook.
- **Le script ne fait que déverser.** Un hook s'exécute dans le chemin critique
  de la session : il rend la main tout de suite, n'échoue jamais vers l'appelant,
  et sort de lui-même au bout de deux secondes si l'entrée standard ne se ferme pas.
- **L'installation conserve les hooks existants.** `settings.json` porte souvent
  des hooks posés à la main sur les mêmes événements ; une réinstallation remplace
  les nôtres sans toucher aux autres, et la désinstallation les laisse en place.

Chaque événement allume la pastille de son onglet. Si la fenêtre n'a pas le
focus, il devient aussi une notification système, une par onglet — la suivante
remplace la précédente —, et la cliquer ramène la fenêtre sur cet onglet. Devant
l'application, la pastille suffit. Sous Windows, l'application de bureau déclare
son identifiant d'application : sans lui, les notifications d'une application
absente du menu Démarrer ne s'affichent pas.

La pastille et la notification s'éteignent quand on montre l'onglet, et aussi
quand la session repart sur un nouveau prompt. La reprise est lue sur
`UserPromptSubmit` plutôt que sur `PreToolUse`, qui lancerait un processus à
chaque appel d'outil. Elle ne voit donc pas une session qui repart sans prompt.
Une installation antérieure à ce hook apparaît comme partielle : il suffit de
réinstaller.

Sous Windows, le bouton de la barre des tâches porte le nombre d'onglets en
attente, fenêtre au premier plan ou non, et clignote tant que la fenêtre est en
arrière-plan. L'image du compteur est dessinée par la page : le processus
principal n'a pas de canevas.

## Le plan d'une session

`~/.claude/plans` n'existe pas sur cette version de Claude Code. Le plan n'est donc
lu nulle part ailleurs que là où il est produit : l'appel à `ExitPlanMode`, dont
l'entrée porte le texte soumis à validation. Le dernier l'emporte — une session peut
repasser en mode plan et en proposer un autre.

Le panneau distingue trois situations, parce qu'elles n'appellent pas la même
réaction : un plan, une session passée en mode plan sans en soumettre, et une
session qui n'y est jamais passée. Sur le corpus de référence, `mode` ne vaut
`"normal"` que sur ses 5454 occurrences : le cas n'est pas rare, il est le seul
observé.

## Ce que le corpus vivant impose aux tests

Les sessions Claude Code en cours écrivent pendant que les tests tournent. Un test
qui exige qu'aucun transcript n'ait changé entre deux passes échoue au hasard. Les
assertions portent donc sur des propriétés stables — « le rafraîchissement réutilise
l'essentiel de l'index et coûte une fraction de l'indexation complète » — et jamais
sur l'immobilité du disque.
