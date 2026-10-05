# La colonne du projet

À gauche, ce qui appartient au projet ouvert, une vue par icône de la barre d'activité : l'explorateur et ses dossiers liés, l'historique des sessions du projet, les scripts, les skills, les serveurs MCP, les worktrees.

## Dossiers liés

Le front dépend de l'API et du design system, qui vivent dans d'autres dépôts.
Déclarer ces dossiers évite d'avoir à redire à Claude où ils sont et à quoi ils
servent. Le chemin se tape, se colle, ou se choisit par « Parcourir… » dans la
fenêtre de sélection de Windows ; le rôle se prend parmi des pastilles — ceux déjà
donnés aux autres liens, puis api, front, design system… Chaque dossier lié montre sa branche et ce qui y
attend un commit ou un push ; son menu « ⋯ » le met à jour ou change sa branche
(voir [Git](./git)). Le rôle se renomme par ce même menu, ou d'un double-clic
dessus : Entrée le garde, Échap annule, un nom vide retire le rôle. Une session
Claude déjà ouverte garde l'ancien : le rôle est passé à Claude au lancement.
Trois fichiers y suffisent, tous écrits dans le projet :

| Fichier | Rôle |
|---|---|
| `.claude/settings.local.json` | les chemins dans `permissions.additionalDirectories`, et une règle `deny` par dossier en lecture seule |
| `.claude/clide.json` | les rôles, qui n'ont pas d'équivalent natif |
| `.claude/clide-prompt.md` | le texte décrivant les liens, passé à Claude en `--append-system-prompt-file` |

Ils portent des chemins absolus de cette machine, et sont donc exclus de git dès
l'ouverture du projet, dans `.git/info/exclude`, propre au clone : lier un dossier
ne fait pas paraître le projet modifié, et aucun `.gitignore` n'est touché.

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

## Lancer un script

Chaque script a **son terminal**, nommé `dossier › script` (`front › dev`,
`api › dev`), rangé sous l'onglet [Scripts](terminaux#l-onglet-scripts) plutôt
que dans la barre : on en fait tourner plusieurs côte à côte, chacun dans le
dossier de son projet ou de son dossier lié. Relancer un script reprend son
terminal — encore en cours, il revient au premier plan sans être relancé ; fini, il
y repart, précédé d'Échap qui vide la ligne en cours sous PSReadLine. Le serveur
garde le script de chaque terminal : un rechargement de la page les retrouve.
Lancer un script le montre ; pour rester sur ce qu'on regarde, Réglages ›
Terminal propose « Rester où l'on est ».

On coche des scripts, puis **Lancer (N)** les démarre ensemble ; **Enregistrer
comme groupe** les garde sous un nom (« Tout démarrer »), dans
`.claude/clide-scripts.json` du projet, avec des chemins relatifs à lui pour qu'un
groupe se partage. Un groupe se lance ou s'arrête d'un bouton (Ctrl+C à chacun de
ses onglets). En tête, **En cours** liste ce qui tourne, avec l'adresse qu'un
serveur de développement a annoncée.

Les scripts des dossiers liés sont listés à la suite, chacun avec le gestionnaire
que désigne son propre lockfile : lancer les scripts d'un dépôt npm avec le `pnpm`
du projet réécrirait son arbre de dépendances. Au-delà du `package.json`, la liste
reconnaît les cibles d'un Makefile, les commandes courantes de cargo, de go et de
python (pytest, pip, Django), et les scripts `.ps1` et `.sh` de la racine et de
`scripts/`.

Les scripts qu'on lance sans cesse — dev, start, build, test, lint, preview,
typecheck — viennent en tête, en gras. « installer » lance `<gestionnaire>
install` à la racine du dossier, dans son onglet comme un script.

Chaque en-tête se replie d'un clic : En cours, Groupes, un dossier entier (le
projet ou un dossier lié), ou une catégorie (un `package.json`, make, cargo…).
Replié, il garde son nombre de scripts, et un point vert si l'un d'eux tourne. Le
projet retient ce qu'on a replié d'une session à l'autre.

## Lancer les tests

La vue **Tests** liste les suites Vitest, Jest et pytest du projet et de ses
espaces de travail : Vitest ou Jest quand le `package.json` en dépend ou en a la
configuration, pytest quand le dossier a un `pyproject.toml`, un `pytest.ini` ou un
`setup.cfg`. Les tests sont lus dans les fichiers (`describe`, `it`, `test`,
`def test_…`, classes `Test…`) : un nom construit à l'exécution n'y figure pas.

Chaque suite a son onglet (`web › tests`, `api › pytest`), où ▶ lance toute la
suite, un fichier ou un seul test. La commande est celle du projet, lancée par
`npx --no-install` ou `python -m pytest`, avec un rapport machine écrit dans les
données de Clide, jamais dans le projet. À la fin de la commande, Clide relit ce
rapport et colore chaque test : vert, rouge, gris s'il est sauté, cerclé tant qu'il
n'a pas tourné. Un lancement partiel garde le dernier résultat des autres tests, et
les résultats restent d'une session à l'autre.

Un clic sur un test ouvre son fichier à la ligne ; sur un test en échec, il déplie
aussi le message, avec **Corriger avec Claude**, qui l'écrit dans l'onglet Claude
du projet sans le valider.

Le champ du haut filtre l'arbre sur le nom complet d'un test (blocs compris) ou le
chemin de son fichier, et **échecs** ne garde que les tests en échec ; un filtre
actif déplie ce qui lui répond. L'arbre se parcourt au clavier comme
l'explorateur : `↓` depuis le filtre y entre, les flèches passent d'une ligne à
l'autre, `→` déplie ou descend, `←` replie ou remonte, **Entrée** lance la suite,
le fichier ou le test sélectionné, **Espace** ouvre le test à sa ligne.

## Rechercher dans les fichiers

La vue **Recherche**, sous l'explorateur dans la barre d'activité, cherche un texte
dans les fichiers du projet, ceux que connaît la palette : dans un dépôt, ce que
git ne dit pas ignoré ; hors dépôt, tout sauf dépendances, sorties de build et
caches (`node_modules`, `dist`, `.git`…). Les binaires et les fichiers de plus de
1 Mo sont passés. `Ctrl+Maj+F` l'ouvre, pré-remplie avec le texte
choisi dans l'éditeur.

- **Aa** respecte la casse, **ab** ne garde que les mots entiers, **.\*** lit la
  recherche comme une expression régulière ; une expression invalide montre son
  erreur au lieu des résultats.
- Le bouton des filtres ouvre deux champs de motifs, séparés par des virgules :
  à inclure (`src/**`, `*.ts`) et à exclure (`*.test.ts`, `docs`). Un motif sans
  `/` vaut à toute profondeur, un nom de dossier pour tout ce qu'il contient.
- Les résultats sont groupés par fichier, le passage surligné ; un clic ouvre le
  fichier à la ligne et à la colonne. Au-delà de 2 000 résultats, la liste s'arrête
  et le dit.

## Skills

Les skills se lisent sur quatre portées : le projet (`.claude/skills`), le poste
(`~/.claude/skills`), les plugins installés, et ceux que le compte claude.ai
synchronise (voir le [panneau global](./panneau-global#skills-et-commandes)). Le
panneau du projet montre les siens, avec sa propre recherche ; les autres sont dans
le panneau global. Ceux d'un plugin vivent dans
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
recopier n'importe quel fichier. « Importer… » propose « Fichier .md… » et
« Dossier de skill… », qui ouvrent la fenêtre de sélection de Windows — deux
boutons, parce qu'elle ne fait pas choisir dans une même fenêtre un fichier ou un
dossier —, et importent aussitôt. Déposer des fichiers sur le panneau fait de même :
sous Electron par leur chemin, dossiers compris ; dans un navigateur, qui ne livre
que le contenu, les seuls `.md`. Ni la copie ni l'import ne remplacent un skill
existant.

Un nouveau skill peut être rédigé par Claude : l'éditeur écrit le squelette — nom,
description, invocation — puis envoie à l'onglet Claude du projet une consigne qui
désigne ce fichier. Claude reçoit un fichier existant à compléter plutôt qu'un
emplacement à deviner. Enregistré à la main, il s'ouvre aussitôt dans l'éditeur de
Clide, là où l'on écrit ses instructions.

Chaque skill porte son mode d'invocation — automatique et `/nom`, `/nom` seul
(`disable-model-invocation`), automatique seul (`user-invocable: false`).
« insérer /nom » le tape dans l'onglet Claude du projet sans valider, pour écrire la
demande à la suite ; « ouvrir », ou un double-clic, ouvre son `SKILL.md` dans
l'éditeur, skills du poste compris. Les skills des dossiers liés suivent ceux du
projet, sous « Des dossiers liés », avec le nom du dossier : ils appartiennent à
l'autre dépôt, on les ouvre et on les insère, on ne les modifie pas d'ici.

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

## Prompts enregistrés

Ce qu'on envoie souvent à Claude — `/sc:brainstorm`, une consigne récurrente — se
range dans la vue Prompts de la colonne du projet. Un prompt a un nom, un texte, et
une manière de partir : **envoyer**, ou **insérer** pour compléter avant d'envoyer.
Ceux du projet vont dans `.claude/clide-prompts.json`, qu'on peut versionner et
partager ; les siens dans les données de Clide, pour tous les projets.

Le texte peut porter des variables, remplacées à l'envoi : `{sélection}` (le texte
choisi dans l'éditeur), `{fichier}` (le fichier ouvert au centre), `{branche}`,
`{saisie}` (demandée dans une petite fenêtre, qui propose en pastilles les cinq
dernières réponses données à ce prompt dans ce navigateur). Une variable sans
valeur arrête l'envoi et le dit : « explique {sélection} » ne part pas sans
sélection.

Pour un prompt **insérer** qui porte `{saisie}`, la fenêtre propose un interrupteur
**Envoyer directement** : la saisie faite, le prompt part validé au lieu d'attendre
Entrée dans le terminal. Le choix est retenu d'une fois sur l'autre, et le bouton de
la fenêtre dit ce qu'il fera : Envoyer, ou Insérer.

Un prompt part dans l'onglet Claude du projet ; sans onglet Claude, un onglet
s'ouvre avec le prompt en argument de `claude`. On le lance d'un clic dans la vue,
par la palette (`/` puis son nom — les skills y sont aussi), par le bouton des prompts
de la barre flottante d'un onglet Claude, ou par un raccourci : chaque prompt est une commande, à qui
Réglages › Raccourcis donne une touche.

Sous la liste, **Souvent tapées** relève les commandes `/…` tapées au moins trois
fois ces trente derniers jours, hors de celles de Claude Code lui-même et de celles
déjà enregistrées ; « Enregistrer » en fait un prompt en un clic.

