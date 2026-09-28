# Le panneau global

À droite, ce qui ne dépend d'aucun projet : les sessions de toute la machine, la recherche, les chantiers, l'usage et les coûts, les processus. Les réglages de Claude Code sont dans la fenêtre Réglages.

## Onglets du panneau global

Les onglets ne tiennent pas tous en ligne dans la colonne de droite. Deux dispositions, au choix
depuis le menu « ⋯ » :

- **en ligne, en haut**, comme les outils de développement du navigateur : autant
  d'onglets qu'en tient la largeur, le reste dans « ⋯ ». L'onglet ouvert reste
  toujours sur la ligne, pour qu'on voie où l'on est ;
- **en colonne, à droite**, comme les barres d'outils de WebStorm : le panneau
  garde toute sa largeur de texte, et la colonne défile quand la fenêtre manque de
  hauteur.

Le même menu choisit les onglets affichés ; un onglet masqué reste accessible depuis
« ⋯ ». Le choix est gardé avec les autres préférences de l'application.

La roue en bas de la barre d'onglets, comme celle de la barre de titre, ouvre la
fenêtre Réglages (voir [Personnaliser](personnaliser.md#reglages)).

## Processus

L'onglet **Process** montre les processus Claude de la machine et leurs enfants :
« ce terminal » pour ceux qui descendent d'un onglet de Clide, « lancé ailleurs »
pour les autres. Un Claude qui tourne dans un onglet encore ouvert porte **aller à
l'onglet**, qui passe à son projet et montre l'onglet, devant un fichier ouvert.
« arrêter », révélé au survol, demande confirmation.

## Skills et commandes

L'onglet Skills liste tout ce qui s'invoque, projet ouvert ou non : les skills du
poste (`~/.claude/skills`), ceux des plugins, et ceux que le compte claude.ai
synchronise — ceux d'Anthropic et ceux que l'organisation partage —, puis les
commandes. Claude Code dépose ces derniers dans `~/.claude/skills/synced/<compte>/`,
avec un `manifest.json` qui dit qui a créé chacun ; ils portent le préfixe
`anthropic-skills:` de leur invocation, et se lisent sans s'éditer : ils se gèrent
sur claude.ai.

Un skill porte le nom de son dossier, parce que c'est ainsi que Claude Code
l'invoque : `skills/git/SKILL.md` se lance par `/git`, même si son en-tête déclare
`name: commit`. Ce `name` déclaré s'affiche en badge quand il diffère, et reste
modifiable dans l'éditeur.

Chaque section se replie et s'en souvient ; une recherche les ouvre toutes, pour
qu'un résultat caché ne passe pas pour absent. La recherche porte sur le nom, le
`name` déclaré et la description.

## Usage de l'abonnement

L'onglet Consommation montre d'abord les limites de l'abonnement comme `/usage` les montre —
session de 5 heures, semaine tous modèles, semaine d'un modèle, crédit
supplémentaire —, avec le temps qui reste avant chaque réinitialisation, puis ce
que chaque session récente a consommé : contexte, coût, durée, lignes modifiées.
Une jauge passe à l'ambre puis au rouge en approchant de la limite, avec « élevé »
ou « presque atteinte » écrit à côté : la couleur n'est jamais seule.

Deux sources, parce qu'aucune ne suffit seule :

- **La ligne de statut**, la voie documentée. Installée à la demande, elle est
  déclarée dans `settings.json`, sauvegardé avant la première modification, et
  jamais par-dessus une ligne de statut existante — Claude Code n'en accepte
  qu'une, et on perdrait l'autre sans le dire. Claude Code lui transmet les
  limites et l'état de la session à chaque réponse ; elle les dépose dans les
  données de l'application et affiche sous le prompt un résumé comme
  `5 h 9 % · sem. 47 % · ctx 12 %`. Elle ne sait donc rien hors d'une session, et
  garde les dernières limites connues quand une entrée n'en porte pas — elles
  n'arrivent qu'après la première réponse de l'API.
- **« Actualiser »**, qui interroge l'API interne de `/usage` avec le jeton de
  connexion de Claude Code. Elle répond à tout moment, mais n'est pas documentée :
  elle peut changer ou limiter les appels. Elle n'est donc appelée qu'au clic, et
  le jeton n'est jamais renouvelé ici — Claude Code s'en charge à sa prochaine
  session.

Le relevé affiché est le plus récent des deux, avec sa source et son âge.

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

## Ce que coûtent les sessions

Réglages › Historique et coûts › « Afficher les coûts » les masque dans
l'historique, l'activité de la session et l'en-tête du terminal ; l'onglet Consommation
reste pour qui le cherche.

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
dernière activité — ses réponses ne sont pas datées une à une dans l'index. Ses
sections — par jour, par projet, par modèle, tarifs — se replient.

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

## Notifications

Claude Code signale trois choses par ses hooks : une permission demandée, une
attente de réponse, une réponse terminée — et, par `UserPromptSubmit`, la reprise
qui les rend caduques. Un cinquième hook, `SessionStart`, n'est pas une alerte :
il dit quelle session l'onglet suit désormais, au démarrage, après un `/clear`, à
la reprise et après une compaction, et c'est lui qui rattache l'onglet à son
transcript avant le premier prompt. L'installation, depuis le panneau
**Alertes**, déclare ces hooks dans `settings.json` et dépose un script qui
déverse chaque événement dans une file que le serveur surveille.

Quatre décisions de conception :

- **L'onglet se nomme lui-même.** Clide donne à chaque onglet la variable
  `CLIDE_TERMINAL_ID` ; `claude` la transmet à ses hooks, dont le script la
  rapporte avec l'événement. Le serveur rattache donc l'événement à l'onglet
  exact, même quand deux onglets travaillent dans le même dossier. Un `claude`
  lancé hors de Clide n'en porte pas : ses alertes vont à l'onglet du même
  dossier, mais il ne rattache aucun onglet à sa session — sans quoi un autre
  éditeur ou un `claude -p` dans le même dossier volerait l'onglet à chaque
  démarrage.

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
réinstaller. Le panneau dit aussi quand le script déposé n'est plus celui de la
version qui tourne — « à mettre à jour », un clic le remplace — et quand
`settings.json` porte encore les hooks d'une installation de Clide sous un ancien
nom : ils déversent dans un dossier que rien ne lit. Ils sont repointés au
démarrage du serveur, les hooks ayant été voulus, et le panneau propose de les
retirer si cette écriture n'a pas pu se faire.

Hooks et ligne de statut sont des commandes que Claude Code lance : elles visent
Node par son chemin absolu, le PATH de Claude Code n'étant pas celui de
l'application. Dans l'application de bureau, c'est le Node du PATH qui est retenu :
l'exécutable courant y est `Clide.exe`, qui relancerait l'application à chaque
événement. Sans Node dans le PATH, l'installation est refusée et le dit.

Sous Windows, le bouton de la barre des tâches porte le nombre d'onglets en
attente, fenêtre au premier plan ou non, et clignote tant que la fenêtre est en
arrière-plan. L'image du compteur est dessinée par la page : le processus
principal n'a pas de canevas.
