import { defineConfig } from "vitepress";

// Guide d'utilisation de Clide, servi par l'application elle-même sous `/docs/` :
//   pnpm docs:dev      — prévisualisation, http://localhost:5175/docs/
//   pnpm docs:build    — site statique dans docs/guide/.vitepress/dist, que le serveur sert
// Aucun déploiement, aucun appel extérieur : la recherche est locale.
export default defineConfig({
  title: "Clide",
  description: "Guide d'utilisation de Clide, poste de travail Windows pour Claude Code.",
  lang: "fr-FR",
  base: "/docs/",
  // `head` ne suit pas `base` : le chemin de l'icône le porte lui-même.
  head: [["link", { rel: "icon", type: "image/png", href: "/docs/favicon.png" }]],
  // Le serveur de l'application sert des fichiers : `session.html`, pas `session`.
  cleanUrls: false,
  themeConfig: {
    logo: "/logo.png",
    nav: [
      { text: "Présentation", link: "/" },
      { text: "La session", link: "/session" },
      { text: "Git", link: "/git" },
    ],
    sidebar: [
      {
        text: "Prendre en main",
        items: [
          { text: "Présentation", link: "/" },
          { text: "Terminaux", link: "/terminaux" },
          { text: "La session", link: "/session" },
        ],
      },
      {
        text: "Travailler",
        items: [
          { text: "Aperçu du serveur de développement", link: "/apercu" },
          { text: "Git et worktrees", link: "/git" },
          { text: "La colonne du projet", link: "/projet" },
          { text: "Le panneau global", link: "/panneau-global" },
        ],
      },
      {
        text: "Réglages",
        items: [
          { text: "Personnaliser", link: "/personnaliser" },
          { text: "Sécurité et données", link: "/securite" },
        ],
      },
    ],
    search: {
      provider: "local",
      options: {
        translations: {
          button: { buttonText: "Rechercher", buttonAriaLabel: "Rechercher" },
          modal: {
            noResultsText: "Aucun résultat pour",
            resetButtonTitle: "Effacer la recherche",
            footer: { selectText: "choisir", navigateText: "naviguer", closeText: "fermer" },
          },
        },
      },
    },
    outline: { label: "Sur cette page", level: [2, 3] },
    docFooter: { prev: "Précédent", next: "Suivant" },
    darkModeSwitchLabel: "Apparence",
    sidebarMenuLabel: "Menu",
    returnToTopLabel: "Haut de page",
  },
});
