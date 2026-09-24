# claude-ide

Un poste de travail Windows pour mener plusieurs chantiers Claude Code de front. Les terminaux sont dans l'application ; les panneaux, eux, ne demandent rien à Claude : ils relisent les fichiers qu'il laisse derrière lui.

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

L'installateur **n'est pas signé** : SmartScreen avertit au premier lancement.

## Disposition

Celle de ClaudeTerm, et sa règle : **gauche = le projet, centre = la session,
droite = ce qui ne dépend d'aucun projet.**

```
┌ barre de titre : (projet A) (projet B) (+)  ⑂ branche ↑1 !12 ●3   📖 ◐ ⚙      ┐
├──────────────┬──────────────────────────────────────┬─────────────────────────┤
│ fil d'Ariane │ onglets terminaux   + 📷 🖥 ✦claude    │ Process History         │
│ fichiers     │ ┌────────────────────┐┌────────────┐ │ Recherche Chantiers ⋯   │
│              │ │ terminal           ││ aperçu     │ │ filtre                  │
│              │ └────────────────────┘└────────────┘ │                         │
│ ──────────── │ dossier · mode · état                │ panneau choisi          │
│ 🔗📦✦⛓⑂  ⓘ ˅ │ ──────────────────────────────────── │                         │
│ mode courant │ 📋 📈 🖼 📄 🔀 ✎  bloc session   ⓘ ˅ │                         │
└──────────────┴──────────────────────────────────────┴─────────────────────────┘
```

Chaque projet ouvert a son onglet, ses terminaux et son navigateur de fichiers.
Les blocs à modes se replient (`˅`) et expliquent le mode courant (`ⓘ`), avec un
lien vers la page de ce guide qui le détaille. Le bouton 📖 de la barre de titre,
ou `Ctrl+Maj+H`, ouvre ce guide.

Les terminaux vivent dans le serveur, pas dans la page : un rechargement les
retrouve, rangés dans leur projet — y compris un onglet ouvert dans un worktree —,
avec les 256 derniers Ko de leur sortie rejoués.

La session regardée vient de **History**, à droite, et ne déplace pas le projet
courant : c'est une lecture, pas un déplacement. La reprendre — bouton
« reprendre », qui lance `claude --resume` — ouvre son projet, parce que là c'est
une action.

Les fichiers cachés sont écartés de la liste, `node_modules` aussi.
