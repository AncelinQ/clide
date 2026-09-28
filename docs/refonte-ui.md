# Refonte de l'interface — idées reprises de ClaudeTerm v2

ClaudeTerm est passé en Electron (v2, `sunstan/claude-term`, branche `main`). Plusieurs
choix d'interface y sont meilleurs que ceux de Clide ; ce document liste ce qui vaut
d'être repris et dans quel ordre.

**Licence.** ClaudeTerm est sous PolyForm Noncommercial, Clide sous MIT : on reprend des
**idées**, jamais du code. Tout est réécrit ici. Les icônes Catppuccin sont MIT : elles se
prennent à la source (`catppuccin/vscode-icons`), pas dans la copie retouchée de ClaudeTerm,
avec mention dans le README.

## Principe directeur

**À gauche le projet, au centre la session, à droite le global.** Clide le suit déjà en
grande partie ; les écarts à corriger :

| Élément | Aujourd'hui | Cible |
|---|---|---|
| Git (branche, fetch/pull/push, MR/CI) | `GitChip` dans la barre de titre | activité **Git** à gauche (projet) |
| Réglages Claude Code | onglet global `settings` dans la colonne droite | fenêtre **Réglages** (modale) |
| Préférences Clide | `PreferencesDialog` séparée | même fenêtre Réglages, sections distinctes |
| Historique | global seulement | projet à gauche, tous projets à droite (même composant, `scope`) |
| Worktrees | mode de la colonne gauche | inchangé (projet) |

---

## Lot 0 — Fondations

Petits chantiers qui conditionnent le reste.

- **Un seul registre des onglets et modes.** `state/commands.ts:59` duplique `GLOBAL_TABS`
  et oublie `usage` : la palette doit lire le registre, pas une copie.
- **Tout l'agencement persiste.** `showLeft`, `showRight`, `sessionCollapsed`,
  `sessionMode`, `globalTab`, `project.leftMode` sont perdus au rechargement ; les ranger
  dans `widths`/un objet `layout` sauvé comme le reste (`ui-state.json`).
- **Composant `Menu`** : bouton à menu déroulant **avec sous-menus**, menu contextuel au
  curseur (borné à la fenêtre, Échap / clic extérieur / perte de focus ferment), items
  icône + libellé + raccourci à droite + état danger/désactivé + séparateurs. Il sert aux
  lots 2, 3 et 5.
- **Chaque projet ne montre que ses terminaux et ses sessions.** La barre d'onglets filtre
  déjà sur `owner === activeRoot`, mais quatre chemins font fuiter un projet dans l'autre :
  - **Le terminal affiché n'est pas filtré** (`TerminalArea.tsx:481-483`) : tous les
    terminaux de tous les projets sont montés, celui qui vaut `activeTerminalId` est
    visible, et changer de projet ou en ouvrir un ne remet pas `activeTerminalId` à jour.
    Un nouveau projet montre donc le dernier terminal de l'autre, par-dessus l'accueil,
    jusqu'à ce qu'on ouvre un onglet. Pire : la capture, les images et les scripts écrivent
    dans `activeTerminalId`, donc dans ce terminal étranger. L'onglet actif se range
    **par projet** (`activeTerminalByRoot`), l'hôte n'est visible que si
    `owner === activeRoot`, et tout ce qui écrit dans un terminal passe par une fonction
    qui refuse un onglet d'un autre projet.
  - `selectedSession` est global (`store.ts:38`) : en passant sur un projet sans onglet
    Claude, le bloc du bas retombe sur la session choisie dans un autre projet
    (`TerminalArea.tsx:311-326`). La sélection se range **par projet**, et le bloc reste
    vide tant que le projet n'a rien à montrer.
  - Reprendre une session depuis l'historique global ou les chantiers
    (`global.tsx:103`, `chantiers.tsx:141`) ouvre le terminal avec `owner = activeRoot`
    alors que son `cwd` est celui de la session : l'onglet atterrit dans le projet actif.
    Le propriétaire se déduit du dossier de la session ; si ce projet n'est pas ouvert, on
    propose de l'ouvrir (ou on l'ouvre) et on bascule dessus.
  - `adopt()` (`terminals.ts:158-162`) range un terminal sans propriétaire par
    `startsWith(root)` (un projet dont le chemin est préfixe d'un autre le capte :
    `C:\Projets\clide` vs `C:\Projets\clide-docs`) puis, à défaut, dans le projet
    **actif** : un nouveau projet qu'on vient d'ouvrir hérite des orphelins. Comparer par
    segments de chemin, le plus long l'emporte, et ne jamais rattacher au projet actif
    par défaut.
  - Un test par cas (`projects × terminals × selectedSession`).
- **En-tête d'îlot unique** : icône, titre, actions, chevron de repli — le même partout,
  pour que chaque îlot se lise pareil.

## Lot 1 — Disposition

- **Séparer l'îlot du terminal et l'îlot du bas.** `TerminalArea.tsx:391-541` est un seul
  `Island` ; le bloc session y est plafonné à `max-h-[38%]` sans poignée. Deux îlots
  empilés, séparés par un `Splitter` horizontal, hauteur mémorisée, repli conservé.
- **Barres d'activité.** Une colonne d'icônes de chaque côté (le `TabRail` actuel en est
  la moitié droite) :
  - gauche : Explorateur (+ dossiers liés), Historique du projet, Skills du projet, MCP du
    projet, Scripts, Worktrees, Git ; cliquer l'icône active replie la colonne ;
  - droite : Processus, Historique, Recherche, Chantiers, Skills perso, MCP perso,
    Consommation, Notifications ; en bas, la roue des Réglages.
  Le mode « rangée d'onglets » peut rester en option ; la barre verticale devient le
  défaut. Raccourcis `Ctrl+1…9` par côté.
- **Empilement dans un îlot** : l'Explorateur empile l'arbre et les dossiers liés, MCP
  empile projet et perso, chacun avec sa hauteur mémorisée.
- **Consommation** : fusionner Usage (limites du forfait) et Coûts en une seule activité à
  deux sections, s'il n'y a pas de raison forte de les garder séparés.

## Lot 2 — Barre du terminal allégée

Aujourd'hui : `+` shell, capture, aperçu, sélecteur de modèle, bouton claude, côte à côte
(`TerminalArea.tsx:441-476`).

- **Un seul bouton `+`** (menu) :
  - Claude `Ctrl+Maj+T` ▸ sous-menu **Modèle** (défaut, Opus, Sonnet, Haiku…) ;
  - Shell `Ctrl+T` ;
  - séparateur ; Claude dans un worktree… ; Capture d'écran → prompt.
- **Un bouton `⋯` Outils** pour l'onglet actif : changer de modèle (`/model` sur l'onglet
  Claude en cours), aperçu du serveur de dev (avec la pastille verte reportée sur le
  bouton), annuler la capture.
- **L'état de l'onglet dans l'en-tête**, à droite des onglets, plutôt que dans le pied :
  Claude → mode de permission, plan, outils en cours, jetons ; shell → commande en cours ou
  « exit N ». Le pied disparaît ou ne garde que le dossier.
- **Couleur de l'icône d'onglet** = état (accent Claude, vert occupé, rouge échec, gris
  terminé) ; pastille d'attention. Compteur sur l'onglet de projet.
- **Menu contextuel d'onglet** : fermer, fermer les autres, copier le chemin, afficher dans
  l'Explorateur.

## Lot 3 — Explorateur

- **Icônes par type de fichier et de dossier** (Catppuccin, jeux Mocha/Latte selon le
  thème). Résolution : nom exact, puis extensions de la plus longue à la plus courte
  (`a.d.ts` → `d.ts` → `ts`), puis icône par défaut ; dossier ouvert / fermé.
- **Arbre dépliable** en plus (ou à la place) de la navigation par fil d'Ariane actuelle.
- **Manipuler les fichiers** comme dans l'Explorateur Windows :
  - nouveau fichier, nouveau dossier, renommer en place (`F2`) ;
  - copier, couper, coller (`Ctrl+C` / `Ctrl+X` / `Ctrl+V`), dupliquer ;
  - glisser-déposer dans l'arbre pour déplacer (`Ctrl` enfoncé = copier), y compris vers
    un dossier lié ; dépôt de fichiers venus de l'Explorateur Windows = copie ;
  - supprimer vers la **Corbeille** (le serveur sait déjà le faire pour les sessions), avec
    sélection multiple (`Ctrl` / `Maj` + clic) ;
  - collision de nom : « fichier (2).txt » ou choix remplacer / garder les deux ;
  - `Ctrl+Z` annule la dernière opération (déplacement, renommage, création ; la
    suppression se récupère dans la Corbeille).
  Côté serveur : `/api/files/create|rename|copy|move|trash`, bornées au projet et aux
  dossiers liés comme `/api/files/open`, refus de sortir de ces racines, refus d'écraser
  sans confirmation. Un onglet d'éditeur ouvert suit son fichier renommé ou déplacé.
  Copier vers le presse-papiers de Windows (pour coller dans l'Explorateur) : plus tard,
  via Electron seulement.
- **Double-clic = ouvrir dans Clide** (lot 4). « Ouvrir avec l'application par défaut » et
  « Afficher dans l'Explorateur » restent dans le menu contextuel.

## Lot 4 — Éditeur intégré

Aujourd'hui, ouvrir passe par `explorer.exe` (`server/src/platform/open.ts:32`), donc par
l'application associée — VS Code. Cible : les fichiers s'ouvrent dans Clide.

- **Monaco** (MIT), une instance pour tous les onglets, un modèle par fichier (historique
  d'annulation propre à chacun), onglets fichiers mêlés aux onglets terminal.
- **API** : `GET /api/files/read` (contenu + mtime), `POST /api/files/write` avec garde sur
  le mtime lu (refus si le fichier a changé depuis), surveillance pour signaler un
  changement sur disque (bandeau « Recharger »). Bornée au projet et aux dossiers liés,
  comme `/api/files/open`.
- **Modifié = contenu différent du dernier enregistré** (annuler jusqu'à l'état enregistré
  efface la marque) ; `Ctrl+S`, enregistrement à la perte de focus en option, confirmation
  à la fermeture.
- **Markdown** : code / côte à côte / aperçu. **Images** dans un onglet image.
- **Onglets de diff** (Monaco côte à côte) : le mode Fichiers de la session et Git y
  ouvrent leurs diffs.
- Barre de recherche / remplacement (`Ctrl+F`, `Ctrl+R`), thème Monaco dérivé des
  couleurs de Clide, raccourcis de Clide rebranchés dans Monaco.
- Préférences : police, taille, retour à la ligne, minimap, enregistrement auto.

## Lot 5 — Git

- **Activité Git à gauche**, deux vues empilées :
  - **Modifications** : arbre à cases à cocher (conflits / modifiés / non versionnés),
    cases de groupe et de dossier à trois états, regroupement par dossier optionnel ;
    message multiligne, « Amender », **Commit (N)** et **Commit + push** ; menu : diff,
    ouvrir, `git add`, retirer de l'index ;
  - **Branches** : locale (↑↓, amont, « supprimée »), distantes par remote ; changer,
    nouvelle depuis…, pull, push, renommer, supprimer sans forcer.
- **Onglet Commit dans l'îlot du bas**, à côté de Plan / Activité / Fichiers — voir la
  décision 1. Il se marie avec **Rédaction** (`WriteupPanel`) : le message rédigé depuis la
  session remplit directement le champ de commit.
- **Onglet Commits** (journal) : liste avec graphe des branches, fichiers du commit, détail,
  diff au double-clic.
- **Popover de branche** sous l'en-tête : actions, récentes, locales, distantes, recherche.
  Remplace le menu du `GitChip`, dont la pastille (branche, ↑↓, MR/CI) reste dans l'en-tête
  de l'activité Git.
- Ce qui existe déjà et qu'on garde : MR/PR et CI via `glab`/`gh`, pull multi-dépôts,
  push forcé sous bail, worktrees.

## Lot 6 — Modules (le concept de plugins)

Git est aujourd'hui éparpillé (`GitChip`, `BranchDialog`, `GitSync`, routes mêlées aux
autres dans `routes.ts`). Proposition : un **contrat de module interne** avant tout
système de plugins tiers.

- Un module déclare ce qu'il apporte : activités (côté, icône, titre), vues de colonne ou
  du bas, commandes (palette + raccourcis), entrées de menu contextuel, réglages, et côté
  serveur ses routes sous `/api/<module>/…`.
- Le shell de l'application ne connaît plus Git : il lit le registre des modules.
- Candidats, dans l'ordre : **Git**, **Consommation** (usage + coûts), **Chantiers**,
  **Aperçu** du serveur de dev, **Schéma**, **Rédaction**, **Scripts** (étendu à make,
  cargo, go, python, scripts shell comme le Lanceur de ClaudeTerm).
- Réglages › Modules : activer / désactiver chacun ; un module désactivé disparaît des
  barres, des menus et de la palette.
- Plugins tiers (bac à sable, permissions, catalogue, sha256) : **plus tard**, seulement si
  un besoin réel apparaît. Le contrat interne en est la première moitié.

## Lot 7 — Réglages en fenêtre

Une modale unique (roue en bas de la barre droite, `Ctrl+,`), sections à gauche, groupes
de lignes libellé + aide + contrôle à droite :

- **Général** : langue ; mises à jour (si on en ajoute).
- **Apparence** : thème, couleurs de l'interface (`LookPicker`), disposition des onglets.
- **Éditeur** : police, taille, retour à la ligne, minimap, enregistrement auto.
- **Terminal** : police, taille.
- **Raccourcis** : `ShortcutsEditor` existant, avec détection des conflits par portée
  (général / éditeur) et réinitialisation ligne par ligne.
- **Historique et coûts** : **afficher les coûts** (décision 3).
- **Claude Code** : `SettingsForm` + éditeur JSON actuels, sortis de la colonne droite.
- **Notifications** : installation des hooks, notifications système, compteur de la barre
  des tâches.
- **Modules** : lot 6.

## Lot 8 — Skills

Clide fait déjà ce que ClaudeTerm ne fait pas (import, copie entre portées, dépôt de
fichier). À reprendre :

- **Badge de mode** : manuel (`disable-model-invocation`), auto (`user-invocable: false`),
  auto + `/`.
- **Insérer `/nom `** dans le prompt de l'onglet Claude actif.
- **Créer** : formulaire en ligne (nom en minuscules-tirets, description) qui écrit le
  squelette et **ouvre le fichier dans l'éditeur** (lot 4) ; double-clic = ouvrir dans
  l'éditeur, à la place de l'éditeur en ligne.
- Skills des dossiers liés dans la liste du projet, avec un badge « lié ».

## Lot 9 — Raccourcis façon VS Code

Clide a déjà une palette (`Ctrl+Maj+P`, `CommandPalette.tsx`) et des raccourcis
modifiables. À rapprocher de VS Code :

- **Jeu de raccourcis VS Code par défaut** (ClaudeTerm a pris celui de JetBrains) :
  `Ctrl+P` ouvrir un fichier, `Ctrl+Maj+P` palette, `Ctrl+B` / `Ctrl+Alt+B` replier les
  colonnes, `Ctrl+J` l'îlot du bas, `` Ctrl+Maj+` `` nouveau terminal, `Ctrl+Tab` onglet
  suivant, `Ctrl+W` fermer, `Ctrl+,` réglages, et côté éditeur `Ctrl+D`, `Alt+↑/↓`,
  `Ctrl+/`, `Ctrl+G`, `F2`… Réglages › Raccourcis propose un **préréglage** : VS Code
  (défaut) ou JetBrains, les surcharges de l'utilisateur s'appliquant par-dessus.
- **Palette à préfixes**, comme VS Code : sans préfixe → fichiers du projet (`Ctrl+P`),
  `>` → commandes, `@` → sessions de l'historique, `/` → skills et prompts enregistrés
  (lot 10), `#` → recherche plein texte. Commandes récentes en tête.
- Chaque commande de la palette affiche son raccourci, et un raccourci s'assigne depuis la
  palette.
- Les commandes des modules (lot 6) entrent dans la palette automatiquement.

## Lot 10 — Prompts enregistrés

Taper `/sc:brainstorm` ou une consigne récurrente à chaque fois coûte. Des **prompts
enregistrés**, envoyés à l'onglet Claude actif :

- Un prompt = libellé, texte (une commande `/sc:brainstorm`, ou plusieurs lignes), portée
  **projet** ou **perso**, et au choix : **insérer** dans le prompt (on complète avant
  d'envoyer) ou **envoyer** directement.
- Variables simples dans le texte : `{sélection}` (sélection de l'éditeur), `{fichier}`
  (fichier actif), `{branche}`, `{saisie}` (demandée au lancement).
- Accès : barre de pastilles repliable au-dessus de l'îlot du bas ou dans le menu `+` /
  `⋯` du terminal, palette avec le préfixe `/`, et un **raccourci assignable** par prompt.
- **Suggestions tirées des transcripts** : les commandes `/…` que tu tapes le plus souvent,
  comptées dans l'historique, avec une proposition de les enregistrer en un clic.
- Rangement : les prompts perso dans le dossier de données de Clide, ceux du projet dans
  `<projet>/.claude/clide-prompts.json` (partageable avec l'équipe si on le versionne).
- Gestion dans l'activité Skills (section « Prompts »), puisque les deux répondent à la
  même question : que peut-on déclencher d'un geste ?

## Lot 11 — Scripts du projet et des dossiers liés, en parallèle

`ScriptsPanel` liste déjà les scripts du projet et ceux des dossiers liés
(« lié {name} »). Un lancement réutilise un onglet shell inactif : pratique pour un
script, gênant pour en tenir plusieurs en route.

- **Un onglet par script lancé**, nommé `projet › script` (`api › dev`, `front › dev`),
  réutilisé au relancement du même script ; l'icône porte l'état (en cours, échec, fini).
- **Lancer plusieurs scripts d'un coup** : cases à cocher dans la liste, bouton « Lancer
  (N) », chacun dans son onglet, dans le dossier de son projet.
- **Groupes enregistrés** : « Tout démarrer » = `api › dev` + `front › dev` +
  `design-system › storybook`, rangés dans `<projet>/.claude/clide-scripts.json`, lancés
  depuis la liste, la palette (`>`) ou un raccourci ; « Tout arrêter » coupe le groupe.
- **Vue d'ensemble** en tête de la liste : ce qui tourne, depuis quand, sur quel port (la
  détection de ports de l'aperçu sert déjà à ça), avec arrêter / relancer / aller à
  l'onglet.
- **Au-delà de npm** (comme le Lanceur de ClaudeTerm) : make, cargo, go, python, scripts
  shell et PowerShell — à faire dans le module Scripts du lot 6.
- Les onglets de scripts se rangent dans un sous-groupe replié de la barre d'onglets pour
  ne pas noyer les onglets Claude.

## Lot 12 — Voir le navigateur que Claude pilote

Dans l'aperçu, une source « Navigateur de Claude » à côté des serveurs de
développement : ce que le MCP navigateur de Claude affiche, en direct.

- **Claude in Chrome** (l'extension) pilote le Chrome de l'utilisateur : une fenêtre
  qu'il voit déjà, et qu'une page ne peut ni capturer ni incruster. Rien à faire.
- **Un MCP qui parle CDP** (`chrome-devtools`, `playwright`) : Clide lance un Chromium
  dédié avec un port de débogage sur `127.0.0.1`, et le MCP s'y branche
  (`--browserUrl` / `--cdp-endpoint`, posé par `claude mcp add` au niveau du projet,
  jamais en écrivant `~/.claude.json`). L'aperçu reçoit les images de
  `Page.startScreencast` par le serveur de Clide, et peut relayer clics et frappes
  (`Input.dispatch*`) pour reprendre la main.
- Jamais le port de débogage d'Electron lui-même : il donnerait la main sur toute
  l'application, jeton compris.
- Coût : un processus Chromium de plus et le flux d'images, seulement quand l'aperçu
  montre cette source.

## Lot 13 — Erreurs et TODO du projet

Idée reprise de ClaudeTerm 2.0.6. Deux onglets du bloc du bas, portés par un module
« Diagnostics » :

- **Erreurs** : le `tsc` du projet (chaque `tsconfig` qui compile) et ESLint,
  lancés en arrière-plan, à l'ouverture du projet, à l'enregistrement d'un fichier
  et à la fin de chaque tour de Claude (l'event `Stop` des hooks), une file par
  projet pour ne pas les empiler. Les erreurs sont groupées par fichier ; un clic
  ouvre le fichier à la ligne dans l'éditeur, qui porte aussi les marqueurs. Les
  erreurs sémantiques de Monaco restent coupées : il ne voit pas le projet comme
  `tsc`.
- **TODO** : les `TODO`, `FIXME`, `HACK`, `XXX` des commentaires et du Markdown,
  groupés par fichier, un clic à la ligne.
- Sur chaque entrée : **Corriger avec Claude**, qui tape dans l'onglet Claude du
  projet un prompt désignant le fichier, la ligne et le message, sans l'envoyer
  (un prompt enregistré en mode `insert`, lot 10).
- Côté serveur : le binaire local du projet (`node_modules/.bin/tsc`, `eslint`),
  sortie lue en format machine (`tsc --pretty false`, `eslint -f json`), chemins
  normalisés sous Windows. Rien ne se lance sans l'outil installé dans le projet.

## Lot 14 — Tests du projet

Idée reprise de ClaudeTerm 2.0.6. Un onglet **Tests** dans la vue Scripts (ou son
propre module) :

- les suites Vitest, Jest et pytest de chaque package, et les tests lus dans les
  fichiers (`describe` / `it` / `test`, `def test_`) ;
- lancer tout, un fichier ou un seul test, dans l'onglet de script du package
  (lot 11), avec un rapport machine écrit dans les données de Clide
  (`--reporter=json`, `--json`, `--junitxml`), relu à la fin de la commande ;
- statuts et nombre d'échecs par fichier et par test ; **Corriger avec Claude** sur
  un échec, prompt tapé et non envoyé ;
- dans l'éditeur, un bouton dans la marge de chaque test, coloré selon son dernier
  résultat.

## Lot 15 — Lancer depuis la marge de l'éditeur

Idée reprise de ClaudeTerm 2.0.6. Dans Monaco, un bouton lancer / arrêter dans la
marge sur chaque ligne qui se lance : un script de `package.json`, une cible de
Makefile, une commande shell d'un bloc de code Markdown (`sh`, `bash`,
`powershell`, `ps1`), un script `.ps1` ou `.sh` ouvert. Il passe par `runScript`
(lot 11) : même onglet par script, même arrêt, même vue « En cours ».

## Lot 16 — Onglets déplaçables

Réordonner au glisser-déposer les onglets de projet de la barre de titre et les
onglets du centre (terminaux, fichiers, diffs), l'ordre gardé dans l'état
sauvegardé (`projects` et `openFiles` sont déjà des listes ordonnées).

## Lot 17 — Rechercher dans les fichiers du projet

Une vue **Recherche** dans la colonne du projet, à côté de l'explorateur : un texte
ou une expression régulière, avec casse, mot entier et filtres de chemins (à
inclure, à exclure), sur les fichiers que connaît la palette (dépendances, sorties
de build et caches passés). Les résultats sont groupés par fichier, la ligne
trouvée surlignée ; un clic ouvre le fichier à la ligne. La commande « Rechercher
dans les fichiers » (`Ctrl+Shift+F`) y mène, avec le texte choisi dans l'éditeur.

## File d'implémentation

Toute la file est faite et fusionnée (#34 à #45), dans l'ordre ci-dessous ; les
MR 26 et 27 ont repris ce que les MR 16 à 25 avaient laissé.

1. MR 16 — Tests du projet (lot 14, sans la marge de l'éditeur).
2. MR 17 — Lancer depuis la marge de l'éditeur (lot 15, et la marge des tests du
   lot 14).
3. MR 18 — Onglets déplaçables (lot 16).
4. MR 19 — Rechercher dans les fichiers du projet (lot 17).
5. MR 20 — Navigateur de Claude dans l'aperçu (lot 12).
6. MR 21 — Historique : ouvrir le transcript `.jsonl` d'une session dans
   l'éditeur, en lecture. Reprendre une session reste un bouton : le double-clic
   ouvre, il ne lance pas.
7. MR 22 — Processus : « aller à l'onglet » depuis un processus Claude qui tourne
   dans un onglet de Clide.
8. MR 23 — Écran d'accueil, sans projet ouvert : projets récents et nombre de
   sessions de chacun.
9. MR 24 — Invites de saisie avec suggestions en pastilles (nom de branche, rôle
   d'un lien…).
10. MR 25 — Thèmes au format VS Code, chargés tels quels : les couleurs de Clide
    étaient déjà des jetons nommés (variables CSS de l'interface et du terminal) ;
    les `colors` et `tokenColors` d'un thème y sont traduits, et vers Monaco.
11. MR 26 — Vue Tests, le reste du lot 14 : un filtre (nom de test ou de fichier,
    et « échecs seulement »), et le clavier comme dans l'explorateur — flèches pour
    se déplacer, `→` / `←` pour déplier et replier, Entrée pour lancer, Espace
    pour ouvrir le test à sa ligne.
12. MR 27 — Le `.gitignore` respecté : la palette et la recherche dans les fichiers
    ne listent plus ce que git ignore (dépôt git : `git ls-files --cached --others
    --exclude-standard`), la liste fixe de dossiers restant la règle hors dépôt.

## Autres idées à reprendre

Toutes sont passées dans la file d'implémentation (MR 21 à 25).

## Ordre proposé

| Lot | Dépend de | Taille |
|---|---|---|
| 0 Fondations | — | S |
| 1 Disposition | 0 | M |
| 2 Barre du terminal | 0 | S |
| 7 Réglages en fenêtre (+ afficher les coûts) | 0 | S |
| 3 Explorateur (icônes, arbre, manipulation des fichiers) | 0 | M |
| 4 Éditeur intégré | 3 | L |
| 9 Raccourcis VS Code et palette | 0 | S |
| 10 Prompts enregistrés | 2, 9 | S |
| 11 Scripts en parallèle, groupes | 2 | M |
| 12 Navigateur de Claude dans l'aperçu | 6 (module Aperçu) | M |
| 13 Erreurs et TODO (tsc, ESLint) | 8, 10 | M |
| 14 Tests du projet | 11, 13 | M |
| 15 Lancer depuis la marge de l'éditeur | 10, 11 | S |
| 16 Onglets déplaçables | 3 | S |
| 17 Rechercher dans les fichiers | 3, 4 | M |
| 8 Skills | 4 | S |
| 5 Git | 1, 4 | L |
| 6 Modules | 5 | M |

Le lot 6 peut aussi précéder le lot 5 : Git devient alors le premier module plutôt que
d'être extrait après coup. Plus propre, mais le gain visible arrive plus tard.

## Décisions à prendre

1. **Où vit le commit ?** ClaudeTerm met le panneau de commit dans l'activité Git à gauche
   et le **journal** des commits en bas. Mettre le commit en bas le rapproche de la session
   (Fichiers, Rédaction) ; le mettre à gauche le rattache au projet. Proposition : commit en
   bas, journal en bas aussi, branches à gauche.
2. **Plugins : modules internes seulement, ou ouverture aux tiers ?** Proposition : internes
   d'abord.
3. **Afficher les coûts : où ?** Dans l'historique seulement, ou aussi dans Activité et
   l'en-tête du terminal ? Proposition : un réglage unique qui les masque partout.
4. **Explorateur : arbre ou navigation par dossier ?** Proposition : arbre, comme
   l'Explorateur de fichiers et les IDE.
