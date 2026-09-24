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

Le panneau Réglages présente `settings.json` en formulaire — général, permissions,
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

Les suppressions demandent un second clic plutôt qu'une fenêtre de confirmation :
cela écarte le geste involontaire sans bloquer la page.
