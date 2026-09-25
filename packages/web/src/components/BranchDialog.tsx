import { GitBranch, GitBranchPlus, GitFork } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import { api, post } from "@/lib/api";
import { openTerminal } from "@/state/terminals";
import { cn } from "cn";

interface Branch {
  name: string;
  remoteOnly: boolean;
  current: boolean;
}

/**
 * Changer de branche, en créer une, ou ouvrir une branche dans un worktree avec
 * Claude dedans.
 *
 * Des modifications non commitées arrêtent le changement de branche : la fenêtre
 * propose alors de les mettre de côté (stash), et dit comment les reprendre.
 * Créer une branche les emporte, elles n'ont rien à craindre.
 */
export function BranchDialog({
  root,
  current,
  onClose,
  onDone,
}: {
  root: string;
  current?: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const [branches, setBranches] = useState<Branch[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [stashFor, setStashFor] = useState<{ branch: string; changed: number }>();
  const [fetching, setFetching] = useState(true);

  // La liste connue s'affiche aussitôt ; un fetch la complète ensuite des
  // branches poussées depuis, sans quoi celle d'un collègue resterait
  // introuvable. Un fetch qui échoue (hors ligne) laisse la liste connue.
  useEffect(() => {
    let alive = true;
    const load = () =>
      api<{ branches: Branch[] }>("/api/git/branches", { root }).then((result) => {
        if (alive) setBranches(result.branches);
      });
    load().catch((caught: Error) => alive && setError(caught.message));
    post("/api/git/fetch", { root })
      .then(load)
      .catch(() => undefined)
      .finally(() => alive && setFetching(false));
    return () => {
      alive = false;
    };
  }, [root]);

  // Qui ouvre la fenêtre ne connaît pas toujours la branche courante : la liste la donne.
  const currentBranch = current ?? branches?.find((branch) => branch.current)?.name;

  const wanted = filter.trim();
  const shown = (branches ?? []).filter((branch) => branch.name.toLowerCase().includes(wanted.toLowerCase())).slice(0, 60);
  const exact = branches?.some((branch) => branch.name === wanted);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const switchTo = (branch: string, stash = false) =>
    run(async () => {
      const result = await post<{ stashed?: boolean; needsStash?: number }>("/api/git/switch", { root, branch, stash });
      if (result.needsStash !== undefined) {
        setStashFor({ branch, changed: result.needsStash });
        return;
      }
      onDone(
        result.stashed
          ? t("Sur {branch}. Les modifications sont mises de côté : « Réappliquer le dernier stash » les reprend.", { branch })
          : t("Sur {branch}.", { branch }),
      );
      onClose();
    });

  const create = (name: string) =>
    run(async () => {
      await post("/api/git/create-branch", { root, name });
      onDone(t("Branche {branch} créée.", { branch: name }));
      onClose();
    });

  const worktree = (branch: string) =>
    run(async () => {
      const { path } = await post<{ path: string }>("/api/git/worktree", { root, branch });
      openTerminal("claude", { cwd: path, command: "claude" });
      onDone(t("Worktree {branch} créé, Claude y est lancé.", { branch }));
      onClose();
    });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("Branches")}</DialogTitle>
          <DialogDescription>
            {currentBranch ? t("Sur {branch}.", { branch: currentBranch }) : branches ? t("HEAD détaché.") : ""}{" "}
            {t("Un clic change de branche ; l'icône de fourche l'ouvre dans un worktree, avec Claude.")}
          </DialogDescription>
        </DialogHeader>

        {stashFor ? (
          <div className="grid gap-3">
            <p className="text-[13px]">
              {t("{count} fichier(s) modifié(s) sur {current}. Les mettre de côté (stash) puis passer sur {branch} ?", {
                count: stashFor.changed,
                current: currentBranch ?? "HEAD",
                branch: stashFor.branch,
              })}
            </p>
            {error && <p className="text-[12px] text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setStashFor(undefined)}>
                {t("Annuler")}
              </Button>
              <Button disabled={busy} onClick={() => void switchTo(stashFor.branch, true)}>
                {t("Mettre de côté et changer")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-2">
            <Input
              autoFocus
              value={filter}
              placeholder={t("Filtrer, ou nommer une nouvelle branche…")}
              onChange={(event) => setFilter(event.target.value)}
              className="h-8 font-mono text-[12px]"
            />
            {fetching && (
              <p className="text-[11px] text-muted-foreground">{t("Récupération des branches distantes…")}</p>
            )}
            {wanted && branches && !exact && (
              <div className="flex flex-wrap gap-1.5">
                <Button variant="outline" size="sm" disabled={busy} onClick={() => void create(wanted)}>
                  <GitBranchPlus /> {t("Créer {branch} ici", { branch: wanted })}
                </Button>
                <Button variant="outline" size="sm" disabled={busy} onClick={() => void worktree(wanted)}>
                  <GitFork /> {t("Créer dans un worktree, avec Claude")}
                </Button>
              </div>
            )}
            <ul className="m-0 max-h-80 list-none overflow-auto rounded-md border p-0">
              {!branches && !error && <li className="px-2 py-1.5 text-[12px] text-muted-foreground">{t("Lecture des branches…")}</li>}
              {shown.map((branch) => (
                <li key={`${branch.remoteOnly}|${branch.name}`} className="group flex items-center border-b last:border-0">
                  <button
                    type="button"
                    disabled={busy || branch.current}
                    onClick={() => void switchTo(branch.name)}
                    className={cn(
                      "flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left font-mono text-[12px] hover:bg-accent disabled:hover:bg-transparent",
                      branch.current && "font-semibold",
                    )}
                  >
                    <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{branch.name}</span>
                    {branch.current && <Badge variant="secondary">{t("actuelle")}</Badge>}
                    {branch.remoteOnly && <Badge variant="outline">{t("distante")}</Badge>}
                  </button>
                  {!branch.current && (
                    <button
                      type="button"
                      disabled={busy}
                      title={t("Ouvrir dans un worktree, avec Claude")}
                      onClick={() => void worktree(branch.name)}
                      className="px-2 py-1.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground"
                    >
                      <GitFork className="size-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {error && <p className="text-[12px] text-destructive">{error}</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
