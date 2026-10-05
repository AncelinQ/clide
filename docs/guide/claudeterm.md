# Différences avec ClaudeTerm

Clide vient de ClaudeTerm, l'application macOS de Jérôme Laval, dont il reprend
l'idée et aucune ligne. Tout ce que ClaudeTerm fait, Clide le fait, à deux
exceptions près dites à la fin. Cette page liste ce que Clide a en plus.

## Git et worktrees

ClaudeTerm ne parle pas à git, hormis la branche lue dans l'index des sessions.

- La **branche dans la barre de titre**, avec l'avance, le retard, les fichiers
  touchés, la divergence et la branche distante supprimée ; les mêmes signes sur
  chaque onglet de projet et chaque dossier lié.
- **Fetch, pull en avance rapide, push confirmé** avec l'aperçu des commits ;
  push forcé protégé par `--force-with-lease`, à double confirmation, avec alerte
  sur `main`.
- **Vue Commit** : les fichiers à cocher, rangés par dossier, dossiers et groupes
  repliables d'un clic, gardés repliés avec le projet ; le message rédigé depuis la
  session.
- **Branches** : en changer, en créer, avec un stash proposé puis réapplicable.
- **Worktrees** : ouvrir ou créer une branche dans un worktree avec Claude ;
  panneau des worktrees, leur état, les sessions rattachées, le retrait gardé.
- **MR ou PR** de la branche, état de la CI et décision des relecteurs, par
  `glab` et `gh`.
- **Mettre à jour tous les projets** ouverts et leurs dossiers liés, avec rapport.

## Suivi de session

- **Coûts** : dans la barre d'état, dans History et dans l'activité ; panneau des
  coûts par jour, projet et modèle, avec des tarifs déduits. ClaudeTerm n'avait
  qu'un compteur de tokens.
- **Usage** de l'abonnement : les limites, des jauges, une ligne de statut à
  installer.
- **File d'attente des prompts**, affichée et alimentable.
- **Sous-agents** : descendre dans l'activité d'un appel `Agent`, et remonter.
- **Détail d'une ligne** d'activité, et « Voir dans le terminal ».
- **Captures** : vignettes dans l'activité et galerie.
- **Restaurer un fichier** à son état d'avant la session, avec ses garde-fous.
- **Schéma** de la session et **Rédaction** d'un message de commit ou d'une
  description de MR, par `claude -p`.
- Fichiers : diff repliable par fichier, tri, badges, et les **écritures des
  commandes Bash** ; tri « plus récents en haut », modes masquables.
- **Rattachement exact** de l'onglet à sa session par les hooks, dès le
  démarrage et à chaque `/clear` ; un clic dans History ne détache plus la
  session vivante, et le bloc dit quand il est détaché.

## Panneau global

- **Recherche** plein texte dans tous les transcripts.
- **Chantiers** : ticket, branche, worktree, sessions, MR, avec le lien Linear.
- History montre la MR, le ticket et le coût de chaque session.
- Skills synchronisés depuis claude.ai et d'organisation.
- MCP : édition dans toutes les portées, secrets masqués, serveurs des dossiers
  liés.
- Réglages : édition chirurgicale de `settings.json`, mise en forme préservée,
  sauvegarde avant la première écriture.
- Alertes : état des hooks, script à mettre à jour, anciennes installations.
- Disposition des onglets en ligne ou en colonne, choix des onglets affichés.

## Terminaux et serveurs

- Les **terminaux survivent au rechargement** de la page, avec leur sortie.
- **Modèle de la session** changé par un sélecteur ; taille du contexte dans la
  barre d'état.
- **Serveurs de développement** : adresse détectée dans la sortie, serveurs
  lancés par Claude repérés par leur port, ouverts dans le navigateur d'un clic.

## Application

- **Palette de commandes** et **raccourcis modifiables** ; ClaudeTerm les fixait.
- **Couleurs de l'interface** : presets, dégradés, une palette par mode.
- Langue changée sans relancer.
- Largeurs de colonnes réglables et mémorisées ; changer de projet ramène son
  dernier onglet.
- Guide intégré, avec un `ⓘ` par mode qui pointe vers sa page.
- Explorateur : fichiers cachés affichables ; ce que Windows exécuterait est
  montré plutôt que lancé.
- Version web dans un navigateur, en plus du bureau.

## Ce que ClaudeTerm garde en propre

Ce qui tient à macOS — Quick Look, le Finder, le badge du Dock — a son
équivalent Windows : l'aperçu par Espace, l'Explorateur, le compteur sur le bouton
de la barre des tâches. Restent deux différences : le panneau Process de
ClaudeTerm affiche le pourcentage de processeur de chaque processus, que Clide
ne relève pas ; et son écran d'accueil liste des dossiers fixes, là où Clide
propose les dossiers récents dans la fenêtre « Ouvrir un projet ».
