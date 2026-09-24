import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface GitStatus {
  /** Branche courante ; absente sur un HEAD détaché. */
  branch?: string;
  /** Commit courant, abrégé. */
  head?: string;
  upstream?: string;
  ahead: number;
  behind: number;
  /** Fichiers modifiés, indexés ou non suivis. */
  changed: number;
  /** Fichiers en conflit. */
  conflicted: number;
}

/**
 * Lit `git status --porcelain=v2 --branch` : une seule commande pour la branche,
 * son amont, l'écart avec lui et les fichiers touchés. Le format v2 est stable
 * d'une version de git à l'autre, contrairement à la sortie lisible.
 */
export function parseStatusV2(text: string): GitStatus {
  const status: GitStatus = { ahead: 0, behind: 0, changed: 0, conflicted: 0 };
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("# branch.oid ")) {
      const oid = line.slice("# branch.oid ".length);
      if (oid !== "(initial)") status.head = oid.slice(0, 8);
    } else if (line.startsWith("# branch.head ")) {
      const head = line.slice("# branch.head ".length);
      if (head !== "(detached)") status.branch = head;
    } else if (line.startsWith("# branch.upstream ")) {
      status.upstream = line.slice("# branch.upstream ".length);
    } else if (line.startsWith("# branch.ab ")) {
      const match = /\+(\d+) -(\d+)/.exec(line);
      status.ahead = Number(match?.[1] ?? 0);
      status.behind = Number(match?.[2] ?? 0);
    } else if (line.startsWith("u ")) {
      status.conflicted += 1;
    } else if (/^[12?] /.test(line)) {
      status.changed += 1;
    }
  }
  return status;
}

/**
 * Lance git sans jamais attendre une saisie : sans terminal où répondre, une
 * demande de mot de passe bloquerait la requête jusqu'à son délai. Le gestionnaire
 * d'identifiants de Windows, lui, ouvre sa propre fenêtre.
 */
async function git(cwd: string, args: string[], timeout = 120_000): Promise<string> {
  try {
    const { stdout } = await run("git", args, {
      cwd,
      windowsHide: true,
      timeout,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    return stdout;
  } catch (error) {
    const detail = error as { stderr?: string; message?: string };
    throw new Error((detail.stderr || detail.message || `git ${args[0]} a échoué`).trim());
  }
}

/** État git d'un dossier ; `null` hors d'un dépôt. */
export async function gitStatus(root: string): Promise<GitStatus | null> {
  try {
    return parseStatusV2(await git(root, ["status", "--porcelain=v2", "--branch"], 15_000));
  } catch {
    return null;
  }
}

export async function gitFetch(root: string): Promise<void> {
  await git(root, ["fetch", "--prune"]);
}

/**
 * Tire l'amont en avance rapide seulement : une fusion ou un rebase décidés par
 * un bouton réécriraient l'historique local sans qu'on l'ait regardé.
 */
export async function gitPull(root: string): Promise<void> {
  await git(root, ["pull", "--ff-only"]);
}

export interface PushPlan {
  branch: string;
  /** Commit poussé : le push est refusé s'il a changé depuis l'aperçu. */
  head: string;
  remote: string;
  /** Branche distante visée. */
  target: string;
  /** La branche n'a pas encore d'amont : le push le crée. */
  setUpstream: boolean;
  commits: { hash: string; subject: string }[];
  /** Ce qui interdit le push, dit avant qu'on ne le tente. */
  blocked?: string;
}

/** Ce qu'un push enverrait, sans rien envoyer. */
export async function pushPlan(root: string): Promise<PushPlan> {
  const status = await gitStatus(root);
  if (!status) throw new Error("ce dossier n'est pas un dépôt git");
  if (!status.branch) throw new Error("HEAD détaché : aucune branche à pousser");
  const head = (await git(root, ["rev-parse", "HEAD"], 15_000)).trim();
  const remotes = (await git(root, ["remote"], 15_000)).split(/\r?\n/).filter(Boolean);
  const upstreamRemote = status.upstream?.split("/")[0];
  const remote = upstreamRemote ?? (remotes.includes("origin") ? "origin" : remotes[0]);
  if (!remote) throw new Error("aucun dépôt distant configuré");

  // Avec un amont, ce qui lui manque ; sans, ce qu'aucune branche distante n'a.
  const range = status.upstream ? [`${status.upstream}..HEAD`] : ["HEAD", "--not", "--remotes"];
  const log = await git(root, ["log", "--format=%h%x09%s", ...range], 15_000);
  const commits = log
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [hash = "", ...subject] = line.split("\t");
      return { hash, subject: subject.join("\t") };
    });

  const blocked =
    status.behind > 0
      ? `la branche a ${status.behind} commit(s) de retard sur ${status.upstream} : tirer d'abord`
      : commits.length === 0 && !!status.upstream
        ? "rien à pousser"
        : undefined;
  return {
    branch: status.branch,
    head,
    remote,
    target: status.upstream ? status.upstream.slice(remote.length + 1) : status.branch,
    setUpstream: !status.upstream,
    commits,
    ...(blocked ? { blocked } : {}),
  };
}

/**
 * Pousse la branche courante, jamais de force. Le plan est relu au moment
 * d'envoyer : si HEAD a bougé depuis l'aperçu, ce qu'on a validé n'est plus ce
 * qui partirait, et le push est refusé.
 */
export async function gitPush(root: string, expectedHead: string): Promise<PushPlan> {
  const plan = await pushPlan(root);
  if (plan.blocked) throw new Error(plan.blocked);
  if (plan.head !== expectedHead) throw new Error("la branche a changé depuis l'aperçu : relire ce qui partirait");
  await git(root, ["push", ...(plan.setUpstream ? ["-u"] : []), plan.remote, `HEAD:refs/heads/${plan.target}`]);
  return plan;
}
