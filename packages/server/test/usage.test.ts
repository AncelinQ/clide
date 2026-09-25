import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  installStatusline,
  limitsFromApi,
  limitsFromStatusline,
  readUsage,
  statuslineScript,
  statuslineScriptPath,
  uninstallStatusline,
  usageDir,
} from "../src/platform/usage.js";

let dir: string;
let dataDir: string;
let settings: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "clide-usage-"));
  dataDir = join(dir, "data");
  settings = join(dir, "settings.json");
  await writeFile(settings, JSON.stringify({ theme: "dark" }, null, 2));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("mise en forme des limites", () => {
  it("lit la liste de l'API, modèle d'une limite restreinte compris", () => {
    const limits = limitsFromApi({
      five_hour: { utilization: 8 },
      limits: [
        { kind: "session", percent: 8, severity: "normal", resets_at: "2026-09-25T16:59:59+00:00" },
        { kind: "weekly_all", percent: 47, resets_at: "2026-09-27T23:59:59+00:00" },
        { kind: "weekly_scoped", percent: 0, scope: { model: { display_name: "Fable" } } },
      ],
      spend: { enabled: false, percent: 0 },
    });
    expect(limits).toEqual([
      { kind: "session", percent: 8, severity: "normal", resetsAt: "2026-09-25T16:59:59+00:00" },
      { kind: "weekly_all", percent: 47, resetsAt: "2026-09-27T23:59:59+00:00" },
      { kind: "weekly_scoped", percent: 0, model: "Fable" },
    ]);
  });

  it("se rabat sur les champs historiques sans liste, et compte le crédit s'il est activé", () => {
    expect(
      limitsFromApi({
        five_hour: { utilization: 12, resets_at: "r1" },
        seven_day_opus: { utilization: 30 },
        seven_day_sonnet: null,
        spend: { enabled: true, percent: 5 },
      }),
    ).toEqual([
      { kind: "session", percent: 12, resetsAt: "r1" },
      { kind: "weekly_scoped", percent: 30, model: "Opus" },
      { kind: "spend", percent: 5 },
    ]);
  });

  it("convertit les réinitialisations de la ligne de statut, en secondes", () => {
    expect(
      limitsFromStatusline({ five_hour: { used_percentage: 23.5, resets_at: 1738425600 }, seven_day: {} }),
    ).toEqual([{ kind: "session", percent: 23.5, resetsAt: "2025-02-01T16:00:00.000Z" }]);
  });
});

describe("installation de la ligne de statut", () => {
  it("la déclare, puis la retire en laissant le reste du fichier", async () => {
    const installed = await installStatusline(dataDir, settings);
    expect(installed.installed).toBe(true);
    const value = JSON.parse(await readFile(settings, "utf8"));
    expect(value.theme).toBe("dark");
    expect(value.statusLine.command).toContain(statuslineScriptPath(dataDir));

    const removed = await uninstallStatusline(dataDir, settings);
    expect(removed.installed).toBe(false);
    const after = JSON.parse(await readFile(settings, "utf8"));
    expect(after).toEqual({ theme: "dark" });
  });

  it("refuse de remplacer une ligne de statut qui n'est pas la sienne", async () => {
    await writeFile(settings, JSON.stringify({ statusLine: { type: "command", command: "ma-ligne.sh" } }));
    await expect(installStatusline(dataDir, settings)).rejects.toThrow("ma-ligne.sh");
    await expect(uninstallStatusline(dataDir, settings)).resolves.toMatchObject({ foreign: "ma-ligne.sh" });
    expect(JSON.parse(await readFile(settings, "utf8")).statusLine.command).toBe("ma-ligne.sh");
  });
});

describe("script de la ligne de statut", () => {
  const runScript = async (input: unknown): Promise<string> => {
    const script = join(dir, "statusline.mjs");
    await writeFile(script, statuslineScript());
    return new Promise((resolve, reject) => {
      const child = execFile(process.execPath, [script, usageDir(dataDir)], (error, stdout) =>
        error ? reject(error) : resolve(stdout),
      );
      child.stdin?.end(JSON.stringify(input));
    });
  };

  it("résume l'usage, dépose le relevé, et garde les limites connues quand l'entrée n'en porte pas", async () => {
    const output = await runScript({
      session_id: "abc-123",
      model: { display_name: "Opus" },
      workspace: { current_dir: "C:/Projets/app" },
      cost: { total_cost_usd: 1.5 },
      context_window: { used_percentage: 12.4, context_window_size: 200000 },
      rate_limits: { five_hour: { used_percentage: 8, resets_at: 1790000000 }, seven_day: { used_percentage: 47 } },
    });
    expect(output).toBe("5 h 8 % · sem. 47 % · ctx 12 %");

    // Avant la première réponse de l'API, l'entrée n'a pas de limites.
    await runScript({ session_id: "abc-123", context_window: { used_percentage: 13 } });

    const report = await readUsage(dataDir, settings);
    expect(report.live?.limits.map((limit) => [limit.kind, limit.percent])).toEqual([
      ["session", 8],
      ["weekly_all", 47],
    ]);
    expect(report.sessions).toHaveLength(1);
    expect(report.sessions[0]).toMatchObject({ sessionId: "abc-123", contextPercent: 13 });
  });

  it("n'affiche rien et ne plante pas sur une entrée illisible", async () => {
    expect(await runScript("pas du json")).toBe("");
  });
});
