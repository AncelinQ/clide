# Git et worktrees

La branche du projet, ses gestes courants et ses worktrees, sans quitter l'application.

## Branche, fetch, pull, push

La barre de titre montre la branche du projet ouvert, son avance (↑) et son
retard (↓) sur l'amont, et le nombre de fichiers touchés (●), relevés toutes les
dix secondes et au retour sur la fenêtre. Son menu fait les gestes courants par le
`git` local, qui passe par le gestionnaire d'identifiants de Windows : l'application
ne stocke aucun secret, et git ne s'arrête jamais sur une demande de mot de passe
en terminal (`GIT_TERMINAL_PROMPT=0`).

- **Fetch** (`--prune`).
- **Pull** en avance rapide seulement : une fusion ou un rebase décidés par un
  bouton réécriraient l'historique sans qu'on l'ait regardé.
- **Push** montre d'abord ce qui partira — branche distante, commits, amont créé
  pour une branche neuve — et ne part qu'une fois validé. Le serveur refuse si la
  branche a bougé depuis cet aperçu, ou si elle est en retard sur son amont ; il
  ne force jamais.

« Branches et worktrees… » liste les branches locales, puis celles qui n'existent
que sur un dépôt distant — les choisir crée la branche locale qui les suit.

- **Changer de branche** avec des modifications non commitées ne se fait pas en
  silence : la fenêtre dit combien de fichiers sont en jeu et propose de les
  mettre de côté (`git stash push --include-untracked`, sous un message qui dit de
  quelle branche ils viennent). « Réappliquer le dernier stash » apparaît dans le
  menu tant qu'il en reste un. Si le changement échoue, le stash est réappliqué.
- **Créer une branche** part de HEAD et garde les modifications en cours.
- **Ouvrir dans un worktree** crée le worktree sous `.claude/worktrees/`, là où
  Claude Code range les siens, et y lance un onglet Claude. Le dossier est exclu
  dans `.git/info/exclude`, propre au clone : sans cela il compterait parmi les
  modifications du dépôt principal.

Le panneau Worktrees ouvre aussi Claude dans un worktree, ou le worktree comme un
projet à part entière, avec son navigateur de fichiers et ses panneaux.

**La MR ou la PR de la branche** s'affiche à côté d'elle — `!196` sur GitLab,
`#12` sur GitHub — avec un point qui dit l'état de la CI. Le menu l'ouvre, ainsi
que son pipeline, et dit si elle est ouverte, en brouillon, fusionnée ou fermée,
et la décision des relecteurs sur GitHub. La forge se lit dans l'adresse du dépôt
distant ; l'état vient de `glab mr view` ou de `gh pr view`, qui gardent leur
propre connexion : l'application ne voit aucun jeton. Chaque appel coûte une
seconde, la réponse est gardée une minute. Une CLI absente ou déconnectée le dit
dans le menu.

## Worktrees

Le panneau lit `git worktree list --porcelain`, puis l'état de chacun : fichiers
non commités, avance et retard sur la branche amont. C'est ce qui distingue un
worktree encore en cours d'un worktree simplement oublié.

Deux points méritent d'être dits :

- **Les chemins sont résolus des deux côtés avant d'être comparés.** Git rend
  toujours sa propre résolution : un dossier atteint par un nom court
  `ADM-A~1.QUI`, par une jonction ou dans une autre casse ressort sous sa forme
  longue. Sans cette résolution, aucune session ne se rattache à son worktree.
- **Le retrait refuse un worktree qui porte du travail non commité.**
  `git worktree remove --force` saurait le faire ; ce forçage n'est pas exposé,
  parce que ce travail-là ne se retrouve nulle part. Le dépôt principal et tout
  chemin hors du projet sont refusés de la même façon.
