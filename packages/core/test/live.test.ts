import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { encodeProjectPath } from "../src/paths.js";
import { findLiveTranscript, resumedSessionId } from "../src/transcript/live.js";

const CWD = String.raw`C:\Projets\app`;
let home: string;
let directory: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "clide-live-"));
  directory = join(home, "projects", encodeProjectPath(CWD));
  await mkdir(directory, { recursive: true });
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true, maxRetries: 3 });
});

async function transcript(id: string, modifiedAt?: number): Promise<string> {
  const path = join(directory, `${id}.jsonl`);
  await writeFile(path, "{}\n", "utf8");
  if (modifiedAt !== undefined) await utimes(path, modifiedAt / 1000, modifiedAt / 1000);
  return path;
}

describe("findLiveTranscript", () => {
  it("prend la session créée après l'ouverture de l'onglet", async () => {
    const since = Date.now();
    const path = await transcript("neuve");
    expect(await findLiveTranscript(CWD, since, new Set(), home)).toEqual({ path, sessionId: "neuve" });
  });

  it("ignore une session antérieure que personne ne reprend", async () => {
    await transcript("ancienne", Date.now() - 60_000);
    // Créée maintenant sur le disque, mais l'onglet a été ouvert « plus tard ».
    expect(await findLiveTranscript(CWD, Date.now() + 60_000, new Set(), home)).toBeUndefined();
  });

  it("écarte un transcript déjà suivi par un autre onglet", async () => {
    const since = Date.now();
    const claimed = await transcript("prise");
    expect(await findLiveTranscript(CWD, since, new Set([claimed]), home)).toBeUndefined();
  });

  it("ne trouve rien pour un dossier sans session", async () => {
    expect(await findLiveTranscript(String.raw`C:\Ailleurs`, Date.now(), new Set(), home)).toBeUndefined();
  });

  it("ne suit pas une session active ailleurs dans le même dossier", async () => {
    // Créée avant l'onglet, mais modifiée depuis : c'est une autre fenêtre qui
    // travaille, pas la session de l'onglet.
    const other = await transcript("ailleurs");
    const since = Date.now() + 10_000;
    await utimes(other, (since + 5_000) / 1000, (since + 5_000) / 1000);
    expect(await findLiveTranscript(CWD, since, new Set(), home)).toBeUndefined();
  });

  it("suit la session nommée par une reprise", async () => {
    const id = "0350d6a5-5bec-4df4-ba51-45df51df60f7";
    const path = await transcript(id, Date.now() - 60_000);
    expect(await findLiveTranscript(CWD, Date.now() + 60_000, new Set(), home, id)).toEqual({ path, sessionId: id });
  });
});

describe("resumedSessionId", () => {
  it("lit l'identifiant de `claude --resume`", () => {
    const id = "0350d6a5-5bec-4df4-ba51-45df51df60f7";
    expect(resumedSessionId(`claude --resume ${id}`)).toBe(id);
    expect(resumedSessionId(`claude -r ${id} --verbose`)).toBe(id);
  });

  it("ne devine rien d'une session neuve ni d'un `--continue`", () => {
    expect(resumedSessionId("claude")).toBeUndefined();
    expect(resumedSessionId("claude --continue")).toBeUndefined();
    expect(resumedSessionId(undefined)).toBeUndefined();
  });
});
