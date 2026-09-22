import { mkdtemp, rm, writeFile, appendFile, truncate } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { JsonlTailer, parseLine } from "../src/transcript/jsonl.js";

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "claude-ide-jsonl-"));
  file = join(dir, "session.jsonl");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const line = (value: unknown): string => `${JSON.stringify(value)}\n`;

describe("parseLine", () => {
  it("accepte un objet porteur d'un type", () => {
    expect(parseLine('{"type":"user"}')).toEqual({ kind: "event", event: { type: "user" } });
  });

  it("tolère une fin de ligne Windows", () => {
    expect(parseLine('{"type":"user"}\r').kind).toBe("event");
  });

  it("ne compte pas une ligne vide comme une anomalie", () => {
    expect(parseLine("   ").kind).toBe("blank");
  });

  it("rejette ce qui n'est pas un objet typé", () => {
    expect(parseLine("{ pas du json").kind).toBe("malformed");
    expect(parseLine("[1,2,3]").kind).toBe("malformed");
    expect(parseLine('{"sessionId":"x"}').kind).toBe("malformed");
  });
});

describe("JsonlTailer", () => {
  it("ne relit pas ce qu'il a déjà lu", async () => {
    await writeFile(file, line({ type: "user" }) + line({ type: "assistant" }));
    const tailer = new JsonlTailer(file);

    const first = await tailer.read();
    expect(first.events).toHaveLength(2);

    const second = await tailer.read();
    expect(second.events).toHaveLength(0);
    expect(second.bytesRead).toBe(0);

    await appendFile(file, line({ type: "ai-title", aiTitle: "suite" }));
    const third = await tailer.read();
    expect(third.events.map((e) => e.type)).toEqual(["ai-title"]);
  });

  it("garde une ligne incomplète jusqu'à l'arrivée de sa fin", async () => {
    await writeFile(file, '{"type":"user","cwd":"C:');
    const tailer = new JsonlTailer(file);

    const partial = await tailer.read();
    expect(partial.events).toHaveLength(0);
    expect(partial.malformed).toBe(0);
    expect(tailer.hasPending).toBe(true);

    await appendFile(file, '\\\\Projets"}\n');
    const completed = await tailer.read();
    expect(completed.events).toHaveLength(1);
    expect(completed.events[0]?.cwd).toBe("C:\\Projets");
  });

  it("compte une ligne illisible sans interrompre les suivantes", async () => {
    await writeFile(file, line({ type: "user" }) + "{ cassé\n" + line({ type: "assistant" }));
    const result = await new JsonlTailer(file).read();

    expect(result.malformed).toBe(1);
    expect(result.events.map((e) => e.type)).toEqual(["user", "assistant"]);
  });

  it("reprend à zéro quand le fichier a rétréci", async () => {
    await writeFile(file, line({ type: "user" }) + line({ type: "assistant" }));
    const tailer = new JsonlTailer(file);
    await tailer.read();

    await truncate(file, 0);
    await writeFile(file, line({ type: "system" }));

    const result = await tailer.read();
    expect(result.reset).toBe(true);
    expect(result.events.map((e) => e.type)).toEqual(["system"]);
  });

  it("recolle un caractère multi-octets coupé entre deux chunks", async () => {
    // « é » occupe deux octets : une taille de chunk impaire le scinde forcément.
    const payload = line({ type: "last-prompt", lastPrompt: "éléphant à réécrire" });
    await writeFile(file, payload);

    const result = await new JsonlTailer(file, 3).read();
    expect(result.events[0]?.["lastPrompt"]).toBe("éléphant à réécrire");
  });

  it("rend un résultat vide sur un fichier absent", async () => {
    const result = await new JsonlTailer(join(dir, "nulle-part.jsonl")).read();
    expect(result).toEqual({ events: [], malformed: 0, bytesRead: 0, reset: false });
  });
});
