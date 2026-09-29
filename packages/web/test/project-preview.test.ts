import { describe, expect, it } from "vitest";

import { followPreview } from "../src/lib/project-preview.js";

const a = { root: "C:\a", previewOpen: true, previewSource: "browser" as const };
const b = { root: "C:\b", previewOpen: false, previewSource: "servers" as const };
const on = (root: string, previewOpen: boolean, previewSource: "servers" | "browser" = "servers") => ({
  activeRoot: root,
  projects: [a, b],
  previewOpen,
  previewSource,
});

describe("followPreview", () => {
  it("reprend l'aperçu du projet qu'on rejoint", () => {
    expect(followPreview(on("C:\b", false), on("C:\a", false), ["activeRoot"])).toEqual({
      previewOpen: true,
      previewSource: "browser",
    });
    expect(followPreview(on("C:\a", true, "browser"), on("C:\b", true, "browser"), ["activeRoot"])).toEqual({
      previewOpen: false,
      previewSource: "servers",
    });
  });

  it("écrit dans le projet actif l'aperçu qu'on ouvre", () => {
    const result = followPreview(on("C:\b", false), on("C:\b", true), ["previewOpen"]);
    expect(result.projects?.find((project) => project.root === "C:\b")?.previewOpen).toBe(true);
    expect(result.projects?.find((project) => project.root === "C:\a")).toBe(a);
  });

  it("donne au nouveau projet l'aperçu d'un patch qui change les deux", () => {
    const result = followPreview(on("C:\a", true, "browser"), on("C:\b", true, "browser"), ["activeRoot", "previewOpen"]);
    expect(result.projects?.find((project) => project.root === "C:\b")).toMatchObject({ previewOpen: true, previewSource: "browser" });
  });

  it("ne touche à rien sans changement", () => {
    expect(followPreview(on("C:\a", true), on("C:\a", true), ["widths"])).toEqual({});
  });
});
