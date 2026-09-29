# Aperçu du serveur de développement

Le rendu de l'application qu'on développe, à côté du terminal, sans rien configurer.

Une commande du shell qui annonce une adresse locale en démarrant — la ligne
`Local: http://localhost:5173/` de `vite`, `next dev` et consorts — la fait
connaître à l'onglet : le bouton d'aperçu de la barre flottante d'un onglet Claude
prend un point vert, et l'ouvre à côté du terminal ; `Ctrl+Maj+U` aussi, depuis
n'importe quel onglet. Plusieurs serveurs se choisissent dans
l'en-tête de l'aperçu ; l'adresse s'oublie quand la commande se termine.

L'aperçu est propre à chaque projet : ouvert ou fermé, serveurs ou navigateur de
Claude, chacun garde le sien et le retrouve quand on revient dessus.

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

## Le navigateur de Claude

Le bouton 🤖 de la barre de l'aperçu, ou « Voir le navigateur de Claude » dans la
palette, montre à la place le navigateur que Claude pilote par son MCP. Clide lance
un Chrome (ou un Edge, à défaut) sans fenêtre, débogable sur `127.0.0.1:9333`
seulement, avec un profil à lui dans les données de l'application : ni tes cookies
ni tes sessions. Un navigateur qui écoute déjà sur ce port, lancé par un Clide
précédent, est repris. ⏻ l'arrête ; il s'arrête aussi avec Clide.

**Brancher Claude.** Le bouton 🔌 ouvre une ligne qui déclare, pour le projet et
en portée locale (à toi seul, rien dans le dépôt), un serveur MCP `clide-browser`
branché sur ce port : `chrome-devtools-mcp` (`--browserUrl`) ou Playwright MCP
(`--cdp-endpoint`). Chaque bouton montre sa commande au survol et la lance par
`claude mcp add-json` ; les sessions
Claude ouvertes ensuite dans le projet l'ont. Si un autre MCP navigateur est
déclaré, demande à Claude d'utiliser les outils de `clide-browser`.

**Voir et reprendre la main.** L'aperçu suit la page que Claude vient d'ouvrir ; le
sélecteur passe d'une page à l'autre, la barre d'adresse navigue. Sur une page vide,
elle propose l'adresse du serveur de développement du projet : Entrée l'ouvre. Le
même navigateur sert tous les projets ; revenir sur un projet remontre la page qu'on
y regardait, si elle est encore ouverte. Clide choisit parmi les pages, il ne
navigue jamais à la place de Claude. L'image n'est
produite que pendant qu'un aperçu la regarde. Un clic, la molette et la frappe sur
l'image vont à la page — Entrée, Échap, Tab, les flèches et l'effacement comme
touches, le reste comme texte tapé, et `Ctrl+V` colle.

Jamais le port de débogage d'Electron : il donnerait la main sur toute
l'application, jeton compris.
