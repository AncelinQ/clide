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

Les transcripts savent déjà beaucoup : numéro de MR, dépôt, URL, branche,
worktree. Ils ne savent pas si la MR est passée, ni où en est le ticket.

Aller le demander veut dire des jetons d'accès, donc **un stockage de secrets —
ce que l'application n'a jamais fait, et pas par hasard**. Elle ne lit aujourd'hui
que des fichiers déjà présents sur le poste, ce qui la rend inoffensive en cas de
fuite. Franchir ce pas change sa nature ; s'en tenir à la lecture limite ce que la
piste 3 peut promettre.

### 3. La file d'attente est-elle reconstituable, ou seulement observable ?

`queue-operation` décrit ce qui *a été* mis en file, pas ce qui y reste.
Reconstituer l'état courant demande de rejouer les opérations, et rien ne dit
qu'`enqueue` soit la seule. **À vérifier sur le corpus avant d'en promettre
l'affichage** : une file fausse est pire qu'une file absente.

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

---

## Piste 6 — Les sous-agents

**Le besoin.** 958 events `agent-name`, 12 transcripts de sous-agents déjà lus par
l'inventaire, et rien qui les montre.

**Ce qu'on attend** : depuis l'activité d'une session, descendre dans celle d'un
sous-agent et remonter.

**Coût faible** : la lecture est faite, il manque la navigation.

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

## Ce qui n'est pas porté depuis ClaudeTerm

Relevé exhaustif, README de l'original en main et vérifié contre le code d'ici.
**Ce qui n'y figure pas est porté** : fil d'ariane et menu contextuel du Finder,
détection du gestionnaire par le lockfile, espaces de travail, `.claude/commands`,
les trois modes d'invocation des skills, la progression du plan, les dossiers
liés au complet — règles `deny`, rôles et fichier de prompt —, l'état des
serveurs MCP et les connecteurs claude.ai, le routage des notifications,
leur affichage système, leur effacement à la reprise et le compteur de la barre
des tâches, la réutilisation d'un shell inactif pour les scripts, l'arrêt de processus au
survol, la police du terminal,
l'ouverture d'un fichier depuis le Finder, l'intégration shell, les worktrees.

Les manques renvoyés à une piste y sont déjà traités.

### Barre de titre et projets

| Manque | Détail |
|---|---|
| Raccourcis d'ouverture et de navigation | ⌘N nouveau projet, ⌘O ouvrir, ⇧⌘W fermer, ⌥⌘[ ] changer de projet — piste 5 |
| Bouton Capture dans la barre d'onglets | déclenche une capture d'écran vers le prompt |

### Finder

| Manque | Détail |
|---|---|
| Aperçu rapide (Espace) | lire un fichier sans quitter l'application ni ouvrir d'éditeur |
| Glisser un fichier sur le terminal | insère son chemin dans le prompt. Le glisser **interne** reste faisable ; celui qui vient de l'Explorateur ne l'est pas dans un navigateur, qui ne voit jamais le chemin réel |

### Scripts

| Manque | Détail |
|---|---|
| Scripts des dossiers liés | seuls ceux du projet et de ses espaces de travail sont listés |

### MCP du projet

| Manque | Détail |
|---|---|
| Serveurs des dossiers liés | on ne voit que le `.mcp.json` du projet courant |
| Éditer un serveur | on ajoute et on retire ; modifier demande de retirer puis rajouter |
| Copier depuis un autre projet | reprendre un serveur déjà configuré ailleurs sans le retaper |

### Terminal

| Manque | Détail |
|---|---|
| Taper `claude` bascule l'onglet en mode Claude | le mode est décidé à l'ouverture ; un `claude` lancé à la main dans un shell reste un shell, donc sans plan, activité ni fichiers |
| Raccourcis d'onglet | ⌘T shell, ⇧⌘T Claude, ⌘W fermer, ⇧⌘[ ] naviguer — piste 5 |
| Images vers le prompt | glisser-déposer d'un fichier ou d'une image, capture d'écran (⌥⌘S), collage d'une image (⌘V). Tout devient un fichier dont le chemin est tapé dans le prompt |
| Barre d'état : mode de permission, plan, tokens | elle montre le dossier, le type d'onglet, l'état et le code de sortie |

### Bloc session

| Manque | Détail |
|---|---|
| Ouverture automatique du plan | l'original bascule sur Plan quand Claude entre en mode plan ; ici il faut y aller |
| Rendu markdown du plan | le texte est affiché tel quel ; la progression, elle, est bien calculée |
| Tokens dans l'activité | le flux montre messages, outils et fichiers, sans coût ni volume |
| Raccourci de repli | ⌥⌘3 chez l'original — piste 5 |

### Panneau droit

| Manque | Détail |
|---|---|
| History : supprimer une session | aucune route d'écriture. C'est une suppression de fichier dans `~/.claude/projects`, donc à traiter avec les mêmes précautions que la piste 7 |
| Skills : plugins | les skills livrés par un plugin ne sont pas listés |
| MCP : écrire les portées user et local | lecture seule ici, et à raison : elles vivent dans `~/.claude.json`, qu'on ne réécrit pas. L'original passe par `claude mcp add` et `claude mcp remove` |
| MCP : envoyer « /mcp » à l'onglet Claude | pour lancer l'authentification d'un serveur sans quitter l'application |
| Réglages : formulaire | modèle, permissions, hooks, env, plugins, plutôt que du JSON brut. Les clés inconnues sont préservées des deux côtés |

### Skills

| Manque | Détail |
|---|---|
| Création écrite par Claude | l'original sait créer un skill vide ou envoyer la demande à Claude, qui rédige le `SKILL.md` |
| Importer un `.md` ou un dossier | reprendre un skill venu d'ailleurs |
| Glisser-déposer | même chose, au geste |
| Copier entre projet et perso | promouvoir un skill de projet en skill personnel, et l'inverse |

### Application

| Manque | Détail |
|---|---|
| Localisation FR / EN | l'interface est en français seulement. L'original garde ses chaînes françaises en source et une table anglaise à côté |

---

**Étape suivante** : `/sc:design` sur la ou les pistes retenues.
