# Serveurs de développement

L'adresse de l'application qu'on développe, à portée de clic, sans rien configurer.

Une commande du shell qui annonce une adresse locale en démarrant — la ligne
`Local: http://localhost:5173/` de `vite`, `next dev` et consorts — la fait
connaître à l'onglet. Le bouton des serveurs, dans la barre flottante d'un onglet
Claude, prend alors un point vert ; son menu liste les serveurs du projet, chacun
nommé par ce qui le sert, et un clic l'ouvre dans ton navigateur. `Ctrl+Maj+U`,
depuis n'importe quel onglet, ouvre le dernier lancé. Une adresse s'oublie quand la
commande se termine.

Un serveur que Claude lance lui-même en arrière-plan n'écrit rien dans l'onglet :
il est retrouvé à son port. Le serveur de l'application relève les sockets en
écoute (`netstat -ano`) et garde ceux des processus qui descendent des onglets du
projet, qu'ils répondent en HTML — un débogueur ou une API en JSON n'ont rien à
montrer — et qu'ils ne soient pas un serveur MCP de Claude. Le relevé passe toutes
les trente secondes ; le menu nomme ces serveurs par leur commande.

Le serveur lit la sortie des onglets shell pendant qu'une commande tourne, jamais
celle de Claude : une adresse citée dans une réponse n'est pas un serveur. Seules
comptent les adresses de la machine avec un port (`localhost`, `127.0.0.1`, et
`0.0.0.0` qui s'ouvre par `localhost`), et la ligne tapée, que PowerShell
redessine au lancement, est écartée : `curl http://localhost:3000` n'annonce rien.
Seules les adresses de la machine sont sondées.

Pour que Claude voie l'application, un MCP navigateur (`chrome-devtools-mcp`,
Playwright MCP) s'ajoute comme tout autre serveur MCP, ou Claude in Chrome par son
extension : chacun ouvre sa propre fenêtre, à côté de celle de Clide.
