# Aperçu du serveur de développement

Le rendu de l'application qu'on développe, à côté du terminal, sans rien configurer.

Une commande du shell qui annonce une adresse locale en démarrant — la ligne
`Local: http://localhost:5173/` de `vite`, `next dev` et consorts — la fait
connaître à l'onglet : le bouton `⋯` de la barre des onglets prend un point vert, et
son entrée « Aperçu du serveur de développement » l'ouvre à côté du terminal
(`Ctrl+Maj+U`). Plusieurs serveurs se choisissent dans
l'en-tête de l'aperçu ; l'adresse s'oublie quand la commande se termine.

Un serveur que Claude lance lui-même en arrière-plan n'écrit rien dans l'onglet :
il est retrouvé à son port. Le serveur de l'application relève les sockets en
écoute (`netstat -ano`) et garde ceux des processus qui descendent des onglets du
projet, qu'ils répondent en HTML — un débogueur ou une API en JSON n'ont rien à
montrer — et qu'ils ne soient pas un serveur MCP de Claude. Le relevé passe toutes
les cinq secondes aperçu ouvert, toutes les trente sinon ; l'en-tête nomme chaque
serveur par sa commande.

Le serveur lit la sortie des onglets shell pendant qu'une commande tourne, jamais
celle de Claude : une adresse citée dans une réponse n'est pas un serveur. Seules
comptent les adresses de la machine avec un port (`localhost`, `127.0.0.1`, et
`0.0.0.0` qui s'ouvre par `localhost`), et la ligne tapée, que PowerShell
redessine au lancement, est écartée : `curl http://localhost:3000` n'annonce rien.

L'aperçu est un cadre, et un cadre refusé ne s'annonce pas à la page qui le
contient : le serveur de l'application lit donc les en-têtes de l'adresse —
`X-Frame-Options`, ou un `frame-ancestors` qui n'admet pas toute origine. Un
serveur qui refuse le cadre le dit dans l'aperçu, avec un bouton pour l'ouvrir
dans le navigateur. Seules les adresses de la machine sont sondées.
