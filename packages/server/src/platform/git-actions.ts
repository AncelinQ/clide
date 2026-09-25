import { execFile } from "node:child_process";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
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
  /** Fichiers suivis modifiés, indexés ou non. */
  changed: number;
  /** Fichiers nouveaux que git ne suit pas encore. */
  untracked: number;
  /**
   * La branche suit une branche distante qui n'existe plus — supprimée après la
   * fusion de sa MR, le plus souvent : il n'y a plus rien à tirer ni où pousser.
   */
  upstreamGone?: boolean;
  /** Fichiers en conflit. */
  conflicted: number;
}

/**
 * Lit `git status --porcelain=v2 --branch` : une seule commande pour la branche,
 * son amont, l'écart avec lui et les fichiers touchés. Le format v2 est stable
 * d'une version de git à l'autre, contrairement à la sortie lisible.
 */
export function parseStatusV2(text: string): GitStatus {
  const status: GitStatus = { ahead: 0, behind: 0, changed: 0, untracked: 0, conflicted: 0 };
  // git n'écrit l'écart que si l'amont existe encore : nommé sans écart, il a disparu.
  let compared = false;
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
      compared = true;
      const match = /\+(\d+) -(\d+)/.exec(line);
      status.ahead = Number(match?.[1] ?? 0);
      status.behind = Number(match?.[2] ?? 0);
    } else if (line.startsWith("u ")) {
      status.conflicted += 1;
    } else if (line.startsWith("? ")) {
      status.untracked += 1;
    } else if (/^[12] /.test(line)) {
      status.changed += 1;
    }
  }
  if (status.upstream && !compared) status.upstreamGone = true;
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

/** Issue d'un pull, dépôt par dépôt. */
export type PullOutcome =
  | { root: string; outcome: "updated"; branch: string; commits: number }
  | { root: string; outcome: "up-to-date"; branch: string }
  | { root: string; outcome: "skipped"; reason: "not-a-repo" | "detached" | "no-upstream" | "upstream-gone" }
  | { root: string; outcome: "error"; message: string };

/**
 * Tire un dépôt en avance rapide et dit ce qui s'est passé.
 *
 * Ne lève jamais : un pull groupé doit rapporter chaque dépôt, et l'échec de l'un
 * — une branche qui a divergé, une modification locale sur un fichier entrant —
 * ne doit pas masquer le sort des autres. Ce qui ne peut pas être tiré (hors
 * d'un dépôt, HEAD détaché, sans amont) est écarté sans lancer git pull.
 */
export async function pullReport(root: string): Promise<PullOutcome> {
  const status = await gitStatus(root);
  if (!status) return { root, outcome: "skipped", reason: "not-a-repo" };
  if (!status.branch) return { root, outcome: "skipped", reason: "detached" };
  if (!status.upstream) return { root, outcome: "skipped", reason: "no-upstream" };
  if (status.upstreamGone) return { root, outcome: "skipped", reason: "upstream-gone" };
  try {
    const before = (await git(root, ["rev-parse", "HEAD"], 15_000)).trim();
    await gitPull(root);
    const after = (await git(root, ["rev-parse", "HEAD"], 15_000)).trim();
    if (before === after) return { root, outcome: "up-to-date", branch: status.branch };
    const commits = Number((await git(root, ["rev-list", "--count", `${before}..${after}`], 15_000)).trim());
    return { root, outcome: "updated", branch: status.branch, commits };
  } catch (error) {
    return { root, outcome: "error", message: error instanceof Error ? error.message : String(error) };
  }
}

/** Dépôts tirés en même temps : chacun attend surtout le réseau. */
const PULL_CONCURRENCY = 4;

/**
 * Tire plusieurs dépôts, quelques-uns à la fois, et rend un compte rendu dans
 * l'ordre reçu. Un même dossier cité deux fois — un projet ouvert, lié aussi à un
 * autre — n'est tiré qu'une fois.
 */
export async function pullMany(roots: string[]): Promise<PullOutcome[]> {
  const seen = new Set<string>();
  const unique = roots.filter((root) => {
    const key = root.replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const results: PullOutcome[] = new Array(unique.length);
  let next = 0;
  const worker = async () => {
    while (next < unique.length) {
      const index = next++;
      results[index] = await pullReport(unique[index] as string);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PULL_CONCURRENCY, unique.length) }, worker));
  return results;
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
  /**
   * La branche a divergé de son amont — des commits de part et d'autre, après
   * un rebase le plus souvent : seul un push forcé passerait.
   */
  diverged: boolean;
  /** Commits de l'amont qu'un push forcé effacerait. */
  overwritten: { hash: string; subject: string }[];
  /** Commit de l'amont vu par l'aperçu : le push forcé n'écrase que lui. */
  remoteHead?: string;
}

function parseLog(log: string): { hash: string; subject: string }[] {
  return log
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [hash = "", ...subject] = line.split("\t");
      return { hash, subject: subject.join("\t") };
    });
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
  const commits = parseLog(await git(root, ["log", "--format=%h%x09%s", ...range], 15_000));

  const diverged = !!status.upstream && status.ahead > 0 && status.behind > 0;
  const overwritten = diverged
    ? parseLog(await git(root, ["log", "--format=%h%x09%s", `HEAD..${status.upstream}`], 15_000))
    : [];
  const remoteHead = status.upstream ? (await git(root, ["rev-parse", status.upstream], 15_000)).trim() : undefined;

  const blocked = diverged
    ? `la branche a divergé de ${status.upstream} : un push normal serait refusé`
    : status.behind > 0
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
    diverged,
    overwritten,
    ...(remoteHead ? { remoteHead } : {}),
  };
}

/**
 * Pousse la branche courante. Le plan est relu au moment d'envoyer : si HEAD a
 * bougé depuis l'aperçu, ce qu'on a validé n'est plus ce qui partirait, et le
 * push est refusé.
 *
 * Forcer n'est permis que sur une branche qui a divergé, et seulement contre le
 * commit distant que l'aperçu a montré (`--force-with-lease`) : si quelqu'un a
 * poussé depuis, git refuse au lieu d'effacer son travail. Une branche qui n'est
 * qu'en retard n'a rien à envoyer : la forcer ne ferait que détruire.
 */
export async function gitPush(
  root: string,
  expectedHead: string,
  force?: { remoteHead: string },
): Promise<PushPlan> {
  const plan = await pushPlan(root);
  if (plan.head !== expectedHead) throw new Error("la branche a changé depuis l'aperçu : relire ce qui partirait");
  const target = `HEAD:refs/heads/${plan.target}`;
  if (force) {
    if (!plan.diverged) throw new Error(plan.blocked ?? "la branche n'a pas divergé : un push normal suffit");
    if (plan.remoteHead !== force.remoteHead) {
      throw new Error("la branche distante a changé depuis l'aperçu : relire ce qui serait écrasé");
    }
    await git(root, ["push", `--force-with-lease=refs/heads/${plan.target}:${force.remoteHead}`, plan.remote, target]);
  } else {
    if (plan.blocked) throw new Error(plan.blocked);
    await git(root, ["push", ...(plan.setUpstream ? ["-u"] : []), plan.remote, target]);
  }
  return plan;
}

export interface Branch {
  name: string;
  /** Branche qui n'existe que sur le dépôt distant : la choisir la crée en la suivant. */
  remoteOnly: boolean;
  current: boolean;
  /** Date du dernier commit, pour mettre en tête ce qui a bougé récemment. */
  at?: string;
}

/**
 * Branches locales, puis celles qui n'existent que sur un dépôt distant, les plus
 * récemment touchées d'abord. `origin/HEAD` n'est qu'un alias et n'est pas une
 * branche.
 */
export function parseBranches(forEachRef: string, current: string | undefined): Branch[] {
  const local = new Map<string, Branch>();
  const remote = new Map<string, Branch>();
  for (const line of forEachRef.split(/\r?\n/)) {
    const [ref = "", at] = line.split("\t");
    if (ref.startsWith("refs/heads/")) {
      const name = ref.slice("refs/heads/".length);
      local.set(name, { name, remoteOnly: false, current: name === current, ...(at ? { at } : {}) });
    } else if (ref.startsWith("refs/remotes/")) {
      const short = ref.slice("refs/remotes/".length);
      const name = short.slice(short.indexOf("/") + 1);
      if (!name || name === "HEAD" || remote.has(name)) continue;
      remote.set(name, { name, remoteOnly: true, current: false, ...(at ? { at } : {}) });
    }
  }
  const byDate = (a: Branch, b: Branch) => (b.at ?? "").localeCompare(a.at ?? "");
  return [
    ...[...local.values()].sort(byDate),
    ...[...remote.values()].filter((branch) => !local.has(branch.name)).sort(byDate),
  ];
}

export async function listBranches(root: string): Promise<Branch[]> {
  const status = await gitStatus(root);
  const refs = await git(
    root,
    ["for-each-ref", "--format=%(refname)%09%(committerdate:iso-strict)", "refs/heads", "refs/remotes"],
    15_000,
  );
  return parseBranches(refs, status?.branch);
}

/** Adresse du dépôt distant que suit la branche, à défaut `origin`, à défaut le premier. */
export async function remoteUrl(root: string): Promise<string | undefined> {
  const status = await gitStatus(root);
  const remotes = (await git(root, ["remote"], 15_000)).split(/\r?\n/).filter(Boolean);
  const remote = status?.upstream?.split("/")[0] ?? (remotes.includes("origin") ? "origin" : remotes[0]);
  if (!remote) return undefined;
  return (await git(root, ["remote", "get-url", remote], 15_000)).trim();
}

/** Nombre d'entrées de `git stash list`. */
export async function stashCount(root: string): Promise<number> {
  try {
    return (await git(root, ["stash", "list"], 15_000)).split(/\r?\n/).filter(Boolean).length;
  } catch {
    return 0;
  }
}

async function checkBranchName(root: string, name: string): Promise<void> {
  try {
    await git(root, ["check-ref-format", "--branch", name], 15_000);
  } catch {
    throw new Error(`« ${name} » n'est pas un nom de branche valide`);
  }
}

/** Erreur qui dit à l'interface de proposer un stash avant de changer de branche. */
export class DirtyTreeError extends Error {
  constructor(readonly changed: number) {
    super(`${changed} fichier(s) modifié(s) : les mettre de côté (stash) avant de changer de branche`);
  }
}

/**
 * Passe sur une branche, locale ou seulement distante — git crée alors la branche
 * locale qui la suit.
 *
 * Des modifications non commitées de fichiers suivis bloquent le changement tant
 * qu'on n'a pas dit quoi en faire : les emporter sur l'autre branche peut les
 * mêler à un travail qui n'a rien à voir. `stash` les met de côté sous un message
 * qui dit d'où elles viennent. Les fichiers non suivis, eux, ne bloquent rien :
 * git les laisse en place, et refuse seul — en le disant — ceux qu'un fichier de
 * l'autre branche écraserait.
 */
export async function switchBranch(
  root: string,
  name: string,
  options: { stash?: boolean } = {},
): Promise<{ stashed: boolean }> {
  await checkBranchName(root, name);
  const status = await gitStatus(root);
  if (!status) throw new Error("ce dossier n'est pas un dépôt git");
  if (status.conflicted > 0) throw new Error("des conflits sont en cours : les résoudre avant de changer de branche");
  const dirty = status.changed > 0;
  if (dirty && !options.stash) throw new DirtyTreeError(status.changed);
  if (dirty) {
    await git(root, ["stash", "push", "--include-untracked", "-m", `Clide : avant de passer de ${status.branch ?? status.head ?? "?"} à ${name}`]);
  }
  try {
    await git(root, ["switch", name]);
  } catch (error) {
    // Le changement a échoué : ce qu'on vient de mettre de côté revient à sa place.
    if (dirty) await git(root, ["stash", "pop"]).catch(() => undefined);
    throw error;
  }
  return { stashed: dirty };
}

/** Crée une branche depuis HEAD et passe dessus ; les modifications en cours la suivent. */
export async function createBranch(root: string, name: string): Promise<void> {
  await checkBranchName(root, name);
  await git(root, ["switch", "-c", name]);
}

/** Réapplique le dernier stash et le retire de la liste s'il s'applique sans conflit. */
export async function stashPop(root: string): Promise<void> {
  await git(root, ["stash", "pop"]);
}

/** Un nom de branche devient un nom de dossier : `aqn/feat/x` donne `aqn-feat-x`. */
export function worktreeFolder(branch: string): string {
  return branch.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * Crée un worktree pour une branche, neuve ou existante, sous `.claude/worktrees/`
 * — là où Claude Code range les siens — et rend son chemin.
 */
export async function createWorktree(root: string, branch: string): Promise<string> {
  await checkBranchName(root, branch);
  const top = (await git(root, ["rev-parse", "--show-toplevel"], 15_000)).trim();
  const path = join(top, ".claude", "worktrees", worktreeFolder(branch));
  const exists = (await listBranches(root)).find((candidate) => candidate.name === branch);
  if (!exists) await git(root, ["worktree", "add", "-b", branch, path]);
  else await git(root, ["worktree", "add", path, branch]);
  await excludeWorktrees(root);
  return path;
}

/**
 * Un worktree rangé dans le dépôt y apparaît comme un dossier non suivi : il
 * compterait parmi les modifications, et chaque changement de branche proposerait
 * de le mettre de côté. Le dossier est exclu dans `.git/info/exclude`, propre à ce
 * clone, qui ne se commite pas et ne touche à aucun `.gitignore`.
 */
async function excludeWorktrees(root: string): Promise<void> {
  const common = (await git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"], 15_000)).trim();
  const file = join(common, "info", "exclude");
  const current = await readFile(file, "utf8").catch(() => "");
  if (current.split(/\r?\n/).includes(WORKTREES_EXCLUDE)) return;
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, `${current && !current.endsWith("\n") ? "\n" : ""}${WORKTREES_EXCLUDE}\n`);
}

const WORKTREES_EXCLUDE = "/.claude/worktrees/";
