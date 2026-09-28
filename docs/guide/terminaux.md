# Terminaux

Chaque projet a ses onglets de terminal : des shells PowerShell, et des onglets Claude. Taper `claude` dans un shell en fait un onglet Claude le temps de la session.

La barre d'onglets ne porte que deux menus. `+` ouvre un onglet — Claude, Claude
avec un modèle choisi, un shell — ou lance la capture d'écran vers le prompt ;
chaque entrée affiche son raccourci. `⋯` porte sur l'onglet actif : changer le
modèle de la session Claude, ouvrir l'aperçu du serveur de développement, copier le
dossier de l'onglet, fermer les autres. Sur un onglet Claude, `⋯` affiche le modèle
en cours à sa place. Un clic droit sur un onglet le ferme, ferme les autres ou copie
son dossier.

## Images vers le prompt

Claude Code lit une image désignée par son chemin, pas un contenu collé. Une image
collée dans un terminal, ou déposée sans fichier derrière elle — tirée d'une page
web, ou n'importe quel fichier dans un navigateur, qui n'en livre jamais le chemin —
est donc d'abord enregistrée dans le dossier `drops` de l'application, et c'est son
chemin qui est tapé. Elle part brute, hors du corps JSON des autres routes, dont la
limite est pensée pour des réglages ; seules les images passent, jusqu'à 20 Mo.

« Capture d'écran vers le prompt », dans le menu `+`, ouvre l'outil Capture d'écran de Windows
(`ms-screenclip:`), qui dépose son image dans le presse-papiers et non dans un
fichier. Le serveur relève le compteur de séquence du presse-papiers avant de
l'ouvrir, puis attend qu'il change avec une image : une image copiée plus tôt ne
passe pas pour la capture, et rien n'est jamais écrit dans le presse-papiers.

Une annulation ne dépose rien. Pour ne pas attendre le délai de deux minutes, le
serveur suit les processus de l'outil apparus après son ouverture, et s'arrête
quand ils ont tous disparu sans image — un temps de grâce laisse arriver une image
juste après la fermeture. Un outil qui reste en mémoire après coup n'est jamais pris
pour une annulation : pendant une capture, un bouton à côté de `+` l'annule dans
tous les cas.

## Changer de modèle

Sur un onglet Claude, `⋯` montre le modèle de la session et « Changer de modèle »
en change : le choix est tapé dans la session sous la forme `/model <id>` ; Claude
travaille-t-il, la commande part dans sa file et s'applique au tour suivant.
« Claude avec le modèle », dans `+`, ouvre un nouvel onglet avec
`claude --model <id>`.

Les modèles viennent du catalogue que Claude Code garde en cache pour le compte
(`~/.claude/cache/model-catalog`) : les principaux d'abord, avec leur description,
les versions précédentes dans un sous-menu. Ce cache n'est pas documenté : absent
ou d'une autre forme, il cède la place aux alias `opus`, `fable`, `sonnet` et
`haiku`, que Claude Code accepte toujours.

C'est le modèle de la session en cours. Celui des nouvelles sessions se règle dans
Réglages › Claude Code.

Le bouton `⋯` porte un point vert quand un serveur de développement tourne ; l'aperçu
ouvert est coché dans son menu. Aucun bouton de la barre n'est coloré au repos, ce
qui le ferait croire enfoncé.

## Ouvrir un fichier

L'explorateur est un arbre : un clic sur un dossier le déplie, un clic sur un
fichier le sélectionne (`Ctrl` et `Maj` pour en prendre plusieurs), un double-clic
l'ouvre dans l'éditeur de Clide (voir plus bas) ; « Ouvrir avec l'application par
défaut » reste dans le menu contextuel. Les icônes sont celles de Catppuccin pour VS
Code, dans la palette Latte en clair et Mocha en sombre. Le menu contextuel insère
le chemin dans le prompt, montre le fichier dans l'Explorateur ou copie son chemin.

On y manipule les fichiers comme dans l'Explorateur de Windows, l'arbre ayant le
focus :

| Geste | Effet |
|---|---|
| boutons de l'en-tête, menu contextuel | nouveau fichier, nouveau dossier, dans le dossier sélectionné |
| `F2` | renommer sur place, le nom sélectionné sans son extension |
| `Ctrl+C` · `Ctrl+X` · `Ctrl+V` | copier, couper, coller dans le dossier sélectionné |
| Dupliquer (menu) | une copie à côté, nommée `nom (2)` |
| glisser sur un dossier | déplacer ; `Ctrl` enfoncé, copier ; un fichier venu de l'Explorateur (application de bureau) est copié |
| `Suppr` | mettre à la corbeille de Windows |
| `Ctrl+Z` | annuler la dernière création, le dernier renommage, déplacement ou copie |
| `↑` `↓` `←` `→` · Entrée · Espace | se déplacer, replier, déplier · ouvrir · aperçu |

Rien n'est écrasé : si un nom est pris, Clide demande — remplacer, qui envoie
l'existant à la corbeille, garder les deux, ou annuler ; coller à côté de
l'original en fait une copie `nom (2)` sans demander. Un projet ouvert ne se met
pas à la corbeille, et rien ne sort des projets ouverts, de leurs dossiers liés et
de leurs worktrees : le serveur vérifie chaque chemin. Ce que Windows exécuterait au lieu de
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

Un fichier glissé de l'explorateur sur un terminal y écrit son chemin, dans le navigateur
comme dans l'application de bureau. Glissé depuis l'Explorateur, il ne le fait que
sous Electron : un navigateur livre le contenu d'un fichier déposé, jamais son
emplacement.

## L'éditeur

Un fichier s'ouvre dans un onglet, à côté des terminaux du projet : double-clic dans
l'explorateur, `Ctrl+P` dans la palette, clic sur un chemin du mode Fichiers de la
session (`Maj`+clic pour l'application par défaut). C'est l'éditeur de VS Code,
Monaco, chargé à la première ouverture : coloration, recherche (`Ctrl+F`),
remplacement (`Ctrl+H`), multicurseur, et un historique d'annulation propre à
chaque fichier.

- **Modifié** : le nom de l'onglet passe en italique et sa croix devient un point,
  tant que le texte diffère du dernier enregistrement ; `Ctrl+S` enregistre. Fermer
  un fichier modifié demande : enregistrer, ne pas enregistrer, ou y rester.
- **Changé sur disque** : Claude, git ou un autre éditeur a pu écrire le fichier.
  Clide le revérifie quand on revient dans l'éditeur. Non modifié ici, il se relit
  sans rien demander ; modifié des deux côtés, un bandeau propose de recharger ou
  d'écraser, et `Ctrl+S` refuse d'écraser sans ce choix.
- **Fins de ligne** : un fichier en CRLF reste en CRLF, son BOM éventuel aussi.
- **Markdown** : code, côte à côte ou aperçu, par les boutons en haut à droite.
- **Images** : montrées telles quelles ; un binaire ou un fichier de plus de 5 Mo
  s'ouvre avec l'application par défaut.

Les fichiers ouverts reviennent au lancement suivant. Un fichier renommé ou déplacé
dans l'explorateur garde son onglet et ses modifications. Ouvrir un terminal ou
cliquer son onglet le remet devant l'éditeur.

## Largeur des colonnes

Les poignées entre les colonnes se tirent à la souris, et un double-clic rend la
largeur par défaut (290 px pour le projet, 340 pour le panneau global). La
poignée entre le terminal et l'aperçu règle la part de l'aperçu. Les largeurs
sont gardées d'une ouverture à l'autre ; le terminal garde toujours 420 px entre
les colonnes, et 240 à côté de l'aperçu, et une fenêtre qui rétrécit prend sur
les colonnes latérales plutôt que sur lui.
