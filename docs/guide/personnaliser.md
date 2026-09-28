# Personnaliser

Apparence, langue, police du terminal et raccourcis clavier.

## Thème

Sombre par défaut, clair quand le système le demande, et un bouton dans la barre
de titre qui force l'un ou l'autre — ou le sélecteur « Apparence » des
préférences. Le réglage explicite l'emporte sur le système, et le suivi est
immédiat — aucun rechargement.

Les couleurs sont des variables CSS, **y compris les seize couleurs ANSI du
terminal**. xterm peint sur un canevas et ne lit pas la feuille de style : sa
palette lui est repassée à chaque changement. Sans cela, le jaune et le cyan
réglés pour un fond noir deviennent illisibles sur blanc — c'est tout le terminal
qui suit l'apparence, pas seulement son fond.

## Couleurs de l'interface

Les préférences donnent à choisir les couleurs de l'interface, comme un thème
Slack : des presets — Clide, Bourgogne, Vert émeraude, Bleu marine, Bleu Lake
Placid, Vert princesse, Crème, Argent, Candy cola — ou ses propres couleurs.

Elles habillent la **toile** et l'**accent**, rien d'autre. La toile est le fond
de la fenêtre : la barre de titre et l'espace derrière les îlots ; elle est unie
ou en dégradé, d'une couleur à une seconde, dans la direction qu'on lui donne.
L'accent colore les boutons, l'onglet actif, les liens et l'anneau de focus. Les
îlots gardent le blanc ou le gris sombre de leur mode, pour que leur contenu se
lise pareil quelle que soit la toile, et le terminal garde ses couleurs.

Chaque mode a les siennes : une toile pensée pour des îlots blancs n'est pas celle
qu'on veut sous des îlots sombres. Un preset règle les deux d'un coup ;
« Personnaliser » ouvre une ligne par mode — accent, toile, dégradé et sa
direction — et celle du mode affiché change sous les yeux, l'autre attend qu'on y
passe. Retoucher une couleur fait quitter le preset ; en choisir un le remplace.

Ce qui est posé à même la toile — la barre de titre, les poignées entre les
colonnes — prend une encre claire ou sombre selon la toile en dessous, et non
selon le mode : une toile bourgogne sous des îlots blancs s'écrit en clair. Les
menus et fenêtres flottants ne sont pas sur la toile ; ils gardent les couleurs
des îlots.

## Langue

L'interface est en français ou en anglais, au choix dans les préférences, ou selon
la langue du système. Le français est la source, écrit tel quel dans le code : il se
lit à l'endroit où il s'affiche. L'anglais vient d'une table indexée par la chaîne
française ; une chaîne qu'elle n'a pas s'affiche en français plutôt que de
disparaître, et une phrase à trous passe par des marques `{nom}`, jamais par une
concaténation qui figerait l'ordre des mots. Ce qui est tapé dans un terminal ou
envoyé à Claude ne se traduit pas.

## Palette et raccourcis

La palette se lit à son premier caractère, comme celle de VS Code :

| Saisie | Cherche | Ouverte par |
|---|---|---|
| rien | un fichier du projet, lettres dans l'ordre (`stst` trouve `src/state/store.ts`) ; Entrée l'ouvre | `Ctrl+P` (VS Code), `Ctrl+Maj+N` (JetBrains) |
| `>` | une action de l'application, par mots, avec son raccourci ; les dernières lancées en tête | `Ctrl+Maj+P`, `F1` |
| `@` | une session, par titre, premier prompt, dossier ou branche ; Entrée la montre dans le bloc session | |
| `#` | un passage dans le texte des sessions ; Entrée l'ouvre dans Activité | `Ctrl+Maj+F` |

La recherche de fichiers passe les dépendances, les sorties de build et les caches
(`node_modules`, `dist`, `.git`…).

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

**Jeu de raccourcis.** Les préférences proposent VS Code (par défaut), JetBrains, ou
Clide seul. Un jeu ajoute ses touches à celles du tableau, sans en retirer : VS Code
apporte `Ctrl+P`, `Ctrl+B` (colonne du projet), `Ctrl+J` (bloc session),
`Ctrl+Page suiv./préc.`, `Ctrl+W`, `Ctrl+,` (préférences), ``Ctrl+` `` (revenir au
terminal) ; JetBrains `Ctrl+Maj+N`, `Alt+1`, `Alt+←/→`, `Ctrl+F4`, `Alt+F12`. Celles
que le shell ou Claude Code utilisent aussi — `Ctrl+B`, `Ctrl+P`, `Ctrl+J`… — ne
valent que hors du terminal et des champs de saisie, et l'éditeur de raccourcis les
marque ◦ : dans un terminal, elles lui restent. Dans un navigateur, `Ctrl+W` ferme
l'onglet du navigateur avant que Clide ne la voie ; elle ne vaut que dans
l'application de bureau.

## Réglages

Une seule fenêtre, ouverte par la roue de la barre de titre, celle du bas de la
barre d'onglets, ou `Ctrl+,`. Ses sections, à gauche :

- **Général** : la langue de l'interface ;
- **Apparence** : les couleurs de l'interface, et les onglets du panneau global en
  colonne ou en ligne ;
- **Terminal** : la police et sa taille, appliquées aussitôt aux terminaux ouverts ;
- **Raccourcis** : le jeu de raccourcis et chaque combinaison ;
- **Historique et coûts** : afficher ou non ce que coûtent les sessions ;
- **Modules** : couper une fonction qu'on n'utilise pas — Scripts (colonne du
  projet), Consommation (panneau global) ; elle disparaît des barres, de la palette
  et des menus, sans rien effacer ;
- **Claude Code** : le `settings.json` de Claude Code en formulaire — modèle par
  défaut, effort, interface, permissions, hooks —, qui vaut pour toutes ses
  sessions.

Les premières sont propres à Clide, rangées dans sa configuration, jamais dans
`settings.json`, qui appartient à Claude Code ; la dernière l'édite, et le dit. Le
modèle y fixe celui des nouvelles sessions ; celui de la session en cours change
par `⋯` › « Changer de modèle », dans la barre du terminal.

L'interface de Claude Code vaut `fullscreen` ou `default`. En plein écran, Claude
Code dessine lui-même son écran ; en `default`, il écrit la conversation dans
l'historique du terminal, ce qui permet de retrouver une ligne de l'activité dans
le terminal (voir [la session](./session#le-detail-d-une-ligne)).

Une page ne peut pas lister les polices installées : la liste est faite de
polices à chasse fixe courantes, dont on ne garde que celles qui changent la
largeur d'un texte par rapport à deux polices proportionnelles.
