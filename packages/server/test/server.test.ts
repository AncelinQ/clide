import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { parseClientMessage } from "../src/protocol.js";
import { shellProfileScript } from "../src/pty/shell-profile.js";
import { startServer, type RunningServer } from "../src/server.js";

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "web", "dist");

describe("shellProfileScript", () => {
  const script = shellProfileScript();

  it("ne contient aucune barre oblique inverse", () => {
    // Tout échappement se perd en traversant le générateur puis PowerShell :
    // les caractères de contrôle sont construits par [char].
    expect(script).not.toContain("\\");
  });

  it("capture le prompt existant avant de le remplacer", () => {
    expect(script).toContain("$global:__clideInner = $function:prompt");
    expect(script).toContain("& $global:__clideInner");
  });

  it("lit $? avant toute autre commande", () => {
    const body = script.slice(script.indexOf("function global:prompt"));
    const lines = body.split("\n").filter((line) => line.trim() && !line.trim().startsWith("#"));
    expect(lines[1]?.trim()).toBe("$ok = $?");
  });

  it("tolère l'absence de PSReadLine", () => {
    expect(script).toContain("Set-PSReadLineKeyHandler");
    expect(script.slice(script.indexOf("Set-PSReadLineKeyHandler"))).toContain("catch");
  });
});

describe("parseClientMessage", () => {
  it("accepte une ouverture valide", () => {
    expect(parseClientMessage('{"t":"open","projectRoot":"C:/x","kind":"claude"}')).toEqual({
      t: "open",
      projectRoot: "C:/x",
      kind: "claude",
    });
  });

  it("garde le projet auquel l'onglet appartient", () => {
    expect(parseClientMessage('{"t":"open","projectRoot":"C:/x-wt","owner":"C:/x"}')).toEqual({
      t: "open",
      projectRoot: "C:/x-wt",
      owner: "C:/x",
    });
  });

  it("garde le nom de l'onglet et le script qu'il fait tourner, bornés en longueur", () => {
    const message = parseClientMessage(
      JSON.stringify({ t: "open", projectRoot: "C:/x", label: `api › ${"d".repeat(200)}`, script: "C:/x|dev" }),
    );
    expect(message).toMatchObject({ t: "open", script: "C:/x|dev" });
    expect(message?.t === "open" && message.label?.length).toBe(80);
  });

  it("rejette une ouverture sans dossier", () => {
    expect(parseClientMessage('{"t":"open"}')).toBeUndefined();
  });

  it("rejette un type de terminal inventé", () => {
    const message = parseClientMessage('{"t":"open","projectRoot":"C:/x","kind":"root"}');
    expect(message).toEqual({ t: "open", projectRoot: "C:/x" });
  });

  it("rejette un message inconnu, du JSON invalide et un tableau", () => {
    expect(parseClientMessage('{"t":"exec","cmd":"rm"}')).toBeUndefined();
    expect(parseClientMessage("pas du json")).toBeUndefined();
    expect(parseClientMessage("[1,2]")).toBeUndefined();
  });

  it("exige des dimensions numériques pour un redimensionnement", () => {
    expect(parseClientMessage('{"t":"resize","id":"a","cols":"80","rows":24}')).toBeUndefined();
    expect(parseClientMessage('{"t":"resize","id":"a","cols":80,"rows":24}')).toEqual({
      t: "resize",
      id: "a",
      cols: 80,
      rows: 24,
    });
  });
});

describe("serveur local", () => {
  let server: RunningServer;
  let scratch: string;

  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), "clide-srv-"));
    // Les routes qui écrivent visent des fichiers du bac à sable : aucun test
    // ne doit toucher à la configuration de la machine.
    server = await startServer({
      webRoot: WEB_ROOT,
      token: "jeton-de-test",
      settingsPath: join(scratch, "settings.json"),
      dataDir: join(scratch, "data"),
    });
    // Le bac à sable est le projet ouvert : c'est ce que le client annonce à son démarrage.
    await fetch(`http://127.0.0.1:${server.port}/api/workspace/roots?token=jeton-de-test`, {
      method: "POST",
      body: JSON.stringify({ projects: [scratch] }),
    });
  });

  afterAll(async () => {
    await server.close();
    await rm(scratch, { recursive: true, force: true });
  });

  const base = (): string => `http://127.0.0.1:${server.port}`;

  it("n'écoute que sur la boucle locale", () => {
    expect(server.url).toContain("127.0.0.1");
  });

  it("enregistre une image brute et rend un chemin à taper dans le prompt", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const response = await fetch(`${base()}/api/attachments?token=jeton-de-test`, {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: png,
    });
    expect(response.status).toBe(200);
    const { path } = (await response.json()) as { path: string };
    expect(path.startsWith(join(scratch, "data", "drops"))).toBe(true);
    expect(path.endsWith(".png")).toBe(true);
    expect(await readFile(path)).toEqual(png);
  });

  it("refuse d'enregistrer ce qui n'est pas une image", async () => {
    const response = await fetch(`${base()}/api/attachments?token=jeton-de-test`, {
      method: "POST",
      headers: { "content-type": "text/html" },
      body: "<script></script>",
    });
    expect(response.status).toBe(400);
  });

  it("refuse une requête d'API sans jeton", async () => {
    const response = await fetch(`${base()}/api/skills?root=${encodeURIComponent(scratch)}`);
    expect(response.status).toBe(401);
  });

  it("accepte le jeton en paramètre comme en en-tête", async () => {
    const withQuery = await fetch(
      `${base()}/api/skills?root=${encodeURIComponent(scratch)}&token=${server.token}`,
    );
    expect(withQuery.status).toBe(200);

    const withHeader = await fetch(`${base()}/api/skills?root=${encodeURIComponent(scratch)}`, {
      headers: { authorization: `Bearer ${server.token}` },
    });
    expect(withHeader.status).toBe(200);
  });

  it("refuse une requête venant d'une autre origine", async () => {
    const response = await fetch(
      `${base()}/api/skills?root=${encodeURIComponent(scratch)}&token=${server.token}`,
      { headers: { origin: "https://site-malveillant.invalid" } },
    );
    expect(response.status).toBe(401);
  });

  it("refuse une racine hors des projets ouverts, et l'accepte une fois ouverte", async () => {
    const other = await mkdtemp(join(tmpdir(), "clide-autre-"));
    try {
      const url = `${base()}/api/files?root=${encodeURIComponent(other)}&token=${server.token}`;
      expect((await fetch(url)).status).toBe(403);
      const denied = await fetch(`${base()}/api/links/save?token=${server.token}`, {
        method: "POST",
        body: JSON.stringify({ root: other, links: [] }),
      });
      expect(denied.status).toBe(403);

      const opened = await fetch(`${base()}/api/workspace/roots?token=${server.token}`, {
        method: "POST",
        body: JSON.stringify({ projects: [scratch, other] }),
      });
      expect(opened.status).toBe(200);
      expect((await fetch(url)).status).toBe(200);
    } finally {
      await fetch(`${base()}/api/workspace/roots?token=${server.token}`, {
        method: "POST",
        body: JSON.stringify({ projects: [scratch] }),
      });
      await rm(other, { recursive: true, force: true });
    }
  });

  it("crée, renomme et copie dans les projets ouverts, et refuse ailleurs", async () => {
    const post = (path: string, body: unknown) =>
      fetch(`${base()}${path}?token=${server.token}`, { method: "POST", body: JSON.stringify(body) });
    const folder = join(scratch, "ops");
    await mkdir(folder, { recursive: true });

    expect((await post("/api/fs/create", { parent: folder, name: "a.md", kind: "file" })).status).toBe(200);
    const renamed = (await (await post("/api/fs/rename", { path: join(folder, "a.md"), name: "b.md" })).json()) as { path: string };
    expect(renamed.path).toBe(join(folder, "b.md"));

    const asked = (await (await post("/api/fs/copy", { sources: [join(folder, "b.md")], targetDir: folder })).json()) as {
      outcomes: { status: string; conflict?: boolean }[];
    };
    expect(asked.outcomes).toEqual([expect.objectContaining({ status: "skipped", conflict: true })]);
    const kept = (await (
      await post("/api/fs/copy", { sources: [join(folder, "b.md")], targetDir: folder, onConflict: "keepBoth" })
    ).json()) as { outcomes: { target: string }[] };
    expect(kept.outcomes[0]?.target).toBe(join(folder, "b (2).md"));

    const outside = await mkdtemp(join(tmpdir(), "clide-dehors-"));
    try {
      expect((await post("/api/fs/create", { parent: outside, name: "x", kind: "file" })).status).toBe(403);
      expect((await post("/api/fs/copy", { sources: [join(folder, "b.md")], targetDir: outside })).status).toBe(403);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
    expect((await post("/api/fs/trash", { paths: [scratch] })).status).toBe(400);
  });

  it("lit et enregistre un fichier pour l'éditeur, et refuse (409) s'il a changé entre-temps", async () => {
    const path = join(scratch, "edite.md");
    await writeFile(path, "v1\r\n");
    const read = (await (await fetch(`${base()}/api/fs/read?path=${encodeURIComponent(path)}&token=${server.token}`)).json()) as {
      text: string;
      eol: string;
      mtimeMs: number;
    };
    expect(read).toMatchObject({ text: "v1\n", eol: "\r\n" });
    const write = (expectedMtimeMs: number) =>
      fetch(`${base()}/api/fs/write?token=${server.token}`, {
        method: "POST",
        body: JSON.stringify({ path, text: "v2\n", expectedMtimeMs, eol: read.eol, bom: false }),
      });
    const saved = await write(read.mtimeMs);
    expect(saved.status).toBe(200);
    expect(await readFile(path, "utf8")).toBe("v2\r\n");
    expect((await write(read.mtimeMs - 60_000)).status).toBe(409);
  });

  it("signale un paramètre manquant plutôt que de deviner", async () => {
    const response = await fetch(`${base()}/api/files?token=${server.token}`);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toContain("root");
  });

  it("sert la page du client", async () => {
    const response = await fetch(`${base()}/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Clide");
  });

  it("ne sort pas de la racine servie", async () => {
    // Les `..` sont encodés : `fetch` normalise un chemin littéral avant de
    // l'envoyer, et la requête n'atteindrait jamais le serveur sous cette forme.
    for (const attempt of ["%2e%2e%2f%2e%2e%2fpackage.json", "..%2f..%2fpackage.json"]) {
      const response = await fetch(`${base()}/${attempt}`);
      expect(response.status, attempt).toBe(404);
    }
  });

  it("refuse une connexion WebSocket sans jeton", async () => {
    await expect(TestClient.open(`ws://127.0.0.1:${server.port}/pty`)).rejects.toThrow();
  });

  it("refuse une connexion WebSocket venant d'un site tiers", async () => {
    // Une WebSocket n'est pas soumise à la politique d'origine : sans ce refus,
    // une page visitée pourrait ouvrir un shell sur la machine.
    await expect(
      TestClient.open(`ws://127.0.0.1:${server.port}/pty?token=${server.token}`, {
        origin: "https://site-malveillant.invalid",
      }),
    ).rejects.toThrow();
  });

  it("accueille un client légitime avec l'état courant", async () => {
    const client = await TestClient.open(`ws://127.0.0.1:${server.port}/pty?token=${server.token}`);
    const hello = await client.next();
    expect(hello["t"]).toBe("hello");
    expect(Array.isArray(hello["terminals"])).toBe(true);
    expect(typeof hello["backlogs"]).toBe("object");
    client.close();
  });

  it("refuse une mutation en GET", async () => {
    // Une route qui écrit ne doit pas partir sur une simple navigation.
    const response = await fetch(`${base()}/api/settings/set?token=${server.token}`);
    expect(response.status).toBe(405);
  });

  it("écrit un réglage et le relit", async () => {
    const write = await fetch(`${base()}/api/settings/set?token=${server.token}`, {
      method: "POST",
      body: JSON.stringify({ path: ["env", "DEMO"], value: "1" }),
    });
    expect(write.status).toBe(200);

    const read = await fetch(`${base()}/api/settings?token=${server.token}`);
    const document = (await read.json()) as { value: { env?: Record<string, string> } };
    expect(document.value.env?.["DEMO"]).toBe("1");
  });

  it("refuse un corps illisible plutôt que d'écrire à moitié", async () => {
    const response = await fetch(`${base()}/api/settings/set?token=${server.token}`, {
      method: "POST",
      body: "{ pas du json",
    });
    expect(response.status).toBe(400);
  });

  it("refuse une mutation à laquelle il manque un champ", async () => {
    const response = await fetch(`${base()}/api/settings/set?token=${server.token}`, {
      method: "POST",
      body: JSON.stringify({ value: "1" }),
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain("path");
  });

  it("refuse un remplacement dont le JSON ne tient pas", async () => {
    const response = await fetch(`${base()}/api/settings/replace?token=${server.token}`, {
      method: "POST",
      body: JSON.stringify({ raw: "{ cassé" }),
    });
    expect(response.status).toBe(400);
  });

  it("refuse un corps démesuré", async () => {
    // Ces routes écrivent des fichiers de configuration : rien de légitime n'y
    // atteint le mégaoctet.
    const response = await fetch(`${base()}/api/settings/replace?token=${server.token}`, {
      method: "POST",
      body: JSON.stringify({ raw: "x".repeat(2 * 1024 * 1024) }),
    }).catch(() => undefined);
    expect(response === undefined || response.status === 400).toBe(true);
  });

  it("rejette un message mal formé sans ouvrir de processus", async () => {
    const client = await TestClient.open(`ws://127.0.0.1:${server.port}/pty?token=${server.token}`);
    await client.next();
    client.send('{"t":"exec","cmd":"calc.exe"}');
    expect(await client.next()).toEqual({ t: "error", message: "message rejeté" });
    client.close();
  });
});

/**
 * Ouvre une connexion et met les messages en file dès l'ouverture.
 *
 * Le serveur envoie `hello` immédiatement après la négociation : un test qui
 * n'attacherait son écouteur qu'après l'`await` perdrait ce premier message.
 */
class TestClient {
  readonly #queue: Record<string, unknown>[] = [];
  #waiting: ((message: Record<string, unknown>) => void) | undefined;

  private constructor(readonly socket: WebSocket) {
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (this.#waiting) {
        const resolve = this.#waiting;
        this.#waiting = undefined;
        resolve(message);
      } else {
        this.#queue.push(message);
      }
    });
  }

  static open(url: string, options: { origin?: string } = {}): Promise<TestClient> {
    return new Promise((done, fail) => {
      const socket = new WebSocket(url, options.origin ? { origin: options.origin } : {});
      const client = new TestClient(socket);
      socket.once("open", () => done(client));
      socket.once("error", fail);
      socket.once("close", () => fail(new Error("connexion refusée")));
    });
  }

  next(timeoutMs = 5000): Promise<Record<string, unknown>> {
    const queued = this.#queue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((done, fail) => {
      const timer = setTimeout(() => fail(new Error("aucun message")), timeoutMs);
      this.#waiting = (message) => {
        clearTimeout(timer);
        done(message);
      };
    });
  }

  send(raw: string): void {
    this.socket.send(raw);
  }

  close(): void {
    this.socket.close();
  }
}

describe("guide sous /docs/", () => {
  let scratch: string;
  let withDocs: RunningServer;
  let withoutDocs: RunningServer;

  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), "clide-docs-"));
    const docs = join(scratch, "docs");
    await mkdir(docs, { recursive: true });
    await writeFile(join(docs, "index.html"), "<h1>accueil du guide</h1>");
    await writeFile(join(docs, "git.html"), "<h1>git</h1>");
    await writeFile(join(docs, "404.html"), "<h1>page absente du guide</h1>");
    await writeFile(join(scratch, "secret.txt"), "hors du guide");
    const common = { webRoot: WEB_ROOT, token: "jeton-de-test", dataDir: join(scratch, "data") };
    withDocs = await startServer({ ...common, docsRoot: docs });
    withoutDocs = await startServer(common);
  });

  afterAll(async () => {
    await withDocs.close();
    await withoutDocs.close();
    await rm(scratch, { recursive: true, force: true });
  });

  it("sert ses pages sans jeton, et renvoie /docs vers /docs/", async () => {
    const base = `http://127.0.0.1:${withDocs.port}`;
    const redirect = await fetch(`${base}/docs`, { redirect: "manual" });
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBe("/docs/");
    expect(await (await fetch(`${base}/docs/`)).text()).toContain("accueil du guide");
    expect(await (await fetch(`${base}/docs/git.html`)).text()).toContain("git");
  });

  it("rend la 404 du guide pour une page absente, et ne sort pas de sa racine", async () => {
    const base = `http://127.0.0.1:${withDocs.port}`;
    const missing = await fetch(`${base}/docs/inconnue.html`);
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain("page absente du guide");
    const escape = await fetch(`${base}/docs/..%2Fsecret.txt`);
    expect(await escape.text()).not.toContain("hors du guide");
  });

  it("dit comment le construire quand il ne l'est pas", async () => {
    const response = await fetch(`http://127.0.0.1:${withoutDocs.port}/docs/`);
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("pnpm docs:build");
  });
});
