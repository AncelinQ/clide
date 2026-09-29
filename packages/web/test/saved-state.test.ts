import { describe, expect, it } from "vitest";

import { DEFAULT_LAYOUT, DEFAULT_PREFS, SAVED_VERSION, migrate } from "../src/lib/saved-state";

/** Forme réelle d'un état v1, chemins anonymisés. */
const V1 = {
  roots: ["C:\\Projets\\clide", "C:\\Projets\\atlas\\"],
  active: "C:\\Projets\\atlas",
  theme: "dark",
  look: { light: { accent: "#2370db" }, dark: { accent: "#7aa2f7" } },
  terminalFont: { family: "Cascadia Mono", size: 14 },
  shortcuts: { "tab.shell": "Ctrl+Shift+N", "tab.claude": null },
  language: "fr",
  tabLayout: "column",
  visibleTabs: null,
  hiddenModes: { session: ["plan"] },
  newestFirst: { activity: false },
  showHidden: true,
  widths: { left: 333, right: 374, preview: 0.5 },
  lastTab: { "C:\\Projets\\clide": "t-12" },
};

describe("migrate depuis la version 1", () => {
  const state = migrate(V1);

  it("reprend les projets, dans l'ordre, sans séparateur final", () => {
    expect(state.version).toBe(SAVED_VERSION);
    expect(state.projects.map((project) => project.root)).toEqual(["C:\\Projets\\clide", "C:\\Projets\\atlas"]);
    expect(state.active).toBe("C:\\Projets\\atlas");
  });

  it("range le dernier onglet dans son projet", () => {
    expect(state.projects[0]?.activeTab).toBe("t-12");
    expect(state.projects[1]?.activeTab).toBeNull();
  });

  it("donne aux modes et à la disposition, absents en v1, leur valeur par défaut", () => {
    expect(state.projects[0]).toMatchObject({ browsePath: "", leftMode: "explorer", bottomMode: "files" });
    expect(state.layout).toEqual({ ...DEFAULT_LAYOUT, widths: { left: 333, right: 374, preview: 0.5, bottom: 0.38 } });
  });

  it("reprend toutes les préférences", () => {
    expect(state.prefs).toEqual({
      theme: "dark",
      look: V1.look,
      vscodeTheme: null,
      uiFont: { family: "", scale: 100 },
      terminalFont: { family: "Cascadia Mono", size: 14 },
      shortcuts: { "tab.shell": "Ctrl+Shift+N", "tab.claude": null },
      language: "fr",
      tabLayout: "column",
      visibleTabs: null,
      hiddenModes: { session: ["plan"] },
      newestFirst: { activity: false },
      showHidden: true,
      keymap: "vscode",
      showCosts: true,
      disabledModules: [],
      projectsFolder: "",
      autoUpdate: true,
    });
  });
});

describe("migrate en version 2", () => {
  it("relit ce qu'il écrit à l'identique", () => {
    const once = migrate(V1);
    expect(migrate(JSON.parse(JSON.stringify(once)))).toEqual(once);
  });

  it("garde l'état propre à chaque projet et la disposition", () => {
    const state = migrate({
      version: 2,
      projects: [{ root: "C:\\a", browsePath: "src", leftMode: "mcp", bottomMode: "plan", activeTab: "t1", openFiles: ["C:/a/x.ts", "C:/a/x.ts", 3], activeFile: "C:/a/fermé.ts" }],
      active: "C:\\a",
      layout: { showLeft: false, sessionCollapsed: true, previewOpen: true, globalTab: "chantiers" },
      prefs: {},
    });
    expect(state.projects[0]).toEqual({ root: "C:\\a", browsePath: "src", leftMode: "mcp", bottomMode: "plan", activeTab: "t1", openFiles: ["C:/a/x.ts"], activeFile: null, tabOrder: [], previewOpen: false, previewSource: "servers" });
    expect(state.layout).toMatchObject({ showLeft: false, showRight: true, sessionCollapsed: true, previewOpen: true, globalTab: "chantiers" });
    expect(state.prefs).toEqual(DEFAULT_PREFS);
  });

  it("renvoie un bloc du bas resté sur le commit à son mode par défaut", () => {
    const state = migrate({ version: 2, projects: [{ root: "C:\\a", bottomMode: "commit" }, { root: "C:\\b", bottomMode: "plan" }] });
    expect(state.projects.map((project) => project.bottomMode)).toEqual(["files", "plan"]);
  });

  it("garde la police de l'interface, et une échelle connue seulement", () => {
    expect(migrate({ version: 2, prefs: { uiFont: { family: "Inter", scale: 125 } } }).prefs.uiFont).toEqual({ family: "Inter", scale: 125 });
    expect(migrate({ version: 2, prefs: { uiFont: { scale: 333 } } }).prefs.uiFont).toEqual({ family: "", scale: 100 });
    expect(migrate({ version: 2 }).prefs.uiFont).toEqual({ family: "", scale: 100 });
  });

  it("garde la source de l'aperçu, les serveurs par défaut", () => {
    expect(migrate({ version: 2, layout: { previewSource: "browser" } }).layout.previewSource).toBe("browser");
    expect(migrate({ version: 2, layout: { previewSource: "écran" } }).layout.previewSource).toBe("servers");
  });

  it("garde l'ordre rangé des onglets, sans doublon ni valeur étrangère", () => {
    const state = migrate({ version: 2, projects: [{ root: "C:\\a", tabOrder: ["t2", "C:/a/x.ts", "t2", 4] }], active: "C:\\a" });
    expect(state.projects[0]?.tabOrder).toEqual(["t2", "C:/a/x.ts"]);
  });
});

describe("migrate sur un état abîmé", () => {
  it("rend un état vide et sain pour rien, du texte ou un tableau", () => {
    for (const raw of [undefined, null, "texte", [], 42]) {
      const state = migrate(raw);
      expect(state.projects).toEqual([]);
      expect(state.active).toBeNull();
      expect(state.layout).toEqual(DEFAULT_LAYOUT);
      expect(state.prefs).toEqual(DEFAULT_PREFS);
    }
  });

  it("remplace chaque valeur illisible par sa valeur par défaut, sans perdre les autres", () => {
    const state = migrate({
      roots: ["C:\\ok", 3, "", "C:\\OK\\"],
      theme: "violet",
      language: 7,
      terminalFont: { family: "Consolas", size: "grand" },
      widths: { left: "large", right: 400 },
      hiddenModes: { session: ["plan", 1] },
      shortcuts: { a: "Ctrl+A", b: 2 },
    });
    expect(state.projects.map((project) => project.root)).toEqual(["C:\\ok"]);
    expect(state.prefs.theme).toBe("auto");
    expect(state.prefs.language).toBe("auto");
    expect(state.prefs.terminalFont).toEqual({ family: "Consolas", size: 13 });
    expect(state.layout.widths).toEqual({ left: 290, right: 400, preview: 0.5, bottom: 0.38 });
    expect(state.prefs.hiddenModes).toEqual({ session: ["plan"] });
    expect(state.prefs.shortcuts).toEqual({ a: "Ctrl+A" });
  });

  it("rouvre l'historique à la place de l'ancien onglet des réglages, et garde les coûts masqués", () => {
    const state = migrate({ version: 2, projects: [], layout: { globalTab: "settings" }, prefs: { showCosts: false } });
    expect(state.layout.globalTab).toBe("history");
    expect(state.prefs.showCosts).toBe(false);
  });

  it("range les dossiers liés, ancien mode à part, sous l'explorateur", () => {
    const state = migrate({ version: 2, projects: [{ root: "C:\a", leftMode: "links" }, { root: "C:\b", leftMode: "mcp" }] });
    expect(state.projects.map((project) => project.leftMode)).toEqual(["explorer", "mcp"]);
  });

  it("prend le premier projet quand le projet actif n'est plus ouvert", () => {
    expect(migrate({ roots: ["C:\\a", "C:\\b"], active: "C:\\fermé" }).active).toBe("C:\\a");
  });
});

describe("migrate des onglets regroupés en module", () => {
  it("rouvre l'onglet Consommation à la place de l'usage ou des coûts, dans la liste affichée aussi", () => {
    const state = migrate({
      version: 2,
      projects: [],
      layout: { globalTab: "costs" },
      prefs: { visibleTabs: ["history", "usage", "costs"], disabledModules: ["scripts", 3] },
    });
    expect(state.layout.globalTab).toBe("consumption");
    expect(state.prefs.visibleTabs).toEqual(["history", "consumption"]);
    expect(state.prefs.disabledModules).toEqual(["scripts"]);
  });
});
