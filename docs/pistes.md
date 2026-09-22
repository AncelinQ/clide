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

## La question qui oriente tout

À quoi sert cette application, au juste ?

- **Un poste de pilotage** : je lance, je surveille, j'interviens. Ce qui compte
  est l'instant présent — qui tourne, qui attend, qui a échoué.
- **Un journal de bord** : je retrouve, je comprends, je rends compte. Ce qui
  compte est le passé — ce qui a été fait, combien ça a coûté, où c'est parti.

Les deux lectures ne priorisent pas la même chose, et les panneaux actuels font
un peu des deux sans trancher. **Cette question mérite d'être tranchée avant
d'ajouter quoi que ce soit** : elle décide de ce qui mérite la place centrale.

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

**La difficulté.** `queue-operation` décrit ce qui *a été* mis en file, pas ce qui
y reste. Reconstituer l'état courant demande de suivre les opérations, et rien ne
dit qu'`enqueue` soit la seule. **À vérifier avant de promettre quoi que ce soit.**

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

**La question ouverte.** Faut-il que l'application parle à Linear et GitLab
elle-même, ou se contenter de ce que les transcripts en disent ? Parler aux deux
demande des jetons, donc un stockage de secrets — ce que l'application n'a jamais
fait jusqu'ici, et pas par hasard.

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

## Ce qui reste de l'audit ClaudeTerm

Écarts relevés en comparant au README de l'original, par ordre de valeur :

| | Écart |
|---|---|
| Réglages | un **formulaire** plutôt que du JSON brut |
| MCP | **statut** des serveurs via `claude mcp list` |
| History | **supprimer** une session |
| Terminal | taper `claude` dans un shell **bascule l'onglet en mode Claude** |
| Images | **coller** une image, **capturer** l'écran vers le prompt |
| Barre d'état | mode de permission, plan, **tokens** |
| Plan | rendu **markdown**, ouverture automatique à l'entrée en mode plan |
| Scripts | inclure ceux des **dossiers liés**, réutiliser un onglet inactif |
| Skills | **importer** un .md ou un dossier, **copier** entre projet et perso |

---

## Questions ouvertes

1. **Poste de pilotage ou journal de bord ?** La réponse décide de ce qui occupe
   le centre et de ce qui reste dans un panneau.
2. **L'application doit-elle parler à Linear et GitLab**, ou rester en lecture de
   ce que Claude Code écrit ? La première option lui fait stocker des secrets pour
   la première fois.
3. **La file d'attente est-elle reconstituable** depuis les events, ou seulement
   observable ? À vérifier avant d'en promettre l'affichage.
4. **Quelle place pour l'écriture destructrice** ? La restauration de fichiers est
   la capacité la plus distinctive, et la plus dangereuse.

**Étape suivante** : `/sc:design` sur la ou les pistes retenues.
