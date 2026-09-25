# Git et worktrees

La branche du projet, ses gestes courants et ses worktrees, sans quitter l'application.

## Branche, fetch, pull, push

La barre de titre montre la branche du projet ouvert, son avance (↑) et son
retard (↓) sur l'amont, et le nombre de fichiers à committer (●), relevés toutes
les dix secondes et au retour sur la fenêtre. Les mêmes signes suivent le nom de
chaque projet ouvert, dans son onglet, et chaque dossier lié : on voit d'un coup
d'œil ce qui attend un commit ou un push, sans ouvrir le projet. Une branche qui a
divergé de son amont — des commits de part et d'autre, après un rebase le plus
souvent — porte ⇅ en rouge ; une branche dont l'amont a été supprimé, « distante
supprimée ». Le survol détaille tout en toutes lettres, et le menu le rappelle en
tête. Son menu fait les gestes courants par le
`git` local, qui passe par le gestionnaire d'identifiants de Windows : l'application
ne stocke aucun secret, et git ne s'arrête jamais sur une demande de mot de passe
en terminal (`GIT_TERMINAL_PROMPT=0`).

- **Fetch** (`--prune`).
- **Pull** en avance rapide seulement : une fusion ou un rebase décidés par un
  bouton réécriraient l'historique sans qu'on l'ait regardé.
- **Push** fait d'abord un fetch, puis montre ce qui partira — branche distante,
  commits, amont créé pour une branche neuve — et ne part qu'une fois validé. Le
  serveur refuse si la branche a bougé depuis cet aperçu, ou si elle est en retard
  sur son amont.
- **Push forcé**, seulement pour une branche qui a divergé. La fenêtre liste les
  commits distants qu'il effacerait, demande une seconde confirmation, et prévient
  quand la cible est une branche principale (`main`, `master`, `develop`). Il part
  en `--force-with-lease` contre le commit distant que l'aperçu a montré : si
  quelqu'un a poussé entre-temps, git refuse au lieu d'effacer son travail. Une
  branche qui n'est qu'en retard n'a rien à envoyer, et ne se force pas : ce ne
  serait que détruire des commits distants.

« Branches et worktrees… » liste les branches locales, puis celles qui n'existent
que sur un dépôt distant — les choisir crée la branche locale qui les suit. La
fenêtre fait un fetch à l'ouverture et complète la liste : une branche poussée par
un collègue y apparaît sans fetch préalable. Elle s'ouvre aussi par un clic droit
sur l'onglet d'un projet, quel qu'il soit, et sur un dossier lié par son menu « ⋯ ».

- **Changer de branche** avec des modifications non commitées de fichiers suivis
  ne se fait pas en silence : la fenêtre dit combien de fichiers sont en jeu et
  propose de les mettre de côté (`git stash push --include-untracked`, sous un
  message qui dit de quelle branche ils viennent). « Réappliquer le dernier stash »
  apparaît dans le menu tant qu'il en reste un. Si le changement échoue, le stash
  est réappliqué. Les fichiers non suivis, eux, ne bloquent rien : git les laisse
  en place d'une branche à l'autre, et refuse seul — en le disant — ceux qu'un
  fichier de l'autre branche écraserait.
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

## Mettre à jour plusieurs dépôts

Le bouton ☁↓ de la barre de titre tire d'un coup tous les projets ouverts et leurs
dossiers liés. Le clic droit sur l'onglet d'un projet le tire seul, ou avec ses
dossiers liés ; le panneau Dossiers liés tire chacun, ou tous.

C'est toujours un pull en avance rapide, quelques dépôts à la fois, et un dossier
cité deux fois — ouvert, et lié à un autre projet — n'est tiré qu'une fois. Une
fenêtre rend compte de chacun : combien de commits sont arrivés, qu'il était à
jour, pourquoi il a été écarté, ou l'erreur de git telle quelle. Le pull d'un dépôt
n'arrête pas celui des autres.

Sont écartés sans lancer `git pull` : un dossier qui n'est pas un dépôt, un HEAD
détaché, une branche sans amont, et une branche dont l'amont a disparu. Ce dernier
cas est celui d'une branche de MR supprimée après sa fusion : git répondrait « no
such ref was fetched », et il n'y a en effet rien à tirer — il faut repasser sur la
branche principale.

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
