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

Les terminaux vivent dans le serveur, pas dans la page : un rechargement les
retrouve, rangés dans leur projet — y compris un onglet ouvert dans un worktree —,
avec les 256 derniers Ko de leur sortie rejoués.

La session regardée vient de **History**, à droite, et ne déplace pas le projet
courant : c'est une lecture, pas un déplacement. La reprendre — bouton
« reprendre », qui lance `claude --resume` — ouvre son projet, parce que là c'est
une action.

Les fichiers cachés sont écartés de la liste, `node_modules` aussi.

## Onglets du panneau global

Neuf onglets ne tiennent pas dans la colonne de droite. Deux dispositions, au choix
depuis le menu « ⋯ » :

- **en ligne, en haut**, comme les outils de développement du navigateur : autant
  d'onglets qu'en tient la largeur, le reste dans « ⋯ ». L'onglet ouvert reste
  toujours sur la ligne, pour qu'on voie où l'on est ;
- **en colonne, à droite**, comme les barres d'outils de WebStorm : la hauteur les
  tient tous, et le panneau garde toute sa largeur de texte.

Le même menu choisit les onglets affichés ; un onglet masqué reste accessible depuis
« ⋯ ». Le choix est gardé avec les autres préférences de l'application.

## Thème

Sombre par défaut, clair quand le système le demande, et un bouton dans la barre
de titre qui force l'un ou l'autre. Le réglage explicite l'emporte sur le système,
et le suivi est immédiat — aucun rechargement.

Les couleurs sont des variables CSS, **y compris les seize couleurs ANSI du
terminal**. xterm peint sur un canevas et ne lit pas la feuille de style : sa
palette lui est repassée à chaque changement. Sans cela, le jaune et le cyan
réglés pour un fond noir deviennent illisibles sur blanc — c'est tout le terminal
qui suit l'apparence, pas seulement son fond.


## Langue

L'interface est en français ou en anglais, au choix dans les préférences, ou selon
la langue du système. Le français est la source, écrit tel quel dans le code : il se
lit à l'endroit où il s'affiche. L'anglais vient d'une table indexée par la chaîne
française ; une chaîne qu'elle n'a pas s'affiche en français plutôt que de
disparaître, et une phrase à trous passe par des marques `{nom}`, jamais par une
concaténation qui figerait l'ordre des mots. Ce qui est tapé dans un terminal ou
envoyé à Claude ne se traduit pas.

## Palette et raccourcis

`Ctrl+Maj+P` ouvre la palette : toute action de l'application, cherchée par mots et
lancée d'Entrée, avec son raccourci affiché — c'est ce qui les rend découvrables.

| Action | Raccourci |
|---|---|
| Palette de commandes | `Ctrl+Maj+P` |
| Nouveau shell · nouvel onglet Claude | `Ctrl+Maj+T` · `Ctrl+Maj+A` |
| Fermer l'onglet | `Ctrl+Maj+W` |
| Onglet suivant · précédent | `Ctrl+Maj+Page suiv.` · `Ctrl+Maj+Page préc.` |
| Projet suivant · précédent | `Alt+Page suiv.` · `Alt+Page préc.` |
| Ouvrir un projet | `Ctrl+Maj+O` |
| Replier le bloc session | `Ctrl+Maj+J` |
| Colonne du projet · panneau global | `Ctrl+Maj+B` · `Ctrl+Maj+E` |
| Capture d'écran vers le prompt | `Ctrl+Maj+S` |

Un terminal capte le clavier, et ces touches sont choisies pour ne rien lui voler :
`Ctrl+Maj` sur des lettres que ni PowerShell ni Claude Code n'utilisent ainsi —
jamais C ni V, qui copient et collent —, jamais `Ctrl+Alt`, qui est AltGr sur un
clavier français et sert à taper `€`, `[` ou `@`, et pas `Ctrl+Tab`, qu'un navigateur
ne laisse pas intercepter. La touche est prise en phase de capture, avant xterm :
elle n'atteint pas le shell, et la palette se ferme sans laisser de caractère. Une
combinaison qui n'est à aucune action passe au terminal telle quelle. Les
raccourcis se changent dans les préférences ; une combinaison déjà prise est
retirée à l'autre action, et le dialogue le dit.

## Préférences

Le bouton de réglage de la barre de titre ouvre les préférences propres à
l'application, rangées avec le thème dans sa configuration — jamais dans
`settings.json`, qui appartient à Claude Code. Elles portent pour l'instant la
police du terminal et sa taille, appliquées aussitôt aux terminaux ouverts, et les
raccourcis.

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

Le panneau Réglages présente `settings.json` en formulaire — général, permissions,
hooks, environnement, plugins — avec le JSON brut replié en dessous. Chaque champ
s'écrit seul, par une édition chirurgicale : les clés que le formulaire ne connaît
pas, et la mise en forme du fichier, restent telles quelles. Une valeur vidée retire
sa clé plutôt que d'écrire une chaîne vide que Claude Code prendrait pour un réglage.
Les écritures d'un même fichier sont enchaînées : deux champs enregistrés coup sur
coup liraient sinon le même état, et le second effacerait le premier.

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

## Skills

Les skills se lisent sur trois portées : le projet (`.claude/skills`), le poste
(`~/.claude/skills`) et les plugins installés. Ceux d'un plugin vivent dans
`~/.claude/plugins/cache/<marketplace>/<plugin>/`, à une profondeur qui varie avec
sa version ; ils sont reconnus à leur position `skills/<nom>/SKILL.md`, nommés
`<plugin>:<nom>` comme leur invocation, et montrés sans édition : ils appartiennent
au plugin.

Un skill se copie du projet vers le poste et l'inverse, dossier compris — il porte
parfois des scripts ou des modèles à côté de son `SKILL.md`. Il s'importe aussi
depuis un chemin : un dossier qui porte un `SKILL.md`, ou un `.md` seul, qui devient
le `SKILL.md` d'un dossier à son nom et reçoit un en-tête s'il n'en a pas — Claude
Code ignore un `SKILL.md` qui en est dépourvu. Rien d'autre ne s'importe : l'import
lit un chemin donné par l'appelant, et s'en tenir à ces deux formes l'empêche de
recopier n'importe quel fichier. Déposer des fichiers sur le panneau fait de même :
sous Electron par leur chemin, dossiers compris ; dans un navigateur, qui ne livre
que le contenu, les seuls `.md`. Ni la copie ni l'import ne remplacent un skill
existant.

Un nouveau skill peut être rédigé par Claude : l'éditeur écrit le squelette — nom,
description, invocation — puis envoie à l'onglet Claude du projet une consigne qui
désigne ce fichier. Claude reçoit un fichier existant à compléter plutôt qu'un
emplacement à deviner.

Une commande envoyée à Claude Code part en deux temps : le texte, puis Entrée un
instant après. Reçus d'un bloc, Claude Code les lit comme un collage, où Entrée
ajoute une ligne : une commande courte passe, un prompt de trois lignes reste en
saisie.

Les routes d'écriture exigent la portée telle quelle — la rabattre sur
`user` ferait d'une demande visant un skill de plugin la suppression du skill
personnel du même nom.

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

Les serveurs du `.mcp.json` s'ajoutent et se modifient dans un éditeur. Les
secrets (`env`, `headers`) y arrivent masqués : laisser un `***` en place garde la
valeur d'origine, que le serveur remet à l'écriture ; un `***` sans valeur d'origine
est refusé plutôt qu'écrit. Les serveurs des dossiers liés sont montrés à part — ils
ne s'appliquent pas au projet — avec de quoi les copier ici, et ceux des autres
dossiers où l'on a travaillé, tirés de l'index des sessions, se reprennent de même.
Une copie se fait côté serveur, secrets compris : la page ne les voit jamais.

Les portées `local` et `user` vivent dans `~/.claude.json`, qui porte aussi
l'historique et l'état de chaque projet : on ne le réécrit pas, l'écriture passe par
`claude mcp add-json` et `claude mcp remove`. La configuration part en un seul
argument JSON, et la CLI est lancée sans shell : les valeurs saisies — commande,
jetons — ne sont jamais relues par `cmd.exe`. Seul un `claude.exe` convient ; une
installation par npm, qui ne fournit qu'un `.cmd`, voit ces écritures refusées. Ces
portées s'ajoutent, se retirent et se copient dans le projet ; elles ne se modifient
pas, la CLI n'éditant pas.

Un serveur qui demande une authentification porte un bouton `/mcp` : il tape la
commande dans l'onglet Claude du projet, l'actif s'il en est un, où Claude Code
mène l'authentification. Sans Échap devant, contrairement aux shells : dans Claude
Code, Échap interrompt le tour en cours.

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

## Branche, fetch, pull, push

La barre de titre montre la branche du projet ouvert, son avance (↑) et son
retard (↓) sur l'amont, et le nombre de fichiers touchés (●), relevés toutes les
dix secondes et au retour sur la fenêtre. Son menu fait les gestes courants par le
`git` local, qui passe par le gestionnaire d'identifiants de Windows : l'application
ne stocke aucun secret, et git ne s'arrête jamais sur une demande de mot de passe
en terminal (`GIT_TERMINAL_PROMPT=0`).

- **Fetch** (`--prune`).
- **Pull** en avance rapide seulement : une fusion ou un rebase décidés par un
  bouton réécriraient l'historique sans qu'on l'ait regardé.
- **Push** montre d'abord ce qui partira — branche distante, commits, amont créé
  pour une branche neuve — et ne part qu'une fois validé. Le serveur refuse si la
  branche a bougé depuis cet aperçu, ou si elle est en retard sur son amont ; il
  ne force jamais.

« Branches et worktrees… » liste les branches locales, puis celles qui n'existent
que sur un dépôt distant — les choisir crée la branche locale qui les suit.

- **Changer de branche** avec des modifications non commitées ne se fait pas en
  silence : la fenêtre dit combien de fichiers sont en jeu et propose de les
  mettre de côté (`git stash push --include-untracked`, sous un message qui dit de
  quelle branche ils viennent). « Réappliquer le dernier stash » apparaît dans le
  menu tant qu'il en reste un. Si le changement échoue, le stash est réappliqué.
- **Créer une branche** part de HEAD et garde les modifications en cours.
- **Ouvrir dans un worktree** crée le worktree sous `.claude/worktrees/`, là où
  Claude Code range les siens, et y lance un onglet Claude. Le dossier est exclu
  dans `.git/info/exclude`, propre au clone : sans cela il compterait parmi les
  modifications du dépôt principal.

Le panneau Worktrees ouvre aussi Claude dans un worktree, ou le worktree comme un
projet à part entière, avec son navigateur de fichiers et ses panneaux.

**La MR ou la PR de la branche** s'affiche à côté d'elle — `!196` sur GitLab,
`#12` sur GitHub — avec un point qui dit l'état de la CI. Le menu l'ouvre, ainsi
que son pipeline, et dit si elle est ouverte, en brouillon, fusionnée ou fermée,
et la décision des relecteurs sur GitHub. La forge se lit dans l'adresse du dépôt
distant ; l'état vient de `glab mr view` ou de `gh pr view`, qui gardent leur
propre connexion : l'application ne voit aucun jeton. Chaque appel coûte une
seconde, la réponse est gardée une minute. Une CLI absente ou déconnectée le dit
dans le menu.

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

Espace, sur le fichier sélectionné, ouvre un aperçu : le texte tel quel, tronqué
au-delà de 256 Ko, et les images. Un fichier portant un octet nul dans ses premiers
kilo-octets est tenu pour binaire, comme le fait git ; un SVG est montré en texte,
le rendre exécuterait ce qu'il contient. L'aperçu comme l'ouverture sont bornés à
la racine du projet, comme la liste des dossiers.

Un fichier glissé du Finder sur un terminal y écrit son chemin, dans le navigateur
comme dans l'application de bureau. Glissé depuis l'Explorateur, il ne le fait que
sous Electron : un navigateur livre le contenu d'un fichier déposé, jamais son
emplacement.

## Images vers le prompt

Claude Code lit une image désignée par son chemin, pas un contenu collé. Une image
collée dans un terminal, ou déposée sans fichier derrière elle — tirée d'une page
web, ou n'importe quel fichier dans un navigateur, qui n'en livre jamais le chemin —
est donc d'abord enregistrée dans le dossier `drops` de l'application, et c'est son
chemin qui est tapé. Elle part brute, hors du corps JSON des autres routes, dont la
limite est pensée pour des réglages ; seules les images passent, jusqu'à 20 Mo.

Le bouton Capture de la barre d'onglets ouvre l'outil Capture d'écran de Windows
(`ms-screenclip:`), qui dépose son image dans le presse-papiers et non dans un
fichier. Le serveur relève le compteur de séquence du presse-papiers avant de
l'ouvrir, puis attend qu'il change avec une image : une image copiée plus tôt ne
passe pas pour la capture, une annulation se solde par un refus au bout de deux
minutes, et rien n'est jamais écrit dans le presse-papiers.

## Lancer un script

Un script déjà en cours n'est pas relancé : son onglet revient au premier plan.
Sinon, un shell du projet qui ne fait rien le reçoit, et on n'ouvre un onglet que
s'il n'y en a aucun. La commande est précédée d'Échap, qui vide la ligne en cours
sous PSReadLine, et d'un `Set-Location` si le shell n'est pas déjà dans le bon
dossier.

Les scripts des dossiers liés sont listés à la suite, chacun avec le gestionnaire
que désigne son propre lockfile : lancer les scripts d'un dépôt npm avec le `pnpm`
du projet réécrirait son arbre de dépendances.

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
  Il écrit à côté puis renomme : le serveur ne lit jamais un événement à moitié
  écrit, et un fichier illisible de moins de deux secondes est relu au passage
  suivant plutôt que jeté — le cas d'un script installé avant ce renommage.
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

## La session d'un onglet

Un `claude` tapé dans un shell fait de l'onglet un onglet Claude le temps de la
session, puis le rend au shell. C'est la fonction `claude` du profil qui le
signale — elle est ce qui lance Claude — par deux marqueurs, `CLAUDE_START` avec
la ligne de commande et `CLAUDE_END`, ce dernier émis dans un `finally` pour qu'un
Ctrl+C ou un échec ne laisse pas l'onglet en mode Claude. Chaque lancement repart
de zéro dans le suivi de session, sur la session neuve ou celle que nomme
`--resume`.

Le bloc session suit l'onglet Claude actif ; choisir une session dans History l'en
détache jusqu'au prochain changement d'onglet. Le serveur relie chaque onglet
Claude à son transcript, puis le lit par ajouts :

- **par les hooks**, quand ils sont installés : ils donnent la session et son
  transcript, et suivent un `/clear` ou une reprise ;
- **sinon, par le fichier créé** dans le dossier du projet après l'ouverture de
  l'onglet, hors de ceux qu'un autre onglet suit. La date de modification ne sert
  pas : toute session active dans le même dossier, lancée ailleurs, écrit sans
  cesse dans le sien, et serait prise avant que la nouvelle ait créé son fichier ;
- **par la commande**, pour `claude --resume <id>` : le transcript nommé est suivi.
  Son mode n'est montré qu'une fois la reprise repartie, le transcript décrivant
  jusque-là la séance précédente.

La barre d'état porte le mode de permission, le mode plan et la taille du
contexte ; l'activité, la consommation de la session. Une réponse s'écrit en
plusieurs events qui répètent le même `message.id` et le même `usage` : les tokens
sont comptés une fois par réponse. Le bloc bascule sur Plan quand l'onglet regardé
entre en mode plan.

Deux faits du format vivant. Le mode d'un tour est porté par son prompt
(`user.permissionMode`) : l'event `permission-mode` est écrit à la fin du tour
précédent, et dit encore `auto` quand le prompt qui suit part en mode plan. Et
Claude Code ne l'écrit qu'aux tours : un Maj+Tab n'apparaît qu'au prompt suivant.

## Le plan d'une session

Le plan a deux sources. L'appel à `ExitPlanMode` porte le texte soumis à
validation. En mode plan, Claude Code annonce aussi, par une pièce jointe
`plan_mode`, le fichier de `~/.claude/plans` où il le rédige : le plus récent des
deux l'emporte, et seul un fichier sous ce dossier est lu. Le dossier n'existe
qu'une fois un plan écrit. Une session peut repasser en mode plan et en proposer un
autre : le dernier décrit le travail en cours.

Le plan est rendu en markdown, sans HTML brut : un texte produit par un modèle ne
doit pas pouvoir injecter de balise dans la page.

Le panneau distingue trois situations, parce qu'elles n'appellent pas la même
réaction : un plan, une session passée en mode plan sans en soumettre, et une
session qui n'y est jamais passée. Le mode se lit sur le prompt de chaque tour et
sur la pièce jointe `plan_mode` ; l'event `mode`, qui vaut `"normal"` à chaque
tour, ne dit rien des permissions.

## Recherche

L'onglet Recherche cherche dans tout ce qui s'est dit et tapé : prompts, réponses,
commandes et appels d'outils, en texte entier — l'activité affichée les résume, la
recherche non. Les mots sont cherchés tels quels, sans accents ni casse, tous
présents ; un bout de commande ou un identifiant de ticket se trouve comme un mot.

Le texte cherchable tient en quelques millions de caractères pour des centaines de
Mo de transcripts, les résultats d'outils n'en faisant pas partie : un index inversé
ne se justifie pas, un parcours en mémoire prend quelques millisecondes. Ce qui coûte
est l'extraction, gardée dans `search-index.json` et refaite seulement pour les
transcripts qui ont changé — cinq secondes au premier passage, un quart de seconde
ensuite. Elle est rafraîchie au plus toutes les dix secondes, pour ne pas relire à
chaque lettre la session en cours d'écriture.

Un résultat ouvre sa session sur l'entrée trouvée : l'activité et la recherche
produisent les mêmes entrées dans le même ordre, et la position d'un résultat
désigne la même ligne.

## Restaurer un fichier

Dans l'onglet Fichiers d'une session, « restaurer » ramène un fichier à son état
d'avant la session, tiré de la première sauvegarde que Claude Code en a prise
(`~/.claude/file-history/<session>/`). La fenêtre montre d'abord ce qui sera
perdu et ce qui revient ; rien ne s'écrit sans ce passage.

Le serveur refuse :

- un fichier modifié plus de cinq secondes après la dernière écriture de la
  session — le délai laisse passer un formateur lancé par un hook, pas une
  retouche à la main, qu'on perdrait ;
- un fichier que la session n'a écrit par aucun outil d'édition réussi ;
- une session qui tourne dans un onglet, ou qui a écrit il y a moins de deux
  minutes ;
- un fichier qui a changé depuis l'aperçu : l'empreinte qu'il a montrée doit être
  celle qu'on écrase.

Le contenu remplacé est copié dans `restores/<session>/<horodatage>/` des données
de l'application ; un fichier créé par la session part à la corbeille de Windows.
L'écriture passe par un fichier temporaire renommé : jamais de fichier à moitié
écrit. Les écritures d'un sous-agent comptent : ses appels d'outils sont lus dans
son transcript.

## Captures

Les images que porte un transcript — une capture qu'un outil a rendue
(`browser_take_screenshot`, un `Read` sur un PNG), une image collée dans un prompt
— s'affichent en vignettes sous leur entrée de l'activité ; un clic les montre en
grand. L'onglet Captures les rassemble dans l'ordre du temps, sous-agents compris,
et chacune s'ouvre à sa place dans l'activité.

Seuls les PNG, JPEG, GIF et WebP sont montrés. Le flux d'activité ne porte que leur
nombre : le contenu, souvent des centaines de Ko en base64, se charge par entrée
quand la vignette approche de l'écran.

## Largeur des colonnes

Les poignées entre les colonnes se tirent à la souris, et un double-clic rend la
largeur par défaut (290 px pour le projet, 340 pour le panneau global). La
poignée entre le terminal et l'aperçu règle la part de l'aperçu. Les largeurs
sont gardées d'une ouverture à l'autre ; le terminal garde toujours 420 px entre
les colonnes, et 240 à côté de l'aperçu, et une fenêtre qui rétrécit prend sur
les colonnes latérales plutôt que sur lui.

## Aperçu du serveur de développement

Une commande du shell qui annonce une adresse locale en démarrant — la ligne
`Local: http://localhost:5173/` de `vite`, `next dev` et consorts — la fait
connaître à l'onglet : le bouton d'aperçu de la barre des onglets s'allume, et
l'ouvre à côté du terminal (`Ctrl+Maj+U`). Plusieurs serveurs se choisissent dans
l'en-tête de l'aperçu ; l'adresse s'oublie quand la commande se termine.

Un serveur que Claude lance lui-même en arrière-plan n'écrit rien dans l'onglet :
il est retrouvé à son port. Le serveur de l'application relève les sockets en
écoute (`netstat -ano`) et garde ceux des processus qui descendent des onglets du
projet, qu'ils répondent en HTML — un débogueur ou une API en JSON n'ont rien à
montrer — et qu'ils ne soient pas un serveur MCP de Claude. Le relevé passe toutes
les cinq secondes aperçu ouvert, toutes les trente sinon ; l'en-tête nomme chaque
serveur par sa commande.

Le serveur lit la sortie des onglets shell pendant qu'une commande tourne, jamais
celle de Claude : une adresse citée dans une réponse n'est pas un serveur. Seules
comptent les adresses de la machine avec un port (`localhost`, `127.0.0.1`, et
`0.0.0.0` qui s'ouvre par `localhost`), et la ligne tapée, que PowerShell
redessine au lancement, est écartée : `curl http://localhost:3000` n'annonce rien.

L'aperçu est un cadre, et un cadre refusé ne s'annonce pas à la page qui le
contient : le serveur de l'application lit donc les en-têtes de l'adresse —
`X-Frame-Options`, ou un `frame-ancestors` qui n'admet pas toute origine. Un
serveur qui refuse le cadre le dit dans l'aperçu, avec un bouton pour l'ouvrir
dans le navigateur. Seules les adresses de la machine sont sondées.

## Schéma de la session

Le mode Schéma du bloc session fait dessiner par `claude -p` un diagramme Mermaid
de ce que la session a changé : chaque nœud nomme un changement, et les liens
disent comment ils s'articulent. Rien ne part sans un clic — l'appel coûte des
tokens, environ 0,15 $ pour une session de cent fichiers — et le schéma obtenu est
gardé dans `diagrams/<session>.json` des données de l'application jusqu'à ce qu'on
le refasse.

Claude lit un résumé de la session : ses demandes, la liste des fichiers changés
et leurs diffs, le tout plafonné à 60 000 caractères, chaque diff réduit à sa part
pour qu'un gros fichier n'efface pas les autres. Le schéma dit quand ce résumé a
dû couper.

L'appel est isolé : ni outil, ni serveur MCP, ni réglage — donc aucun hook —, pas
de session enregistrée qui encombrerait History, le modèle Sonnet et une dépense
plafonnée à 1 $. Le rendu se fait en `securityLevel: "strict"`, et la
bibliothèque Mermaid ne se charge qu'au premier schéma montré.

## Message de commit et description de MR

Le mode Rédaction fait rédiger par `claude -p`, sur le même résumé et avec le même
isolement que le schéma, un message de commit ou une description de merge
request. Le message de commit suit la convention des quinze derniers commits du
dépôt — type, portée, langue — ; la description de MR, dans la langue de
l'interface, donne pourquoi, ce qui change et comment tester. Environ 0,15 $
chacun pour une session de cent fichiers, gardés dans `writeups/` jusqu'à ce qu'on
les refasse.

Rien n'est écrit dans git : le texte se copie et se relit avant de commiter. Comme
dans l'onglet Fichiers, l'état « après » d'un fichier est son contenu actuel sur le
disque : rédigé pour une session ancienne, le brouillon compte aussi ce qui a
changé depuis. Il sert d'abord à la session en cours, avant son commit.

## Sous-agents

Dans l'activité d'une session, un appel `Agent` dont le sous-agent a laissé un
transcript porte « ouvrir ». Son activité remplace alors celle de la session, sous
un fil « session › description du sous-agent » ; « remonter » revient d'un cran, et
un sous-agent lancé par un sous-agent s'ouvre de la même façon.

Le lien vient de `toolUseResult.agentId`, écrit sur le résultat de l'appel, et le
transcript se retrouve sous `<session>/subagents/agent-<agentId>.jsonl`. Le client
ne donne que la session et l'identifiant : le serveur cherche le transcript parmi
ceux qu'il a découverts, jamais par un chemin reçu.

## Chantiers

Une journée de travail va d'un ticket à une branche, un worktree, des sessions et une
MR. L'onglet Chantiers les regroupe, par ticket, et par branche quand elle n'en
porte pas — le tronc (`main`, `develop`, `HEAD`) n'est le chantier de personne. Tout
vient des transcripts, sans accès à Linear ni à GitLab :

- le ticket d'une session se lit dans le **nom de sa branche** (`ancelin/hn-12528-…`
  désigne HN-12528 ; un nombre suivi d'un autre groupe de chiffres est une date, pas
  un ticket) et dans les **appels de Claude aux outils Linear**, qui nomment
  l'identifiant exact ;
- son titre, son lien et son **dernier état connu** viennent de la réponse de
  `get_issue` ou de l'état fixé par `save_issue` — le plus récent, daté, et dit comme
  tel : l'état du moment, seul Linear le connaît ;
- une session est **travaillée** quand sa branche porte le ticket, **consultée**
  quand Claude n'y a que lu ou modifié le ticket. Seules les MR des sessions
  travaillées sont rattachées : une session qui consulte un ticket peut en avoir
  ouvert d'autres, sans rapport.

Beaucoup de tickets ne sont que consultés — lus en préparant d'autres chantiers : la
liste montre d'abord ceux qui ont une branche ou une MR.

## La file d'attente

Un prompt tapé pendant que Claude travaille part dans sa file. Elle se reconstitue en
rejouant les `queue-operation` du transcript : `enqueue` ajoute le texte, `remove`
retire celui qu'absorbe le tour en cours, `dequeue` prend le premier, `popAll` vide
tout. La file de l'onglet regardé s'affiche au-dessus du bloc session, et un prompt
s'y ajoute en le tapant dans l'onglet ; retirer n'est pas offert, Claude Code ne
l'exposant pas. En pratique la file vit quelques secondes : la plupart des prompts
sont absorbés par le tour en cours.

## Ce que coûtent les sessions

Claude Code écrit le coût d'une session dans un event `cost-state`, cumulé et
détaillé par modèle — mais pas toujours : sur le corpus de référence, 31 sessions sur
72 en portent un, écrit en fin de séance, et deux ont continué après lui, dont une de
276 réponses. Le coût d'une session est donc l'une de quatre choses, et le dit :

- **exact** : le relevé, rien ne l'ayant suivi ;
- **estimé** (≈) : un tarif a chiffré la session, ou ce qui a suivi son relevé ;
- **plancher** (≥) : une partie relève d'un modèle sans tarif fiable ;
- **inconnu** : rien de chiffrable.

Les tarifs ne sont écrits nulle part : ils sont **déduits des relevés** de
l'utilisateur, à chaque lecture de l'index. Un ajustement à un seul tarif de base,
avec les proportions habituelles — sortie ×5, lecture de cache ×0,1, écriture ×2 —,
est tenté d'abord ; un ajustement libre, tarif par nature de token, ensuite. Un
modèle n'en reçoit que si chaque relevé est redonné à 2 % près, sur au moins trois
sessions. Sur le corpus, Opus 5 retrouve 5 $ par million en entrée et Haiku 1 $, à
0,01 % près ; Opus 5.5, avec deux relevés qui ne suivent pas ces proportions, n'en
reçoit pas, et ses sessions restent « coût inconnu » plutôt que chiffrées faux. Le
nom d'un modèle est lu sans ses crochets : `cost-state` écrit `claude-opus-5[1m]` là
où les réponses écrivent `claude-opus-5`, au même tarif.

Le relevé d'une session couvre ses sous-agents ; sans relevé, leurs tokens
s'ajoutent aux siens. Une réponse s'écrit en plusieurs events au même `message.id` :
elle n'est comptée qu'une fois. Le panneau Coûts range chaque session au jour de sa
dernière activité — ses réponses ne sont pas datées une à une dans l'index.

## Retirer une session

Une session se retire depuis History, et part à la corbeille de Windows — jamais
supprimée —, d'où elle se restaure à son emplacement. Elle emporte ce qu'elle a
laissé : son transcript, le dossier de ses sous-agents, les sauvegardes de fichiers
de Claude Code et son environnement. Quatre garde-fous :

- **Les chemins sont composés par le serveur**, à partir de l'identifiant et du
  dossier projet que connaît l'index, vérifiés, jamais reçus de la page.
- **Une session suivie par un onglet est refusée**, et de même **une session qui a
  écrit il y a moins de deux minutes** : elle tourne peut-être dans un autre
  terminal.
- **La page montre d'abord ce qui partira**, avec les tailles, et le bouton reste
  inactif quand le serveur refuse, raison à l'appui.
- **Les refus sont relus au moment d'écrire**, pas seulement à l'aperçu.

La corbeille est atteinte par `Microsoft.VisualBasic.FileIO.FileSystem`, seule voie
.NET qui y range fichiers et dossiers comme l'Explorateur ; c'est l'absence du
fichier après coup qui fait foi, la corbeille ne rendant pas d'erreur fiable.

## Ce que le corpus vivant impose aux tests

Les sessions Claude Code en cours écrivent pendant que les tests tournent. Un test
qui exige qu'aucun transcript n'ait changé entre deux passes échoue au hasard. Les
assertions portent donc sur des propriétés stables — « le rafraîchissement réutilise
l'essentiel de l'index et coûte une fraction de l'indexation complète » — et jamais
sur l'immobilité du disque.
