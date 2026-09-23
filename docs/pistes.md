# Pistes

Exploration de ce que claude-ide pourrait faire ensuite. Ce document décrit des
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
