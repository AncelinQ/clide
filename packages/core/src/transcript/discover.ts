import { readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import { claudeHome, projectsDir } from "../paths.js";

export type TranscriptKind = "session" | "subagent" | "unclassified";

export interface TranscriptRef {
  path: string;
  /** Nom encodé du dossier projet, tel que `C--Projets-mon-app`. */
  projectDir: string;
  kind: TranscriptKind;
  /** Session principale pour `session`, session hôte pour `subagent`. */
  sessionId: string;
  /** Identifiant du sous-agent, présent seulement pour `subagent`. */
  agentId?: string;
  size: number;
  mtimeMs: number;
}

/**
 * Classe un transcript d'après sa position sous `projects/`.
 *
 * Une session vit à la racine du dossier projet ; les sous-agents vivent dans
 * `<sessionId>/subagents/agent-<id>.jsonl`. Un parcours à plat les rate, alors
 * qu'ils portent le détail des délégations.
 */
export function classifyTranscript(projectDir: string, segments: string[]): Omit<TranscriptRef, "path" | "size" | "mtimeMs"> {
  const [first, second, third] = segments;

  if (segments.length === 1 && first !== undefined) {
    return { projectDir, kind: "session", sessionId: first.replace(/\.jsonl$/, "") };
  }
  if (segments.length === 3 && first !== undefined && second === "subagents" && third !== undefined) {
    return {
      projectDir,
      kind: "subagent",
      sessionId: first,
      agentId: third.replace(/^agent-/, "").replace(/\.jsonl$/, ""),
    };
  }
  const last = segments[segments.length - 1] ?? "";
  return { projectDir, kind: "unclassified", sessionId: last.replace(/\.jsonl$/, "") };
}

async function walk(dir: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) out.push(full);
  }
}

/**
 * Inventorie tous les transcripts, sous-agents compris.
 */
export async function discoverTranscripts(home: string = claudeHome()): Promise<TranscriptRef[]> {
  const root = projectsDir(home);
  let projects;
  try {
    projects = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const refs: TranscriptRef[] = [];
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const projectRoot = join(root, project.name);
    const files: string[] = [];
    await walk(projectRoot, files);

    for (const path of files) {
      const segments = relative(projectRoot, path).split(sep);
      const classified = classifyTranscript(project.name, segments);
      const info = await stat(path);
      refs.push({ ...classified, path, size: info.size, mtimeMs: info.mtimeMs });
    }
  }
  return refs.sort((a, b) => b.mtimeMs - a.mtimeMs);
}
