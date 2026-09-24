# Terminaux

Chaque projet a ses onglets de terminal : des shells PowerShell, et des onglets Claude. Taper `claude` dans un shell en fait un onglet Claude le temps de la session.

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

## Largeur des colonnes

Les poignées entre les colonnes se tirent à la souris, et un double-clic rend la
largeur par défaut (290 px pour le projet, 340 pour le panneau global). La
poignée entre le terminal et l'aperçu règle la part de l'aperçu. Les largeurs
sont gardées d'une ouverture à l'autre ; le terminal garde toujours 420 px entre
les colonnes, et 240 à côté de l'aperçu, et une fenêtre qui rétrécit prend sur
les colonnes latérales plutôt que sur lui.
