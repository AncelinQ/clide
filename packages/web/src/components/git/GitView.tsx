import { Check, Cloud, GitBranch, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { BranchDialog } from "@/components/BranchDialog";
import { GitChip, useGitStatus } from "@/components/GitChip";
import { ContextArea } from "@/components/Menu";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { api, post } from "@/lib/api";
import { cn } from "cn";

interface Branch {
  name: string;
  remoteOnly: boolean;
  current: boolean;
}

/**
 * La vue Git du projet : l'état de la branche et ses gestes (la pastille, son
 * menu), puis les branches, locales puis distantes. Basculer passe par le
 * serveur, qui refuse s'il y a des modifications ; la fenêtre des branches
 * propose alors de les mettre de côté.
 */
export function GitView({ root }: { root: string }) {
  const [status, refreshStatus] = useGitStatus(root);
  const [branches, setBranches] = useState<Branch[]>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [dialog, setDialog] = useState(false);

  const load = useCallback(() => {
    api<{ branches: Branch[] }>("/api/git/branches", { root })
      .then((result) => setBranches(result.branches))
      .catch((caught: unknown) => setError((caught as Error).message));
  }, [root]);

  useEffect(() => {
    setBranches(undefined);
    setError(undefined);
    load();
  }, [load]);

  const switchTo = async (branch: Branch) => {
    setNotice(undefined);
    try {
      const result = await post<{ needsStash?: string[] }>("/api/git/switch", { root, branch: branch.name });
      if (result.needsStash) {
        setDialog(true);
        return;
      }
      setNotice(t("Sur {branch}.", { branch: branch.name }));
      load();
      void refreshStatus();
    } catch (caught) {
      setNotice((caught as Error).message);
    }
  };

  if (error) return <p className="py-2 text-[12px] text-muted-foreground">{error}</p>;

  const local = (branches ?? []).filter((branch) => !branch.remoteOnly);
  const remote = (branches ?? []).filter((branch) => branch.remoteOnly);
  const section = (title: string, items: Branch[], icon: typeof GitBranch) =>
    items.length > 0 && (
      <div>
        <p className="py-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {title} <span className="font-normal normal-case">({items.length})</span>
        </p>
        <ul className="m-0 list-none p-0">
          {items.map((branch) => {
            const Icon = branch.current ? Check : icon;
            return (
              <ContextArea
                key={branch.name}
                items={[
                  { kind: "item", label: t("Basculer sur cette branche"), disabled: branch.current, run: () => void switchTo(branch) },
                  { kind: "item", label: t("Copier le nom"), run: () => void navigator.clipboard.writeText(branch.name) },
                ]}
              >
                <li
                  title={branch.name}
                  onDoubleClick={() => !branch.current && void switchTo(branch)}
                  className={cn(
                    "flex cursor-default items-center gap-2 rounded px-1 py-0.5 font-mono text-[12px] hover:bg-accent",
                    branch.current && "font-semibold text-primary",
                  )}
                >
                  <Icon className="size-3.5 shrink-0" />
                  <span className="truncate">{branch.name}</span>
                </li>
              </ContextArea>
            );
          })}
        </ul>
      </div>
    );

  return (
    // Une colonne qui peut rétrécir : sinon la grille prend la largeur de sa plus
    // longue ligne, et l'îlot étroit en rogne la droite.
    <div className="grid grid-cols-1 gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <GitChip root={root} />
        <div className="flex-1" />
        <Button variant="ghost" size="icon" className="size-6" title={t("Recharger")} onClick={() => { load(); void refreshStatus(); }}>
          <RefreshCw className="size-3.5" />
        </Button>
      </div>
      {notice && <p className="text-[12px] text-muted-foreground">{notice}</p>}
      {branches === undefined ? (
        <p className="text-[12px] text-muted-foreground">{t("Lecture des branches…")}</p>
      ) : (
        <>
          {section(t("Locales"), local, GitBranch)}
          {section(t("Distantes"), remote, Cloud)}
        </>
      )}
      <p className="text-[11px] text-muted-foreground">
        {t("Commit et journal sont dans le bloc sous le terminal, onglets Commit et Commits.")}
      </p>
      {dialog && (
        <BranchDialog
          root={root}
          {...(status?.branch ? { current: status.branch } : {})}
          onClose={() => setDialog(false)}
          onDone={(text) => {
            setNotice(text);
            load();
            void refreshStatus();
          }}
        />
      )}
    </div>
  );
}
