# Sécurité et données

Ce que l'application protège, et ce qu'elle écrit sur le disque.

## Pourquoi le serveur exige un jeton

Il n'écoute que sur `127.0.0.1`, et cela ne suffit pas : n'importe quelle page web
ouverte dans le navigateur peut joindre cette adresse, et **une connexion WebSocket
n'est pas soumise à la politique d'origine**. Sans contrôle, un site visité
pourrait ouvrir un shell sur la machine.

D'où deux verrous, tous deux couverts par des tests : un jeton tiré au démarrage,
exigé sur chaque requête et sur la négociation WebSocket, et le refus de toute
origine qui n'est pas la nôtre.

## Ce que les panneaux écrivent

La section Claude Code des Réglages présente `settings.json` en formulaire — général, permissions,
hooks, environnement, plugins — avec le JSON brut replié en dessous. Chaque champ
s'écrit seul, par une édition chirurgicale : les clés que le formulaire ne connaît
pas, et la mise en forme du fichier, restent telles quelles. Une valeur vidée retire
sa clé plutôt que d'écrire une chaîne vide que Claude Code prendrait pour un réglage.
Les écritures d'un même fichier sont enchaînées : deux champs enregistrés coup sur
coup liraient sinon le même état, et le second effacerait le premier.

Les magasins lisent et écrivent ; l'interface expose les deux. Quatre garde-fous,
tous couverts par des tests :

- **Les routes qui écrivent sont séparées des lectures et réservées à POST**, pour
  qu'aucune ne parte sur une simple navigation.
- **Un nom de dossier de skill est validé avant de composer un chemin** : il sert
  à une suppression récursive, et un `..` ou un séparateur la ferait sortir du
  dossier des skills. Un nom de serveur MCP ne peut pas porter de point, qui
  désignerait une clé imbriquée plutôt qu'un serveur.
- **L'édition brute de `settings.json` est analysée avant d'atteindre le disque**,
  et l'original est sauvegardé avant la première modification.
- **Seule la portée projet des serveurs MCP s'écrit.** `~/.claude.json` porte aussi
  l'historique et l'état de chaque projet : les portées perso et locale passent par
  la CLI `claude mcp`.
- **Un serveur MCP copié dans le projet n'y apporte pas ses secrets en clair.** Le
  `.mcp.json` est partagé avec le projet : la copie est refusée tant que les valeurs
  de `env` et `headers` ne passent pas par des variables d'environnement (`${NOM}`).

Les suppressions demandent un second clic plutôt qu'une fenêtre de confirmation :
cela écarte le geste involontaire sans bloquer la page.

## Ce que Clide demande à Internet

Le serveur n'écoute que sur la machine. Ce que Clide demande au dehors se limite
à ceci :

- **L'API d'usage d'Anthropic**, au clic sur « Actualiser » des limites de
  l'abonnement seulement, avec le jeton de connexion de Claude Code, qui n'est
  jamais renouvelé ici (voir [l'usage de l'abonnement](panneau-global.md#usage-de-l-abonnement)).
- **status.claude.com et le registre npm**, pour
  [la version de Claude Code et l'état des services](panneau-global.md#claude-code-et-services-anthropic) :
  deux adresses publiques, demandées sans identifiant, à l'ouverture de l'onglet
  Consommation, et gardées de 5 minutes à une heure. « Mettre à jour Claude Code »
  ne télécharge rien lui-même : il lance `claude update` dans un onglet, à la vue.
- **Claude, par `claude -p`**, au clic seulement, pour
  [le schéma d'une session](session.md#schema-de-la-session) et
  [ses rédactions](session.md#message-de-commit-et-description-de-mr) : un résumé
  de la session — ses demandes, et les diffs de ses fichiers — part chez
  Anthropic par Claude Code et son compte, comme dans une session.
- **Le dépôt distant et sa forge**, par les outils de la machine et leurs propres
  connexions — l'application ne voit aucun jeton : les gestes git qu'on lance
  (fetch, pull, push, mise à jour de plusieurs dépôts), et l'état de la MR de la
  branche par `gh pr view` ou `glab mr view` (voir [Git](git.md)).
- **Les versions publiées de Clide sur GitHub**, pour l'application de bureau, au
  démarrage puis toutes les 6 heures quand Réglages › Mises à jour ›
  « Automatiques » est coché.

Le sondage des serveurs de développement ne vise que la machine : une adresse
qui n'est pas `localhost`, `127.0.0.1` ou `[::1]` est refusée.

## Dossier de données, et reprise d'une installation antérieure

Ce que l'application garde pour elle — index des sessions et de la recherche,
schémas, rédactions, sauvegardes des fichiers restaurés, profil PowerShell,
événements des hooks, terminaux à rouvrir, mémos des projets — vit dans
`%LOCALAPPDATA%\clide`. Rien n'y est nécessaire à Claude Code, et le dossier se
reconstruit s'il est supprimé, à une exception près : le Mémo des projets, ci-dessous,
qui est à soi.

Le [Mémo](projet.md#memo) de chaque projet y vit : `memo.json` pour ses liens et ses
fichiers épinglés, `memo\` pour ses notes. Rien n'en est écrit dans le projet.
L'éditeur n'ouvre, de tout le dossier de données, que `memo\`. Une adresse n'est
gardée qu'en http, https ou mailto, contrôlée à l'écriture puis de nouveau à
l'ouverture : un lien ne lance rien d'autre que le navigateur ou la messagerie,
même si `memo.json` a été modifié à la main. Un fichier ne s'épingle que s'il est
dans un projet ouvert, ses dossiers liés ou ses worktrees.

Pour [rouvrir les onglets au lancement](terminaux.md#rouvrir-les-onglets-au-lancement),
Clide y écrit `terminals.json`, la liste des terminaux ouverts — dossier, nom,
session Claude, commande en cours —, et `scrollback\`, la fin de la sortie de
chaque shell (256 Kio au plus). Ce qu'un shell a affiché se retrouve donc sur le
disque, un jeton ou un mot de passe affiché compris. Décocher Réglages › Terminal ›
« Rouvrir les onglets de terminal » efface les deux, et plus rien n'y est écrit. À
la lecture, une session qui n'est pas un identifiant de session et une commande qui
porte un retour à la ligne sont écartées : un fichier modifié à la main ne fait
rien lancer d'autre que la reprise.

Une installation antérieure au nom Clide, qui s'appelait claude-ide, est reprise
au premier lancement, sans rien écraser :

- `%LOCALAPPDATA%\claude-ide` : chaque entrée absente du nouveau dossier y est
  déplacée, et l'ancien dossier disparaît une fois vide ;
- les hooks de notification qui pointaient vers l'ancien dossier sont repointés ;
- dans chaque projet, `.claude/claude-ide.json` devient `.claude/clide.json` à la
  première ouverture d'un terminal, et l'ancien prompt généré est retiré ;
- les préférences et les projets ouverts du navigateur sont relus sous l'ancienne
  clé tant que la nouvelle n'existe pas.
