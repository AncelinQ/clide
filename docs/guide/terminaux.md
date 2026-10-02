# Terminaux

Chaque projet a ses onglets de terminal : des shells PowerShell, et des onglets Claude. Taper `claude` dans un shell en fait un onglet Claude le temps de la session.

La barre d'onglets porte le menu `+` : il ouvre un onglet — Claude, Claude avec un
modèle choisi, un shell — ou lance la capture d'écran vers le prompt ; chaque entrée
affiche son raccourci. Un clic droit sur un onglet le renomme, le ferme, ferme les
autres ou copie son dossier.

Pour distinguer deux onglets Claude, on les nomme : double-clic sur l'onglet, ou
clic droit › Renommer, puis Entrée (Échap annule). Le nom tient tant que l'onglet
vit, au fil des sessions `claude` qu'il accueille et des rechargements de la page ;
un nom vide lui rend le sien, `claude` ou `shell`.

Sur un onglet Claude, une petite barre flottante occupe le coin haut droit du
terminal, comme les modes d'affichage d'un Markdown : le modèle et l'effort de la
session, les prompts enregistrés, les serveurs de développement. Elle reste
discrète tant que la souris ne la survole pas, et disparaît sur un shell ou un
fichier ouvert. Sur un script, elle porte ■ pour l'arrêter et ▷ ou ↻ pour le
relancer.

## L'onglet Scripts

Les scripts n'ouvrent pas d'onglet dans la barre : ils se rangent sous l'onglet
**Scripts**, épinglé en tête, comme les fenêtres Run et Services de WebStorm. Y vont
les scripts lancés depuis la vue Scripts, ses groupes et `installer`, le ▷ de la
marge, et les suites de la vue Tests. Les onglets Claude, les shells et les
fichiers restent dans la barre.

- **L'onglet épinglé** ne se range pas au glisser. Grisé tant qu'aucun script n'a
  été lancé dans le projet, il affiche ensuite le nombre de scripts en cours ; son
  icône passe à l'ambre quand l'un tourne, au rouge quand l'un a échoué. Un clic
  montre les scripts à la place du terminal, un second rend l'onglet ou le fichier
  qu'on regardait ; `Ctrl+Maj+X` fait de même. Son clic droit propose « Tout
  arrêter » et « Fermer les scripts finis ».
- **La liste**, à gauche du terminal, groupe les scripts par nature, lue à leur
  nom : Serveurs (`dev`, `start`, `serve`, `preview`, `storybook`…), Tests, Build,
  Vérifications (`lint`, `typecheck`, `format`…), Installation, Autres. Un nom
  composé prend la première nature reconnue dans cet ordre-là : Tests, Build,
  Vérifications, Installation, Serveurs — `build-storybook` est un build,
  `test:watch` un test. Avec un seul groupe, la liste est plate ; sinon chaque
  en-tête se replie, et garde replié la couleur de ses scripts : un serveur qui
  échoue se voit sans déplier. Sa largeur se tire à la souris, et un double-clic
  la rend.
- **Une ligne** montre l'état du script, son nom et l'adresse qu'annonce un
  serveur de développement. En cours, ■ l'arrête (Ctrl+C) et ↻ l'arrête puis le
  relance ; fini, ▷ le relance et × ferme son terminal. Relancer retape la
  commande du dernier lancement, jamais la dernière ligne tapée dans le shell ;
  une suite de tests repart sur sa dernière cible, et ses résultats reviennent
  dans la vue Tests. Au clavier, `↑` `↓` passent d'une ligne à l'autre en montrant
  chaque script, `←` `→` replient et déplient, Entrée donne la main au terminal.
- **Un script fini refuse la frappe.** Tant qu'il tourne, ce qu'on tape va au
  programme : une question `(Y/n)`, les touches d'un serveur de développement.
  Revenu au prompt, son terminal n'est pas un shell où travailler : rien n'y
  passe, et un rappel dit que ▷ le relance. Pour taper une commande, on ouvre un
  shell.
- **Ranger et sortir à la main.** Le clic droit sur un shell de la barre propose
  « Ranger dans Scripts » ; un onglet Claude, jamais. Un shell rangé paraît dans
  le dernier groupe de la liste, Shells, et reste interactif : il n'a pas de
  commande à relancer, mais ■ l'arrête. « Sortir des scripts », dans le menu
  d'une ligne ou par ⤒ dans la barre flottante, renvoie n'importe quel terminal
  de l'onglet Scripts dans la barre, où il reprend sa place ; un script sorti
  reste le sien, et le relancer depuis la vue Scripts le reprend là. Rien ne
  change de place tout seul : `claude` lancé dans un shell rangé y reste, et une
  session arrêtée laisse son shell où il est.

Fermer le script montré montre son voisin ; fermer le dernier ramène dans la barre.
Pendant qu'on regarde les scripts, le bloc du bas garde la session de l'onglet
Claude qu'on a quitté, et le pied de la zone décrit le script montré. Le projet
retient le script choisi, les groupes repliés et les rangements d'une ouverture à
l'autre.

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

## Changer de modèle et d'effort

Le premier bouton de la barre montre le modèle de la session et en change : le choix
est tapé dans la session sous la forme `/model <id>` ; Claude travaille-t-il, la
commande part dans sa file et s'applique au tour suivant. Le second fait de même pour
l'effort, avec `/effort <niveau>` : il n'apparaît que si le modèle en a un réglable,
et marque le niveau que Claude Code recommande. Claude Code garde ce niveau comme
défaut des prochaines sessions du même modèle (`modelSettings` de son
`settings.json`). Tous deux lisent la valeur en cours
sur la dernière réponse : elle s'actualise donc à la réponse suivante.
« Claude avec le modèle », dans `+`, ouvre un nouvel onglet avec
`claude --model <id>`.

Les modèles viennent du catalogue que Claude Code garde en cache pour le compte
(`~/.claude/cache/model-catalog`) : les principaux d'abord, avec leur description,
les versions précédentes dans un sous-menu ; les niveaux d'effort de chaque modèle
aussi. Ce cache n'est pas documenté : absent
ou d'une autre forme, il cède la place aux alias `opus`, `fable`, `sonnet` et
`haiku`, que Claude Code accepte toujours.

C'est le modèle de la session en cours. Celui des nouvelles sessions se règle dans
Réglages › Claude Code.

Le bouton des serveurs porte un point vert quand un serveur de développement tourne ;
son menu les ouvre dans le navigateur.

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

### Lancer depuis la marge

Une ligne qui se lance porte un bouton ▷ dans la marge, à gauche des numéros :

- dans un `package.json`, chaque script, avec le gestionnaire de son dossier ;
- dans un Makefile, chaque cible ;
- dans un Markdown, chaque commande d'un bloc `sh`, `bash`, `powershell`, `ps1`
  ou `console`, sans son invite (`$ `, `PS> `) ; dans un bloc `console`, seules
  les lignes à invite, le reste étant leur sortie ;
- dans un script `.ps1` ou `.sh`, la première ligne, qui lance le fichier ;
- dans un fichier de test, chaque test, coloré par son dernier résultat : vert,
  rouge, ● tant qu'il tourne.

Le bouton passe par le terminal du script, comme la vue Scripts : ■ l'arrête
(Ctrl+C) tant qu'il tourne, et il apparaît dans « En cours ». Un script se montre
dans l'onglet Scripts ; un test tourne dans le terminal de sa suite, en
arrière-plan, et son résultat revient dans la marge et dans la vue Tests. Les lignes d'un Markdown suivent la frappe ;
celles d'un fichier de test sont relues à l'enregistrement.

## Largeur des colonnes

Les poignées entre les colonnes se tirent à la souris, et un double-clic rend la
largeur par défaut (290 px pour le projet, 340 pour le panneau global). Les
largeurs sont gardées d'une ouverture à l'autre ; le terminal garde toujours
420 px entre les colonnes, et une fenêtre qui rétrécit prend sur les colonnes
latérales plutôt que sur lui.
