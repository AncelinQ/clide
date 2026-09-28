# Clide

Un poste de travail Windows pour mener plusieurs chantiers Claude Code de front. Les terminaux sont dans l'application ; les panneaux, eux, ne demandent rien à Claude : ils relisent les fichiers qu'il laisse derrière lui.

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

**Dans un navigateur.** `clide.cmd` ou `pnpm start` : même application, sans
fenêtre native ni glisser-déposer externe. Rien n'est dupliqué entre les deux.

L'installateur **n'est pas signé** : SmartScreen avertit au premier lancement.

## Disposition

Celle de ClaudeTerm, et sa règle : **gauche = le projet, centre = la session,
droite = ce qui ne dépend d'aucun projet.**

```
┌ barre de titre : (projet A) (projet B) (+)  ⑂ branche ↑1 !12 ●3   📖 ◐ ⚙          ┐
├──┬──────────────┬──────────────────────────────────────┬────────────────────┬──┤
│🗂│ fichiers     │ onglets terminaux               + ⋯   │ filtre             │⚙ │
│🕘│              │ ┌────────────────────┐┌────────────┐ │                    │🕘│
│📦│              │ │ terminal           ││ aperçu     │ │ panneau choisi     │🔍│
│✦ │              │ └────────────────────┘└────────────┘ │                    │▦ │
│⛓ │ ──────────── │ dossier · mode · état                │                    │✦ │
│⑂ │ DOSSIERS LIÉS├──────── poignée ─────────────────────┤                    │⛓ │
│  │              │ 📋 📈 🖼 📄 🔀 ✎  bloc session   ⓘ ˅ │                    │… │
└──┴──────────────┴──────────────────────────────────────┴────────────────────┴──┘
```

Deux barres d'icônes bordent la fenêtre. À gauche, les vues du projet :
Explorateur (ses fichiers, et dessous ses dossiers liés), Historique du projet,
Scripts, Skills, MCP, Worktrees. À droite, les onglets du panneau global. Cliquer
une icône ouvre sa vue ; cliquer celle qui est ouverte replie la colonne, et la
barre reste là pour la rouvrir. Au centre, le terminal et le bloc session sont
deux îlots : la poignée qui les sépare règle la hauteur du bloc, un double-clic la
remet par défaut. Largeurs, hauteurs, colonnes repliées et vue de chaque projet
reviennent au lancement suivant. Le menu `⋯` du panneau global peut remettre ses
onglets en ligne, au-dessus du panneau.

Chaque projet ouvert a son onglet, ses terminaux et son navigateur de fichiers.
Sa pastille porte deux comptes : les onglets qui attendent une réponse, et, en
vert, les Claude en cours.
Un projet s'ouvre par le `+` de la barre de titre, ou par le bouton « Ouvrir un
projet » des îlots vides ; son dossier se tape, ou se choisit par « Parcourir… »
dans la fenêtre de sélection de Windows — ouverte par Electron dans l'application
de bureau, par le serveur local dans un navigateur, dont la page ne voit jamais le
chemin d'un dossier. Choisir un dossier l'ouvre aussitôt. La fenêtre propose aussi
les dossiers **récents** : ceux où des sessions Claude ont tourné, du plus récent
au plus ancien, hors des projets déjà ouverts.

Revenir sur un projet, par sa pastille ou `Alt+Page suiv.`, ramène l'onglet qu'on
y regardait, ou son plus récent : le bloc session et le pied de la zone décrivent
ce projet, pas l'onglet de l'autre. Les projets ouverts, le projet actif et les
préférences reviennent au lancement suivant. Le serveur les garde dans `ui-state.json` des données de l'application
plutôt que dans le seul `localStorage`, propre à une origine : le port change d'un
lancement à l'autre, et l'application rouvrirait sans rien. Les dossiers liés
reviennent avec leur projet, qui les porte.
Le bloc session se replie (`˅`) ; lui et les vues de la colonne du projet disent à
quoi ils servent (`ⓘ`), avec un lien vers la page de ce guide qui les détaille. Le bouton 📖 de la barre de titre,
ou `Ctrl+Maj+H`, ouvre ce guide.

Les terminaux vivent dans le serveur, pas dans la page : un rechargement les
retrouve, rangés dans leur projet — y compris un onglet ouvert dans un worktree —,
avec les 256 derniers Ko de leur sortie rejoués.

La session regardée vient de **History**, à droite, et ne déplace pas le projet
courant : c'est une lecture, pas un déplacement. La reprendre — bouton
« reprendre », qui lance `claude --resume` — ouvre son projet, parce que là c'est
une action.

Les fichiers cachés sont écartés de la liste, sauf à les afficher par l'œil de son
en-tête ; `node_modules` et `.git` le sont toujours.
