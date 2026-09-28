import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  HOOK_DEFINITIONS,
  eventsDir,
  hookCommand,
  hookScript,
  hookScriptPath,
  hooksStatus,
  installHooks,
  migrateHooks,
  pruneLegacyHooks,
  uninstallHooks,
} from "../src/notifications/hook.js";
import {
  NotificationWatcher,
  parseNotification,
  type ClaudeNotification,
} from "../src/notifications/watcher.js";

interface HookEntry {
  matcher?: string;
  hooks: { type: string; command: string }[];
}

const run = promisify(execFile);

let dir: string;
let dataDir: string;
let settings: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "clide-notif-"));
  dataDir = join(dir, "data");
  settings = join(dir, "settings.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 3 });
});

/** Configuration existante : des hooks posés à la main, sur les mêmes événements. */
const EXISTING = `{
  "env": {
    "BRANCH_PREFIX": "aqn"
  },
  "model": "opus",
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [{ "type": "command", "command": "outil-maison hook" }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "outil-maison hook" }] }
    ]
  }
}
`;

describe("hookScript", () => {
  const script = hookScript();

  it("sort toujours, même si l'entrée standard ne se ferme jamais", () => {
    // Un hook s'exécute dans le chemin critique de la session : bloqué, il la bloque.
    expect(script).toContain("setTimeout(spool, 2000)");
    expect(script).toContain(".unref()");
    expect(script).toContain("process.exit(0)");
  });

  it("n'échoue jamais vers l'appelant", () => {
    expect(script).toContain("try {");
    expect(script).toContain("} catch {");
  });

  it("conserve une charge utile illisible plutôt que de la perdre", () => {
    expect(script).toContain("payload = { raw: raw.slice(0, 2000) }");
  });
});

describe("hookCommand", () => {
  it("cite l'exécutable et les chemins, et vise Node par son chemin absolu", () => {
    const command = hookCommand("stop", dataDir);
    // Le PATH du processus qui exécute le hook n'est pas le nôtre : `node` seul
    // ne se résout pas forcément.
    expect(command.startsWith(`"${process.execPath}"`)).toBe(true);
    expect(command).toContain(`"${hookScriptPath(dataDir)}"`);
    expect(command).toContain(` stop `);
    expect(command).toContain(`"${eventsDir(dataDir)}"`);
  });
});

describe("installation des hooks", () => {
  it("déclare tous les types et dépose le script", async () => {
    const status = await installHooks(dataDir, settings);

    expect(status.installed).toBe(true);
    expect(status.outdated).toBe(false);
    expect(status.kinds.sort()).toEqual(["idle", "permission", "resume", "session", "stop"]);
    expect(existsSync(hookScriptPath(dataDir))).toBe(true);
    expect(existsSync(eventsDir(dataDir))).toBe(true);
  });

  it("signale un script déposé par une version antérieure", async () => {
    await installHooks(dataDir, settings);
    await writeFile(hookScriptPath(dataDir), "// ancien script\n", "utf8");
    expect((await hooksStatus(dataDir, settings)).outdated).toBe(true);

    await installHooks(dataDir, settings);
    expect((await hooksStatus(dataDir, settings)).outdated).toBe(false);
  });

  it.each(["Stop", "UserPromptSubmit", "SessionStart"])("ne pose pas de matcher sur %s", async (event) => {
    await installHooks(dataDir, settings);
    const value = JSON.parse(await readFile(settings, "utf8"));

    const ours = (value.hooks[event] as HookEntry[]).filter((entry) =>
      entry.hooks.some((hook) => hook.command.includes(hookScriptPath(dataDir))),
    );
    expect(ours).toHaveLength(1);
    expect(ours[0]).not.toHaveProperty("matcher");

    const notification = value.hooks.Notification as HookEntry[];
    expect(notification.every((entry) => typeof entry.matcher === "string")).toBe(true);
  });

  it("conserve les hooks déjà en place et le reste du fichier", async () => {
    await writeFile(settings, EXISTING, "utf8");
    await installHooks(dataDir, settings);

    const raw = await readFile(settings, "utf8");
    const value = JSON.parse(raw);

    // Le hook maison sur Stop survit, à côté du nôtre.
    expect(value.hooks.Stop).toHaveLength(2);
    expect(raw).toContain("outil-maison hook");
    expect(value.hooks.PreToolUse).toHaveLength(1);

    // Les clés sans rapport ne bougent pas.
    expect(value.env.BRANCH_PREFIX).toBe("aqn");
    expect(value.model).toBe("opus");
  });

  it("remplace nos entrées au lieu de les empiler", async () => {
    await installHooks(dataDir, settings);
    await installHooks(dataDir, settings);

    const value = JSON.parse(await readFile(settings, "utf8"));
    expect(value.hooks.Notification).toHaveLength(2);
    expect(value.hooks.Stop).toHaveLength(1);
  });

  it("signale une installation partielle", async () => {
    await installHooks(dataDir, settings);
    const value = JSON.parse(await readFile(settings, "utf8"));
    delete value.hooks.Stop;
    await writeFile(settings, JSON.stringify(value, null, 2), "utf8");

    const status = await hooksStatus(dataDir, settings);
    expect(status.installed).toBe(false);
    expect(status.kinds).not.toContain("stop");
  });

  it("se désinstalle sans emporter les hooks des autres", async () => {
    await writeFile(settings, EXISTING, "utf8");
    await installHooks(dataDir, settings);
    const status = await uninstallHooks(dataDir, settings);

    expect(status.installed).toBe(false);
    expect(status.kinds).toEqual([]);

    const value = JSON.parse(await readFile(settings, "utf8"));
    expect(value.hooks.Stop).toHaveLength(1);
    expect(value.hooks.Stop[0].hooks[0].command).toBe("outil-maison hook");
    // La clé vidée disparaît plutôt que de rester en tableau vide.
    expect(value.hooks.Notification).toBeUndefined();
    expect(value.hooks.UserPromptSubmit).toBeUndefined();
  });

  it("rapporte l'absence d'installation sur une configuration vierge", async () => {
    const status = await hooksStatus(dataDir, settings);
    expect(status.installed).toBe(false);
    expect(status.kinds).toEqual([]);
  });
});

describe("parseNotification", () => {
  it("lit les champs communs documentés", () => {
    const notification = parseNotification(
      "42",
      JSON.stringify({
        kind: "permission",
        receivedAt: "2026-09-22T10:00:00.000Z",
        payload: {
          session_id: "abc",
          transcript_path: "C:/x/abc.jsonl",
          cwd: "C:/Projets/mon-app",
          permission_mode: "plan",
          agent_type: "code-review",
        },
      }),
    );

    expect(notification).toEqual({
      id: "42",
      kind: "permission",
      receivedAt: "2026-09-22T10:00:00.000Z",
      sessionId: "abc",
      transcriptPath: "C:/x/abc.jsonl",
      cwd: "C:/Projets/mon-app",
      permissionMode: "plan",
      agentType: "code-review",
    });
  });

  it("lit l'onglet d'origine et la source d'un rattachement", () => {
    const notification = parseNotification(
      "43",
      JSON.stringify({
        v: 2,
        kind: "session",
        receivedAt: "2026-09-28T10:00:00.000Z",
        terminalId: "t1",
        payload: { session_id: "abc", transcript_path: "C:/x/abc.jsonl", cwd: "C:/app", source: "clear" },
      }),
    );
    expect(notification).toMatchObject({ kind: "session", terminalId: "t1", source: "clear", sessionId: "abc" });
  });

  it("lit encore une enveloppe sans version, qui ne nomme aucun onglet", () => {
    const notification = parseNotification("44", JSON.stringify({ kind: "stop", payload: { session_id: "abc" } }));
    expect(notification).toMatchObject({ kind: "stop", sessionId: "abc" });
    expect(notification).not.toHaveProperty("terminalId");
  });

  it("prend le dernier message de Claude comme texte d'un arrêt", () => {
    const notification = parseNotification(
      "1",
      JSON.stringify({ kind: "stop", payload: { last_assistant_message: "  C'est\n  fait.  " } }),
    );
    expect(notification?.message).toBe("C'est fait.");
  });

  it("tronque un message trop long", () => {
    const notification = parseNotification(
      "1",
      JSON.stringify({ kind: "stop", payload: { last_assistant_message: "x".repeat(500) } }),
    );
    expect(notification?.message?.length).toBeLessThanOrEqual(200);
    expect(notification?.message?.endsWith("…")).toBe(true);
  });

  it("retombe sur `other` pour un type inconnu", () => {
    expect(parseNotification("1", JSON.stringify({ kind: "inventé", payload: {} }))?.kind).toBe("other");
  });

  it("ignore ce qui n'est pas un objet JSON", () => {
    expect(parseNotification("1", "pas du json")).toBeUndefined();
    expect(parseNotification("1", "[1,2]")).toBeUndefined();
  });

  it("survit à une charge utile absente", () => {
    const notification = parseNotification("1", JSON.stringify({ kind: "idle" }));
    expect(notification?.kind).toBe("idle");
    expect(notification?.cwd).toBeUndefined();
  });
});

/**
 * Attend une condition plutôt qu'un appel précis.
 *
 * Le dossier est drainé par deux chemins — `fs.watch` et le balayage — et rien
 * ne garantit lequel gagne. Ce qui doit tenir, c'est qu'un fichier déposé
 * finisse par produire une notification, pas qui l'a ramassé.
 */
async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((done) => setTimeout(done, 25));
  }
  throw new Error("condition non atteinte dans le délai");
}

describe("NotificationWatcher", () => {
  it("consomme les fichiers déposés et les retire de la file", async () => {
    const watcher = new NotificationWatcher(dataDir);
    await watcher.start();

    const received: ClaudeNotification[] = [];
    watcher.on((notification) => received.push(notification));

    await writeFile(
      join(watcher.directory, "1.json"),
      JSON.stringify({ kind: "stop", payload: { cwd: "C:/x" } }),
      "utf8",
    );
    await watcher.drain();
    await waitFor(() => received.length === 1);

    expect(received[0]?.cwd).toBe("C:/x");
    expect(existsSync(join(watcher.directory, "1.json"))).toBe(false);

    // Le dossier est une file d'attente ; l'historique vit en mémoire.
    expect(watcher.recent()).toHaveLength(1);
    expect(await watcher.drain()).toHaveLength(0);

    watcher.stop();
  });

  it("jette un fichier illisible sans interrompre les suivants", async () => {
    const watcher = new NotificationWatcher(dataDir);
    await watcher.start();

    const received: ClaudeNotification[] = [];
    watcher.on((notification) => received.push(notification));

    // Vieilli : un fichier illisible et récent pourrait être encore en écriture.
    const broken = join(watcher.directory, "1.json");
    await writeFile(broken, "{ cassé", "utf8");
    await utimes(broken, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
    await writeFile(join(watcher.directory, "2.json"), JSON.stringify({ kind: "idle" }), "utf8");
    await watcher.drain();
    await waitFor(() => received.length === 1);

    expect(received[0]?.kind).toBe("idle");
    expect(await readdir(watcher.directory)).toEqual([]);

    watcher.stop();
  });

  it("laisse en place un fichier en cours d'écriture, et le lit une fois complet", async () => {
    const watcher = new NotificationWatcher(dataDir);
    await watcher.start();

    const received: ClaudeNotification[] = [];
    watcher.on((notification) => received.push(notification));

    const path = join(watcher.directory, "1.json");
    await writeFile(path, '{"kind":"st', "utf8");
    await watcher.drain();
    expect(existsSync(path)).toBe(true);
    expect(received).toHaveLength(0);

    await writeFile(path, JSON.stringify({ kind: "stop" }), "utf8");
    await watcher.drain();
    await waitFor(() => received.length === 1);
    expect(received[0]?.kind).toBe("stop");

    watcher.stop();
  });

  it("transmet une reprise sans la garder dans l'historique", async () => {
    const watcher = new NotificationWatcher(dataDir);
    await watcher.start();

    const received: ClaudeNotification[] = [];
    watcher.on((notification) => received.push(notification));

    await writeFile(
      join(watcher.directory, "1.json"),
      JSON.stringify({ kind: "resume", payload: { cwd: "C:/x", prompt: "suite" } }),
      "utf8",
    );
    await watcher.drain();
    await waitFor(() => received.length === 1);

    expect(received[0]?.kind).toBe("resume");
    expect(watcher.recent()).toEqual([]);

    watcher.stop();
  });

  it("borne l'historique qu'il garde", async () => {
    const watcher = new NotificationWatcher(dataDir, 3000, 3);
    await watcher.start();

    for (let index = 0; index < 5; index += 1) {
      await writeFile(
        join(watcher.directory, `${index}.json`),
        JSON.stringify({ kind: "stop", payload: { session_id: String(index) } }),
        "utf8",
      );
    }
    await watcher.drain();
    await waitFor(() => watcher.recent().length === 3);

    // Les plus récentes d'abord, les plus anciennes tombées.
    expect(watcher.recent().map((item) => item.sessionId)).toEqual(["4", "3", "2"]);
    watcher.stop();
  });

  it("met les demandes à la file au lieu d'en abandonner", async () => {
    // Une rafale est le cas normal : une permission puis un arrêt. Deux drains
    // lancés ensemble doivent traiter les deux fichiers, pas un seul.
    const watcher = new NotificationWatcher(dataDir);
    await watcher.start();

    const received: ClaudeNotification[] = [];
    watcher.on((notification) => received.push(notification));

    await writeFile(join(watcher.directory, "a.json"), JSON.stringify({ kind: "permission" }), "utf8");
    await writeFile(join(watcher.directory, "b.json"), JSON.stringify({ kind: "stop" }), "utf8");
    await Promise.all([watcher.drain(), watcher.drain(), watcher.drain()]);

    expect(received).toHaveLength(2);
    expect(await readdir(watcher.directory)).toEqual([]);
    watcher.stop();
  });
});

/** Le script déposé doit fonctionner tel quel, lancé comme Claude Code le lancera. */
describe("script de hook, exécuté pour de vrai", () => {
  it("déverse ce qu'il reçoit sur l'entrée standard", async () => {
    await installHooks(dataDir, settings);
    const payload = JSON.stringify({
      session_id: "s1",
      cwd: "C:\\Projets\\mon-app",
      hook_event_name: "Stop",
      last_assistant_message: "terminé",
    });

    const child = execFile(process.execPath, [hookScriptPath(dataDir), "stop", eventsDir(dataDir)], {
      env: { ...process.env, CLIDE_TERMINAL_ID: "onglet-7" },
    });
    child.stdin?.end(payload);
    await new Promise((done) => child.on("close", done));

    const watcher = new NotificationWatcher(dataDir);
    const drained = await watcher.drain();

    expect(drained).toHaveLength(1);
    expect(drained[0]).toMatchObject({
      kind: "stop",
      sessionId: "s1",
      cwd: "C:\\Projets\\mon-app",
      message: "terminé",
      terminalId: "onglet-7",
    });
  }, 30_000);

  it("sort sans rien écrire de fatal quand l'entrée est vide", async () => {
    await installHooks(dataDir, settings);
    const { stdout, stderr } = await run(
      process.execPath,
      [hookScriptPath(dataDir), "idle", eventsDir(dataDir)],
      { timeout: 10_000 },
    );
    expect(stderr).toBe("");
    expect(stdout).toBe("");
  }, 30_000);
});

describe("définitions", () => {
  it("couvre les trois états qu'un onglet doit signaler, et la reprise qui les éteint", () => {
    expect(HOOK_DEFINITIONS.map((definition) => definition.kind)).toEqual([
      "permission",
      "idle",
      "stop",
      "resume",
      "session",
    ]);
  });
});

describe("anciennes installations", () => {
  /** Ce que le tout premier nom de l'application laissait dans settings.json. */
  const claudeTerm = (root: string) => {
    const script = join(root, "ClaudeTerm", "hook.cmd");
    const entry = { hooks: [{ type: "command", command: `"${script}"` }] };
    return { script, settings: { hooks: { Notification: [entry], Stop: [entry, { hooks: [{ type: "command", command: "mon-outil" }] }] } } };
  };

  it("reconnaît leurs entrées et les événements qui les portent", async () => {
    const legacy = claudeTerm(dir);
    await writeFile(settings, JSON.stringify(legacy.settings));
    const status = await hooksStatus(dataDir, settings, [legacy.script]);
    expect(status.legacy).toEqual([{ script: legacy.script, events: ["Notification", "Stop"] }]);
    expect(status.kinds).toEqual([]);
  });

  it("repointe : retire les anciennes entrées, pose les nôtres, garde le hook maison", async () => {
    const legacy = claudeTerm(dir);
    await writeFile(settings, JSON.stringify(legacy.settings));

    expect(await migrateHooks([legacy.script], dataDir, settings)).toEqual([legacy.script]);
    const status = await hooksStatus(dataDir, settings, [legacy.script]);
    expect(status.installed).toBe(true);
    expect(status.legacy).toEqual([]);
    const raw = await readFile(settings, "utf8");
    expect(raw).toContain("mon-outil");
    expect(raw).not.toContain("ClaudeTerm");
  });

  it("repointe aussi le script d'un ancien dossier de données", async () => {
    const legacyDir = join(dir, "ancien");
    await writeFile(settings, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "mon-outil" }] }] } }));
    await installHooks(legacyDir, settings);

    const scripts = [hookScriptPath(legacyDir)];
    expect(await migrateHooks(scripts, dataDir, settings)).toEqual(scripts);
    expect((await hooksStatus(dataDir, settings, scripts)).installed).toBe(true);
    expect((await hooksStatus(legacyDir, settings)).kinds).toEqual([]);
    expect(await readFile(settings, "utf8")).toContain("mon-outil");
  });

  it("ne pose rien là où rien n'était installé", async () => {
    await writeFile(settings, "{}");
    expect(await migrateHooks([join(dir, "ancien", "hook.mjs")], dataDir, settings)).toEqual([]);
    expect((await hooksStatus(dataDir, settings)).kinds).toEqual([]);
  });

  it("se retire sans rien poser, sur demande", async () => {
    const legacy = claudeTerm(dir);
    await writeFile(settings, JSON.stringify(legacy.settings));

    const status = await pruneLegacyHooks(dataDir, settings, [legacy.script]);
    expect(status.legacy).toEqual([]);
    expect(status.kinds).toEqual([]);
    const value = JSON.parse(await readFile(settings, "utf8"));
    expect(value.hooks.Notification).toBeUndefined();
    expect(value.hooks.Stop).toHaveLength(1);
    expect(value.hooks.Stop[0].hooks[0].command).toBe("mon-outil");
  });
});
