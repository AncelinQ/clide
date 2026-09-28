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
passe pas pour la capture, et rien n'est jamais écrit dans le presse-papiers.

Une annulation ne dépose rien. Pour ne pas attendre le délai de deux minutes, le
serveur suit les processus de l'outil apparus après son ouverture, et s'arrête
quand ils ont tous disparu sans image — un temps de grâce laisse arriver une image
juste après la fermeture. Un outil qui reste en mémoire après coup n'est jamais pris
pour une annulation : pendant une capture, un second clic sur le bouton l'annule
dans tous les cas.

## Changer de modèle

Le bouton « Modèle », à côté de « claude », montre le modèle de la session de
l'onglet et en change. Sur un onglet Claude, le choix est tapé dans la session sous
la forme `/model <id>` ; Claude travaille-t-il, la commande part dans sa file et
s'applique au tour suivant. Sans onglet Claude, il en ouvre un avec
`claude --model <id>`.

Les modèles viennent du catalogue que Claude Code garde en cache pour le compte
(`~/.claude/cache/model-catalog`) : les principaux d'abord, avec leur description,
les versions précédentes dans un sous-menu. Ce cache n'est pas documenté : absent
ou d'une autre forme, il cède la place aux alias `opus`, `fable`, `sonnet` et
`haiku`, que Claude Code accepte toujours.

C'est le modèle de la session en cours. Celui des nouvelles sessions se règle dans
le panneau global, onglet Réglages.

Le bouton d'aperçu porte un point vert quand un serveur de développement tourne ;
seul l'aperçu ouvert a un fond. Aucun bouton de la barre n'est coloré au repos, ce
qui le ferait croire enfoncé.

## Ouvrir un fichier

Dans le Finder, un clic sélectionne et un double-clic ouvre avec l'application
par défaut ; le menu contextuel insère le chemin dans le prompt, montre le fichier
dans l'Explorateur ou copie son chemin. Ce que Windows exécuterait au lieu de
l'ouvrir — `.cmd`, `.ps1`, et `.js`, confié par défaut à Windows Script Host —
est montré dans l'Explorateur à la place : un double-clic dans un dépôt ne lance
rien. L'ouverture passe par `explorer.exe`, sans shell pour relire le chemin.

Un dossier où des sessions Claude ont été lancées porte une marque ✳ : Claude
Code range ses transcripts par dossier de lancement, la marque dit que le sien
existe. « Claude ici » y reprend le fil.

L'œil de l'en-tête affiche les fichiers cachés — `.env`, `.claude`, `.gitignore` —,
estompés pour qu'on les reconnaisse ; le choix est gardé. `.git` et `node_modules`
restent écartés dans tous les cas : ce n'est pas une affaire de discrétion, mais de
volume.

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
