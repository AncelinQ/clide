import { describe, expect, it } from "vitest";

import { mutations, routes } from "../src/api/routes.js";
import { SERVER_MODULES } from "../src/modules/index.js";
import { mountModules, type ServerModule } from "../src/modules/module.js";

const noop = async () => ({});

describe("mountModules", () => {
  it("ajoute les routes des modules à celles de base", () => {
    const table = mountModules(
      { routes: { "/api/a": noop }, mutations: {} },
      [{ id: "m", routes: { "/api/b": noop }, mutations: { "/api/b/save": noop } }],
    );
    expect(Object.keys(table.routes).sort()).toEqual(["/api/a", "/api/b"]);
    expect(Object.keys(table.mutations)).toEqual(["/api/b/save"]);
  });

  it("refuse un chemin déclaré deux fois, en nommant les deux auteurs", () => {
    const one: ServerModule = { id: "un", routes: { "/api/x": noop } };
    const two: ServerModule = { id: "deux", mutations: { "/api/x": noop } };
    expect(() => mountModules({ routes: {}, mutations: {} }, [one, two])).toThrow(/\/api\/x.*un.*deux/);
    expect(() => mountModules({ routes: { "/api/x": noop }, mutations: {} }, [one])).toThrow(/base/);
  });

  it("refuse une route hors de /api/", () => {
    expect(() => mountModules({ routes: {}, mutations: {} }, [{ id: "m", routes: { "/x": noop } }])).toThrow(/hors de \/api/);
  });

  it("monte les modules livrés sans collision, et chacun sous son chemin", () => {
    const table = mountModules({ routes, mutations }, SERVER_MODULES);
    for (const path of ["/api/scripts", "/api/usage", "/api/costs"]) expect(table.routes[path]).toBeTypeOf("function");
    expect(table.mutations["/api/usage/refresh"]).toBeTypeOf("function");
    expect(routes["/api/usage"]).toBeUndefined();
  });
});
