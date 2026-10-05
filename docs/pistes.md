# Pistes

Exploration de ce que Clide pourrait faire ensuite. Ce document décrit des
besoins et des critères, pas des solutions : l'architecture se décide après.

## Ce que l'usage réel dit

Mesuré sur le corpus local (76 transcripts, 107 801 events, 19 jours d'activité) :

| Observation | Chiffre | Ce que l'application en fait aujourd'hui |
|---|---|---|
| Coût cumulé | **2 299,79 USD** sur 28 sessions chiffrées | rien |
| Prompts mis en file | **381** | rien |
| Merge requests distinctes | **80** | une pastille dans History |
| Appels Linear | **598** | rien |
| Sous-agents nommés | 7, 12 transcripts | rien |
| Worktrees | 438 events | un panneau |
| Bash / PowerShell | 12 068 / 1 251 | rien |

Trois besoins sautent aux yeux : **le coût est invisible**, **la file d'attente est
invisible**, et **le lien session → branche → MR → ticket n'existe nulle part**
alors qu'il structure toute la journée de travail.

---

## Questions ouvertes

Quatre questions à trancher avant d'ajouter quoi que ce soit. Elles ne portent
pas sur le comment : elles décident de ce qui mérite d'exister.

### 1. Poste de pilotage ou journal de bord ?

À quoi sert cette application, au juste ?

- **Un poste de pilotage** : je lance, je surveille, j'interviens. Ce qui compte
  est l'instant présent — qui tourne, qui attend, qui a échoué.
- **Un journal de bord** : je retrouve, je comprends, je rends compte. Ce qui
  compte est le passé — ce qui a été fait, combien ça a coûté, où c'est parti.

Les deux lectures ne priorisent pas la même chose, et les panneaux actuels font
un peu des deux sans trancher. La réponse décide de ce qui occupe le centre et de
ce qui reste dans un panneau qu'on ouvre.

### 2. L'application parle-t-elle à Linear et GitLab, ou seulement aux transcripts ?

**Tranchée : aux transcripts seuls.** Pas de jeton, pas de secret stocké. Les
transcripts en savent plus que prévu : les appels de Claude aux outils Linear portent
l'identifiant des tickets, leur titre, leur lien, et leur état — lu par `get_issue`,
ou fixé par `save_issue`. L'application montre donc le dernier état connu, daté,
sans l'état du moment, que seul Linear connaît.

### 3. La file d'attente est-elle reconstituable, ou seulement observable ?

**Tranchée : reconstituable.** Quatre opérations — `enqueue` avec le texte,
`remove` avec le texte absorbé, `dequeue` qui prend le premier, `popAll` qui vide
tout. Rejouées sur les 51 sessions du corpus qui en portent : aucun `remove` sans
correspondance, aucun `dequeue` sur une file vide, et une seule session finit avec un
prompt en attente, fermée avant de l'envoyer.

### 4. Quelle place pour l'écriture destructrice ?

Restaurer un fichier dans son état d'avant la session est la capacité la plus
distinctive de la base de code — et la seule qui puisse détruire du travail en
cours. Soit on l'assume avec les garde-fous qui vont avec (piste 7), soit on s'en
tient à la lecture, et le panneau Fichiers reste un panneau de constat.

**Tranché** : on l'assume, avec les garde-fous de la piste 7.

---

## Piste 1 — Voir ce que ça coûte

**Le besoin.** 2 300 USD en 19 jours, et aucun endroit où le voir. L'event
`cost-state` porte déjà `totalCostUSD`, `modelUsage`, les lignes ajoutées et
retirées, les durées d'API et d'outils.

**Ce qu'on attend**

- Le coût de la session courante, dans la barre d'état, à côté du dossier.
- Un panneau de consommation : par jour, par projet, par modèle.
- Le coût d'une session dans History, à côté du nombre de fichiers.

**Ce qui n'est pas demandé.** Ni budget, ni alerte, ni blocage. Voir suffit ;
décider reste humain.

**Critère.** Je peux répondre à « combien m'a coûté ce chantier » sans quitter
l'application.

**État.** Fait : coût dans la barre d'état, dans History et dans l'activité, et un
panneau Coûts par jour, par projet et par modèle. Les tarifs sont déduits des
`cost-state` de l'utilisateur, jamais écrits en dur ; un modèle dont les relevés ne
concordent pas — Opus 5.5 aujourd'hui, avec deux relevés — reste « coût inconnu »
plutôt que chiffré faux.

---

## Piste 2 — La file d'attente

**Le besoin.** 381 prompts mis en file. C'est une façon de travailler — on empile
pendant que Claude avance — et elle n'existe que dans le terminal, invisible dès
qu'on regarde ailleurs.

**Ce qu'on attend**

- Ce qui attend, dans le bloc session, en clair.
- Retirer une entrée, en ajouter une.

**La difficulté.** Voir la question ouverte 3 : rien ne garantit que l'état courant
de la file soit reconstituable depuis les events.

**Critère.** Ce que montre le panneau correspond à ce que montre `claude` dans le
terminal, sans décalage.

**État.** Fait : la file se lit au-dessus du bloc session, et un prompt s'y ajoute
en le tapant dans l'onglet Claude. Retirer n'est pas offert : Claude Code ne l'expose
pas, et le simuler au clavier dans son interface pourrait viser le mauvais prompt.

**Ce que l'usage en dit.** La file vit rarement plus de quelques secondes : sur 400
mises en file, 327 sont absorbées par le tour en cours (`absorbed_mid_turn`), 57
prises à la fin du tour, 15 vidées d'un coup. La piste vaut moins que ne le
laissaient croire les 381 prompts relevés au départ.

---

## Piste 3 — Le chantier, pas la session

**Le besoin.** 80 MR et 598 appels Linear : une journée de travail va d'un ticket
à une branche, à un worktree, à des sessions, à une MR. L'application ne connaît
que la session.

**Ce qu'on attend**

- Une vue qui regroupe : ticket → branche → worktree → sessions → MR.
- Depuis une session : ouvrir sa MR, voir l'état de son ticket.
- Depuis un worktree : ce qui s'y est passé, et où ça en est.

**Ce qu'on a déjà** : `pr-link` (URL, numéro, dépôt), `gitBranch`, `worktree-state`,
et le MCP Linear côté Claude Code.

**Ce qui la bloque** : la question ouverte 2. Sans accès direct, la vue existe mais
reste muette sur les états.

**Critère.** Depuis un ticket, je vois tout ce qui a été fait pour lui.

**État.** Fait, depuis les transcripts seuls : un onglet Chantiers regroupe, par
ticket et par branche sans ticket, les branches, worktrees, MR et sessions, avec le
dernier état connu du ticket et le coût des sessions travaillées. Le ticket d'une
session s'affiche aussi dans History.

---

## Piste 4 — Retrouver dans 240 Mo

**Le besoin.** 107 801 events, et History ne filtre que sur le titre, le dossier
et la branche. « Où ai-je déjà résolu ça ? » n'a pas de réponse.

**Ce qu'on attend**

- Une recherche plein texte sur les transcripts : prompts, réponses, commandes.
- Le résultat ouvre la session à l'endroit trouvé.

**Ce qui la rend possible.** L'index existe déjà et sait ce qui a changé. Y
ajouter un index de texte est une extension, pas une refonte.

**Critère.** Retrouver une commande tapée il y a trois semaines en moins de dix
secondes, sans connaître la session.

**État.** Fait : onglet Recherche, sur les prompts, réponses, commandes et appels
d'outils en texte entier ; un résultat ouvre la session sur l'entrée trouvée. Le
premier passage construit l'index en cinq secondes environ, une recherche prend
ensuite quelques dizaines de millisecondes.

---

## Piste 5 — Raccourcis et palette de commandes

**Le besoin.** Aucun raccourci aujourd'hui. ClaudeTerm en a de fixes ; en avoir
d'**éditables** est un pas de plus, mais ce n'est pas le plus utile des deux.

**Ce qu'on attend, par ordre de valeur**

1. **Une palette de commandes** (`Ctrl+K`) : toute action atteignable au clavier,
   avec son raccourci affiché. Elle rend les raccourcis découvrables — sans quoi
   ils n'existent que pour qui a lu la documentation.
2. **Des raccourcis par défaut** sur les gestes fréquents : nouvel onglet,
   nouvelle session Claude, fermer, naviguer entre onglets et projets, replier un
   bloc, basculer une colonne.
3. **Les rendre éditables**, dans un panneau de réglages, stockés dans la
   configuration de l'application — **jamais dans `settings.json`**, qui appartient
   à Claude Code.

**Le piège.** Un terminal capte le clavier. Tout raccourci doit être choisi pour ne
pas voler une frappe au shell ni à Claude Code, et la palette doit se fermer sans
laisser de caractère derrière elle.

**Critère.** Je découvre une action que je ne connaissais pas en ouvrant la palette.

**État.** Fait : palette sur `Ctrl+Maj+P`, raccourcis par défaut, modifiables dans
les préférences.

---

## Piste 6 — Les sous-agents

**Le besoin.** 958 events `agent-name`, 12 transcripts de sous-agents déjà lus par
l'inventaire, et rien qui les montre.

**Ce qu'on attend** : depuis l'activité d'une session, descendre dans celle d'un
sous-agent et remonter.

**Coût faible** : la lecture est faite, il manque la navigation.

**État.** Fait : un appel `Agent` de l'activité porte « ouvrir », qui montre
l'activité du sous-agent sous un fil « session › description » ; « remonter »
revient d'un cran, jusqu'à l'entrée d'où l'on était parti.

---

## Piste 7 — Annuler ce que Claude a fait

**Le besoin.** Le panneau Fichiers connaît l'état *avant* de chaque fichier, tiré
des sauvegardes de Claude Code. Il ne sait que le montrer.

**Ce qu'on attend** : restaurer un fichier dans son état d'avant la session.

**Pourquoi c'est particulier.** Aucun autre outil ne peut le faire : git ne connaît
que les commits, et ces sauvegardes sont plus fines. C'est la capacité la plus
distinctive de la base de code actuelle.

**Le danger.** C'est une écriture destructrice sur le travail en cours. Elle
demanderait au minimum : un aperçu de ce qui serait écrasé, un refus si le fichier
a changé depuis, et une sauvegarde de l'état courant avant d'écrire.

**État.** Fait, avec ces trois garde-fous et deux de plus : la session ne doit
plus tourner (ni onglet, ni écriture depuis deux minutes), et l'empreinte du
fichier vue dans l'aperçu doit être celle qu'on écrase. Seuls les fichiers écrits
par Edit, Write, MultiEdit ou NotebookEdit se restaurent ; ce qu'a fait Bash n'a
pas de sauvegarde.

---

## Piste 8 — Voir ce qui a été fait

**Le besoin.** Le panneau Fichiers montre ce qui a changé en texte. Rien ne montre
à quoi ça ressemble : le rendu d'un écran, la forme d'un flux côté serveur.

**Ce qu'on a déjà.** Les transcripts portent **195 images** sur 17 sessions,
surtout des captures prises par Claude en travaillant (70 par Playwright, 14 par
chrome-devtools). Elles sont lues avec le reste et montrées nulle part.

**Ce qu'on attend, par palier**

1. **Les captures de la session**, à leur place dans l'activité. Lecture seule,
   aucune configuration : c'est le pendant visuel de l'avant/après des fichiers.
2. **L'aperçu du serveur de développement**, dans un panneau. L'application lance
   déjà les scripts ; l'URL qu'affichent `vite` ou `next dev` au démarrage suffit
   à l'ouvrir à côté de la session.
3. **Un résumé visuel à la demande** : un diagramme Mermaid de ce que la session a
   changé, rédigé par `claude -p`. Il coûte des tokens, donc jamais automatique.

**Ce qui n'est pas demandé.** Isoler le rendu d'un composant, qui demande un
harnais propre à chaque projet. Simuler l'usage par des interfaces factices : c'est
de la génération de tests de bout en bout, et Claude le fait déjà avec Playwright
— l'application en montre les traces, elle ne s'y substitue pas.

**Critère.** Je vois à quoi ressemblait l'écran à chaque étape d'une session,
sans la rejouer.

**État.** Palier 1 fait : les images s'affichent en vignettes sous leur entrée de
l'activité, et un onglet Captures les rassemble dans l'ordre du temps, sous-agents
compris. Palier 2 fait : l'adresse qu'annonce une commande du shell s'ouvre dans
un aperçu à côté du terminal. Palier 3 fait : le mode Schéma fait dessiner par
`claude -p` un diagramme Mermaid de la session, à la demande — environ 0,15 $ pour
une session de 94 fichiers.

---

## Piste 9 — Git et worktrees depuis l'application

**Le besoin.** Savoir sur quelle branche on est, et faire les gestes courants —
fetch, pull, push, changer ou créer une branche, créer un worktree et y lancer
Claude — sans quitter l'application ni passer par un outil tiers.

**Ce qu'on a déjà.** Le panneau Worktrees lit la branche, les changements non
commités et l'avance ou le retard sur l'amont de chaque worktree, ouvre un
terminal dedans et retire un worktree. History et Chantiers montrent la branche
des sessions, et les liens de MR lus dans les transcripts. Aucune action git, et
aucune connexion à GitHub ou GitLab : la piste 3 a tranché « transcripts seuls,
pas de secret ».

**Ce qu'on attend, par palier**

1. **La branche toujours visible**, avec l'avance et le retard, et fetch / pull /
   push par le `git` local — qui passe par le gestionnaire d'identifiants de
   Windows : l'application ne stocke rien.
2. **Changer ou créer une branche, créer un worktree** et y ouvrir un onglet
   Claude en un geste ; montrer le navigateur de fichiers et les panneaux du
   worktree sans l'ouvrir comme un projet à part.
3. **L'état des MR et de la CI**, par les CLI `gh` et `glab` quand elles sont
   installées : elles gardent leur propre connexion, la règle « pas de secret »
   tient.

**Tranché** : un push demande confirmation en montrant ce qui part ; un
changement de branche avec des modifications non commitées propose un stash.

**État.** Fait, les trois paliers : la branche dans la barre de titre avec fetch,
pull en avance rapide et push confirmé ; les branches, le stash proposé, les
worktrees ouverts avec Claude ; la MR ou la PR et sa CI par `glab` et `gh`.

---

## Piste 10 — Le bloc suit vraiment l'onglet

**Le besoin.** Que le bloc sous le terminal — plan, activité, fichiers — montre
ce que l'onglet actif est en train de faire, sans qu'on ait à cliquer pour le
raccrocher, et qu'il dise clairement quand il montre autre chose.

**Ce qu'on a déjà.** Le serveur relit le transcript de chaque onglet toutes les
1,5 s et le client se rafraîchit à chaque écriture. Mais le lien onglet ↔
transcript est deviné par la date de création du fichier quand les hooks ne sont
pas installés — et ils ne le sont pas dès que `settings.json` porte ceux d'une
installation antérieure. Un clic dans History détache le bloc sans le dire, et
changer de projet laisse l'onglet actif dans l'autre projet.

**Ce qu'on attend, par palier**

1. **Rattachement exact** : l'onglet se nomme dans l'environnement du `claude`
   qu'il lance, le hook le rapporte, et `SessionStart` rattache dès le démarrage
   et à chaque `/clear` ou reprise. Les hooks d'anciennes installations sont
   repointés au démarrage, et le panneau Alertes dit quand le script déposé est
   à mettre à jour.
2. **Le bloc dit ce qu'il suit** : choisir dans History la session de l'onglet
   actif ne détache pas ; choisir une autre session affiche « détaché » avec un
   retour à l'onglet.
3. **Changer de projet réactive son dernier onglet**, ou son plus récent, pour
   que le bloc suive tout de suite.

**Tranché** : `settings.json` ne bouge que par un geste (Installer, Retirer) ou
pour repointer un hook que Clide avait lui-même posé sous un ancien nom ; le
mode Fichiers garde sa limite — il ne voit que ce que les outils d'édition de
Claude Code ont écrit.

**État.** Fait, les trois paliers, selon
[`design-suivi-session.md`](design-suivi-session.md) : rattachement par les hooks
avec `SessionStart` et l'onglet nommé dans l'environnement, reprise des hooks
ClaudeTerm et claude-ide ; History ne détache plus la session vivante et le bloc
dit « détaché » ; changer de projet réactive son dernier onglet. En plus, le mode
Fichiers lit les écritures des commandes Bash (`bashEditDiff`), que ClaudeTerm
lisait et que le port avait laissées de côté.

---

## Piste 11 — Les scripts sous un seul onglet

**Le besoin.** Chaque script lancé ouvre un shell dans la barre d'onglets, entre
les onglets Claude, les shells et les fichiers : deux serveurs de développement et
une suite de tests, et la barre compte trois onglets de plus que ceux où l'on
travaille. Les ranger sous un onglet Scripts qui bascule l'affichage, comme les
fenêtres Run et Services de WebStorm.

**Ce qu'on a déjà.** Un onglet de script est un shell qui porte sa clé
`dossier|nom` ; le serveur la garde avec l'onglet, qui survit donc à un
rechargement. `runScript` le retrouve pour le ramener au premier plan ou y
relancer le script, et tout passe par lui : la vue Scripts et ses groupes,
`installer`, le ▷ de la marge, les suites de tests en arrière-plan. L'adresse d'un
serveur de développement est relevée (`devUrl`), et une instance xterm change
d'hôte sans perdre son tampon.

**Ce qu'on attend, par palier**

1. **L'onglet Scripts et ce qu'il montre.**
   - Épinglé en tête de la barre : il ne se range pas au glisser et rien ne passe
     devant lui. Toujours là, il reste grisé tant qu'aucun script n'a été lancé
     dans le projet. Un script arrêté ou fini le garde actif tant que son shell
     n'est pas fermé : un script ne disparaît jamais seul.
   - Il porte le nombre de scripts en cours et leur état : rouge si l'un a
     échoué, ambre si l'un tourne, gris sinon.
   - Un clic montre ses scripts à la place du terminal, un second rend l'onglet ou
     le fichier qu'on regardait ; une commande de la palette fait de même, avec
     son raccourci.
   - À gauche, une ligne par script du projet, dans l'ordre de lancement : son
     état, `dossier › script`, l'adresse du serveur de développement, et ses
     boutons — arrêter (Ctrl+C) et relancer, qui l'arrête puis le relance, tant
     qu'il tourne ; lancer et fermer une fois fini. À droite, le terminal du
     script choisi, où l'on tape comme aujourd'hui. La liste a une largeur
     réglable, gardée comme celle des colonnes ; le projet retient le script
     choisi.
   - La liste range les scripts par nature, lue à leur nom : Serveurs, Tests,
     Build, Vérifications, Installation, Autres. Chaque groupe a un en-tête qui
     se replie, et qui garde replié l'état de ses scripts ; avec un seul groupe,
     la liste reste plate.
   - Sur le terminal d'un script, la barre flottante du coin haut droit — celle
     du modèle et de l'effort sur un onglet Claude — porte arrêter et relancer :
     un script arrêté se relance et s'arrête sans revenir à la liste.
   - Tout onglet ouvert par `runScript` y va, tests et `installer` compris.
     « Aller à l'onglet », dans la vue Scripts, ouvre l'onglet Scripts sur ce
     script.
   - Le bloc du bas garde la session du dernier onglet Claude regardé tant qu'on
     est sur l'onglet Scripts.
   - **Un script fini refuse la frappe.** Tant qu'il tourne, ce qu'on tape va au
     programme — une question `(Y/n)`, les touches d'un serveur de
     développement ; revenu au prompt, son terminal n'accepte plus rien, et un
     rappel dit que ▷ le relance. On n'y tape donc ni `claude` ni une autre
     commande : pour cela, on ouvre un shell.
2. **Ranger et sortir à la main.** Un shell s'y range par son menu contextuel,
   « Ranger dans Scripts » — un onglet Claude ne le propose pas ; tout script,
   venu seul ou rangé à la main, en sort par « Sortir des scripts » et rejoint la
   barre. Le rangement survit à un rechargement. Un script sorti reste le sien :
   le relancer le retrouve là où il est, sans en ouvrir un second.
   - Les shells rangés à la main forment le dernier groupe de la liste, Shells :
     sans commande à relancer, on les voit à leur place. Ils restent
     interactifs.
   - **Rien ne change de place tout seul.** `claude` lancé dans un shell rangé à
     la main y reste, sans fenêtre ni bouton : le ranger était un choix, « Sortir
     des scripts » le défait. Une session Claude arrêtée, par Ctrl+C ou autrement,
     laisse son shell où il est.
3. **Le réglage de lancement**, « Au lancement d'un script » : basculer sur
   l'onglet Scripts, sur ce script — le défaut, ce que fait le lancement
   aujourd'hui —, ou rester où l'on est, le script lancé devenant celui que
   l'onglet montrera. Un lancement en arrière-plan ne bascule jamais.

**Tranché** : un onglet épinglé dans la barre plutôt qu'un mode du bloc du bas ;
tests, `installer` et shells rangés à la main y vont ; le lancement bascule par
défaut. Un seul terminal est montré à la fois, sans écran partagé : les scripts se
suivent dans la liste, l'un au-dessus de l'autre — des sous-onglets côte à côte
restent possibles si la conception les préfère. Un script fini est en lecture
seule, plutôt qu'interactif ou fermé à toute frappe ; Claude dans un shell rangé à
la main n'ouvre ni fenêtre ni bouton.

**Par défaut, sauf avis contraire**

- `Ctrl+Maj+PageDown` et `PageUp` passent sur l'onglet Scripts comme sur un seul
  onglet ; dans la liste, `↑` `↓` changent de script.
- Le clic droit sur l'onglet Scripts propose « Tout arrêter » et « Fermer les
  scripts finis ».
- La croix d'une ligne ferme le terminal du script, sans demander, comme celle
  d'un onglet aujourd'hui.
- Le pied de la zone — dossier, état, code de sortie — décrit le script choisi.
- Basculer ne recrée aucun terminal : chacun garde son tampon et son défilement,
  et se remesure à la largeur que la liste lui laisse.

**Critère.** Deux serveurs et une suite de tests tournent : la barre n'a qu'un
onglet de plus, Scripts, qui affiche 3 en ambre. Un clic les montre avec leurs
adresses, un second ramène à l'onglet Claude, dont le bloc du bas n'a pas bougé.

**État.** Conçue dans [`design-onglet-scripts.md`](design-onglet-scripts.md) et
planifiée dans [`workflow-onglet-scripts.md`](workflow-onglet-scripts.md), en trois
MR. Fait, les trois paliers : l'onglet Scripts et sa liste groupée par nature, la
lecture seule au prompt, ranger et sortir à la main, et le réglage « Au lancement
d'un script ».

---

## Piste 12 — Grouper les onglets

**Le besoin.** Quatre onglets Claude, deux shells, des fichiers : la barre se
remplit et l'on ne voit plus d'un coup d'œil ce qui va ensemble. Pouvoir grouper
des onglets sous une étiquette qui se replie, comme les groupes d'onglets de
Chrome, et les dégrouper quand on veut — sans que rien ne change de place sans un
geste.

**Ce qu'on a déjà.** La barre mêle onglets Claude, shells et fichiers ; le projet
garde leur ordre (`tabOrder`) d'une ouverture à l'autre, ils se rangent au glisser
et au clavier, et se renomment par double-clic. Le clic droit d'un onglet le
renomme, le ferme, ferme les autres, copie son dossier, et range un shell dans
Scripts. Chaque onglet Claude porte son état — ✦ il travaille, ⚠ il attend, un
point vert s'il a fini sans être vu — et la pastille du projet compte ces signes
pour tous ses onglets. Le seul regroupement existant est l'onglet Scripts, épinglé
en tête, qui montre ses terminaux dans une liste.

**Ce qu'on attend, par palier**

1. **Des groupes faits à la main.**
   - Un groupe est une étiquette — un nom, une couleur — posée devant des onglets
     voisins, qui restent contigus. Il réunit ce qu'on veut : onglets Claude,
     shells, fichiers.
   - Un clic sur l'étiquette replie le groupe : ses onglets quittent la barre et
     l'étiquette devient une puce qui dit leur nombre. Un second clic les rend.
   - Replié, le groupe garde visible l'état de ses onglets Claude : la puce porte
     ✦, ⚠ ou le point vert, comme la pastille du projet. Un groupe replié où
     Claude attend une permission se voit sans déplier.
   - On crée un groupe par le clic droit d'un onglet, « Nouveau groupe » ; on y
     ajoute un onglet par le même menu, « Ajouter au groupe › … », ou en le
     glissant entre ses onglets ; on l'en sort en le glissant dehors ou par
     « Retirer du groupe ». L'étiquette glissée emmène tout le groupe.
   - « Dégrouper », au clic droit de l'étiquette, retire le groupe : ses onglets
     restent dans la barre, à leur place.
2. **Grouper par type, d'un geste.**
   - « Grouper les onglets Claude » et « Grouper les shells », au clic droit d'un
     onglet et dans la palette, réunissent en un groupe Claude ou Shells tous les
     onglets du type qui ne sont pas déjà dans un groupe. Les deux gestes sont
     indépendants : l'un, l'autre ou les deux.
   - Le geste range les onglets présents à ce moment-là. Pour ceux qu'on ouvre
     ensuite, un réglage décide : ils s'ouvrent à côté du groupe, juste après lui
     et hors de lui, ou le rejoignent d'eux-mêmes. À côté, on les y glisse, ou on
     refait le geste.
   - Le type est celui de l'ouverture : un shell où l'on tape `claude` reste où il
     est, dans Shells s'il y était, avec les signes d'un onglet Claude. Rien ne
     change de place tout seul.
   - Un groupe fait à la main garde ses onglets : le geste ne les lui prend pas.

**Tranché** : des groupes repliables dans la barre, façon Chrome, plutôt qu'un
onglet-groupe qui montre ses terminaux dans une liste, comme Scripts, ou qu'un
écran partagé ; par type d'un geste, et à la main ; grouper par type est une
action manuelle, et un réglage choisit si les onglets ouverts ensuite rejoignent
le groupe de leur type ou s'ouvrent à côté ; un groupe fait à la main admet les
fichiers ; un shell devenu Claude ne change pas de groupe.

**Par défaut, sauf avis contraire**

- Les groupes sont ceux du projet, gardés d'une ouverture à l'autre comme l'ordre
  des onglets. Un groupe dont tous les onglets ont fermé disparaît.
- Refaire « Grouper les shells » quand un groupe Shells existe y ajoute les
  shells restés hors de tout groupe, plutôt que d'en créer un second ; de même
  pour Claude.
- Le nom se change par double-clic sur l'étiquette, comme celui d'un onglet ; un
  groupe qu'on vient de créer ouvre son champ tout de suite, et un nom vide laisse
  une puce de couleur seule. La couleur se choisit dans une courte palette, au
  clic droit de l'étiquette.
- Le réglage, dans Réglages › Terminal, vaut pour les deux types, Claude et
  shells, et s'ouvre à côté par défaut. Il ne joue qu'à l'ouverture : il ne range
  pas les onglets déjà là, et un shell devenu Claude reste où il est.
- Montrer un onglet d'un groupe replié — depuis la palette, une notification, ou
  parce qu'un nouvel onglet le rejoint — le déplie.
- Replier le groupe de l'onglet qu'on regarde ne change pas ce qui est montré :
  son en-tête quitte la barre, et la puce le signale comme actif.
- `Ctrl+Maj+PageDown` et `PageUp` sautent les onglets d'un groupe replié, comme
  Chrome ; la palette les atteint toujours.
- « Fermer le groupe », au clic droit de l'étiquette, ferme tous ses onglets après
  une confirmation qui dit ce qui y tourne ; un fichier modifié demande comme
  aujourd'hui.
- L'onglet Scripts n'entre dans aucun groupe. Un shell rangé dans Scripts quitte
  son groupe ; sorti des scripts, il le retrouve s'il existe encore.
- Replier, déplier, grouper par type et dégrouper sont des commandes de la
  palette, sans raccourci par défaut : on leur en donne un dans les Réglages.

**Critère.** Trois onglets Claude, deux shells, un fichier. Clic droit › « Grouper
les shells » : l'étiquette Shells se pose devant les deux shells ; un clic la
replie en une puce « Shells 2 ». Le shell qu'on ouvre ensuite s'ouvre juste après
la puce, hors du groupe ; avec le réglage sur « rejoindre », il entre dans le
groupe, qui se déplie pour le montrer. Un groupe « Revue » fait à la main réunit un onglet Claude et deux fichiers ; replié,
sa puce passe à ⚠ quand Claude y attend une permission.

**État.** Spécifiée avec `/sc:brainstorm` le 2026-10-05 ; ni conçue ni planifiée.

---

## Piste 13 — Les prompts au clavier

**Le besoin.** Envoyer un prompt enregistré sans lâcher le clavier : ouvrir leur
liste d'une touche, et lancer les plus fréquents chacun par la sienne, sans avoir
rien à configurer.

**Ce qu'on a déjà.** Chaque prompt enregistré est une commande de la palette
(`prompt.run:<id>`) : on peut lui donner un raccourci, mais seulement dans
Réglages › Raccourcis, perdu parmi toutes les commandes. La palette a un mode `/`
qui liste les prompts, mais aucune commande ne l'ouvre directement. Les prompts du
projet (`.claude/clide-prompts.json`, versionnable) passent devant les siens dans
la liste. Un raccourci tapé dans le terminal est pris avant lui ; ceux de Clide
sont des `Ctrl+Maj` que ni PowerShell ni Claude Code n'utilisent.

**Ce qu'on attend**

1. **Une touche pour la liste** : une commande ouvre la liste des prompts, filtrée
   à la frappe ; Entrée lance celui qu'on a choisi, comme un clic.
2. **Des numéros sans rien configurer** : `Ctrl+Maj+2` à `9` lancent chacun un
   prompt.
   - Un prompt reçoit son numéro à sa création — le premier libre — et le garde :
     en supprimer un autre ne décale rien, et un numéro libéré attend le prochain
     prompt. Au-delà de huit, un prompt n'en a pas.
   - Prompts perso et prompts du projet en reçoivent. Dans un projet, si l'un de
     ses prompts porte le même numéro qu'un prompt perso, il le prend — comme dans
     la liste, où il passe d'abord ; le prompt perso garde son numéro partout
     ailleurs.
   - Le numéro se réattribue : on change celui d'un prompt, ou on lui donne une
     tout autre touche.
3. **La touche d'un prompt, là où sont les prompts** : la vue Prompts montre la
   touche de chaque prompt à côté de son nom et la laisse changer sur place, sans
   passer par les Réglages. La liste de la touche, le menu des prompts de la barre
   flottante et la palette la montrent aussi.

**Tranché** : les trois — une touche pour la liste, des numéros automatiques, la
touche réglée depuis la vue ; la rangée `Ctrl+Maj+1…9` plutôt que `Alt`, que le jeu
JetBrains utilise, ou `Ctrl`, que la version navigateur ne reçoit pas — `Ctrl+Alt`
est AltGr sous Windows ; un numéro donné à la création puis fixe, plutôt qu'un
rang dans la liste ; prompts perso et du projet numérotés, celui du projet prime
chez lui ; la liste sur `Ctrl+Maj+1` et les prompts sur `2` à `9`, `Ctrl+Maj+0`
étant pris par Windows pour changer de méthode de saisie dès que plusieurs langues
sont installées.

**Par défaut, sauf avis contraire**

- La liste est le mode `/` de la palette.
- Les touches sont à soi : gardées dans la configuration de l'application avec
  les autres raccourcis, jamais dans le fichier versionné du projet. Un collègue
  qui reçoit les prompts du projet ne reçoit pas mes touches.
- `Ctrl+Maj+1` est la touche du 1 de la rangée des chiffres, en AZERTY comme en
  QWERTY, où Maj+1 donne `!`.
- Un nouveau prompt prend le premier numéro qui n'est ni à un prompt perso ni à un
  prompt du projet ouvert : il n'est masqué nulle part à sa création. Les prompts
  déjà enregistrés reçoivent les leurs une fois, dans l'ordre de la liste.
- Changer de touche suit la règle des Réglages : Échap annule, Suppr retire la
  touche, une combinaison déjà prise est retirée à l'autre commande, et on le dit.
- Un prompt perso masqué dans le projet ouvert montre son numéro grisé, avec le
  nom du prompt qui le prend ; les Réglages ne comptent pas ce masquage parmi les
  conflits.
- Un prompt lancé par sa touche fait ce que fait son clic : `{saisie}` ouvre sa
  fenêtre, une variable sans valeur le dit, et sans onglet Claude un prompt `send`
  en ouvre un.

**Critère.** Dans un onglet Claude, `Ctrl+Maj+2` envoie mon premier prompt sans
que je touche la souris ; `Ctrl+Maj+1` ouvre la liste, trois lettres et Entrée en
lancent un autre. Dans la vue Prompts, je lis la touche de chaque prompt et j'en
change une sans ouvrir les Réglages.

**État.** Faite, selon [`design-prompts-clavier.md`](design-prompts-clavier.md) : un
numéro est le raccourci de la commande du prompt, donné par `loadPrompts` à tout
prompt qui n'en a jamais eu ; la rangée des chiffres se lit par son chiffre avec
Ctrl ou Alt, ce qui rend aussi au jeu JetBrains ses `Alt+1` et `Alt+4` en AZERTY.

---

## Constats en passant

- **Le démarrage est déjà rapide** : interface prête en 180 ms, 430 ms avec le
  processeur ralenti quatre fois (2026-09-24). Charger le Markdown à la demande
  retirait 15 % du bundle principal sans gain mesurable, le morceau étant chargé
  au démarrage de toute façon : non retenu.

---

## Portage depuis ClaudeTerm

Relevé fait README de l'original en main et vérifié contre le code d'ici : **tout
est porté**.

- **Projets et Finder** : fil d'ariane et menu contextuel ; ouverture d'un fichier,
  aperçu rapide (Espace), glisser d'un fichier sur le terminal.
- **Scripts** : gestionnaire déduit du lockfile, espaces de travail, scripts des
  dossiers liés, réutilisation d'un shell inactif.
- **Dossiers liés** au complet : règles `deny`, rôles et fichier de prompt.
- **MCP** : état des serveurs et connecteurs claude.ai, `/mcp` vers l'onglet
  Claude, édition, serveurs des dossiers liés, reprise depuis un autre projet,
  écriture des portées user et local par la CLI.
- **Terminal** : intégration shell, `claude` tapé dans un shell qui en fait un
  onglet Claude, images vers le prompt, bouton Capture, police en préférence.
- **Bloc session** : il suit l'onglet Claude actif, avec mode, mode plan et
  tokens ; ouverture automatique du plan, plan rendu en markdown.
- **Panneau droit** : skills des plugins, formulaire des réglages, retrait d'une
  session à la corbeille, arrêt de processus au survol, worktrees.
- **Skills** : les trois modes d'invocation, `.claude/commands`, import, dépôt,
  copie entre projet et perso, rédaction par Claude.
- **Notifications** : routage, affichage système, effacement à la reprise,
  compteur de la barre des tâches.
- **Application** : palette de commandes et raccourcis modifiables, interface en
  français ou en anglais.

---

**Étape suivante** : `/sc:design` sur la ou les pistes retenues.
