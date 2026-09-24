import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export type Forge = "github" | "gitlab";

/** État de la CI, ramené à ce qui se lit d'un coup d'œil. */
export type CiState = "success" | "failed" | "running" | "pending" | "canceled" | "skipped";

export interface Review {
  forge: Forge;
  /** Numéro affiché : `#12` pour une PR GitHub, `!196` pour une MR GitLab. */
  number: number;
  title: string;
  state: "open" | "draft" | "merged" | "closed";
  url: string;
  ci?: CiState;
  ciUrl?: string;
  /** Décision des relecteurs, quand la forge la donne. */
  review?: "approved" | "changes_requested" | "review_required";
}

/** La forge d'un dépôt se lit dans l'adresse de son dépôt distant. */
export function forgeOf(remoteUrl: string): Forge | undefined {
  if (/github/i.test(remoteUrl)) return "github";
  if (/gitlab/i.test(remoteUrl)) return "gitlab";
  return undefined;
}

function ciFromGitlab(status: unknown): CiState | undefined {
  switch (status) {
    case "success":
      return "success";
    case "failed":
      return "failed";
    case "running":
      return "running";
    case "canceled":
    case "canceling":
      return "canceled";
    case "skipped":
      return "skipped";
    case "created":
    case "pending":
    case "preparing":
    case "waiting_for_resource":
    case "scheduled":
    case "manual":
      return "pending";
    default:
      return undefined;
  }
}

/** Lit la sortie de `glab mr view <branche> -F json`. */
export function parseGlabMr(json: string): Review {
  const mr = JSON.parse(json) as Record<string, unknown>;
  const pipeline = mr["head_pipeline"] as Record<string, unknown> | null | undefined;
  const state = mr["state"];
  const ci = ciFromGitlab(pipeline?.["status"]);
  return {
    forge: "gitlab",
    number: Number(mr["iid"]),
    title: String(mr["title"] ?? ""),
    state: state === "merged" ? "merged" : state === "closed" ? "closed" : mr["draft"] ? "draft" : "open",
    url: String(mr["web_url"] ?? ""),
    ...(ci ? { ci } : {}),
    ...(typeof pipeline?.["web_url"] === "string" ? { ciUrl: pipeline["web_url"] } : {}),
  };
}

/**
 * Résume les vérifications d'une PR GitHub : un échec l'emporte sur tout, puis ce
 * qui tourne encore, puis ce qui attend ; tout vert n'est « success » que s'il y a
 * au moins une vérification.
 */
function rollup(checks: Record<string, unknown>[]): CiState | undefined {
  if (checks.length === 0) return undefined;
  const states = checks.map((check) => {
    const conclusion = String(check["conclusion"] ?? check["state"] ?? "").toUpperCase();
    const status = String(check["status"] ?? "").toUpperCase();
    if (["FAILURE", "ERROR", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(conclusion)) return "failed";
    if (conclusion === "CANCELLED") return "canceled";
    if (status === "IN_PROGRESS") return "running";
    if (["QUEUED", "PENDING", "WAITING", "REQUESTED"].includes(status) || conclusion === "PENDING" || conclusion === "EXPECTED") return "pending";
    if (conclusion === "SKIPPED" || conclusion === "NEUTRAL") return "skipped";
    return "success";
  });
  for (const state of ["failed", "canceled", "running", "pending"] as const) if (states.includes(state)) return state;
  return states.every((state) => state === "skipped") ? "skipped" : "success";
}

/** Lit la sortie de `gh pr view <branche> --json …`. */
export function parseGhPr(json: string): Review {
  const pr = JSON.parse(json) as Record<string, unknown>;
  const state = String(pr["state"] ?? "").toUpperCase();
  const decision = String(pr["reviewDecision"] ?? "").toUpperCase();
  const ci = rollup(Array.isArray(pr["statusCheckRollup"]) ? (pr["statusCheckRollup"] as Record<string, unknown>[]) : []);
  const review =
    decision === "APPROVED"
      ? "approved"
      : decision === "CHANGES_REQUESTED"
        ? "changes_requested"
        : decision === "REVIEW_REQUIRED"
          ? "review_required"
          : undefined;
  return {
    forge: "github",
    number: Number(pr["number"]),
    title: String(pr["title"] ?? ""),
    state: state === "MERGED" ? "merged" : state === "CLOSED" ? "closed" : pr["isDraft"] ? "draft" : "open",
    url: String(pr["url"] ?? ""),
    ...(ci ? { ci } : {}),
    ...(review ? { review } : {}),
  };
}

/** Une branche sans MR n'est pas une erreur : les deux CLI le disent chacune à sa façon. */
const NO_REVIEW = /no pull requests found for branch|no open merge request available for/i;

const cache = new Map<string, { at: number; value: Review | null }>();
/** Une MR bouge à l'échelle de la minute ; chaque appel aux CLI coûte une seconde. */
const CACHE_MS = 60_000;

/**
 * MR ou PR de la branche, par `gh` ou `glab` selon la forge du dépôt distant. Les
 * deux CLI gardent leur propre connexion : l'application ne voit ni ne stocke de
 * jeton. `null` quand la branche n'en a pas, ou qu'aucune forge n'est reconnue ;
 * une CLI absente ou déconnectée lève, pour que l'interface le dise.
 */
export async function reviewFor(root: string, branch: string, remoteUrl: string): Promise<Review | null> {
  const forge = forgeOf(remoteUrl);
  if (!forge) return null;
  const key = `${root}|${branch}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;

  const [command, args, parse] =
    forge === "github"
      ? ([
          "gh",
          ["pr", "view", branch, "--json", "number,title,state,isDraft,url,reviewDecision,statusCheckRollup"],
          parseGhPr,
        ] as const)
      : (["glab", ["mr", "view", branch, "-F", "json"], parseGlabMr] as const);
  let value: Review | null;
  try {
    const { stdout } = await run(command, [...args], { cwd: root, windowsHide: true, timeout: 20_000, maxBuffer: 8 * 1024 * 1024 });
    value = parse(stdout);
  } catch (error) {
    const detail = error as { stderr?: string; message?: string; code?: string };
    const text = `${detail.stderr ?? ""} ${detail.message ?? ""}`;
    if (detail.code === "ENOENT") throw new Error(`${command} n'est pas installé : l'état des ${forge === "github" ? "PR" : "MR"} passe par lui`);
    if (!NO_REVIEW.test(text)) throw new Error((detail.stderr || detail.message || `${command} a échoué`).trim());
    value = null;
  }
  cache.set(key, { at: Date.now(), value });
  return value;
}
