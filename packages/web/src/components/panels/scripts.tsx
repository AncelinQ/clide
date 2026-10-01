import { Layers, Package, Play, Save, Square, SquareArrowOutUpRight, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Async, Empty, useAsync } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import { api, post, shortName } from "@/lib/api";
import type { ProjectScripts } from "@/lib/types";
import { cn } from "cn";
import { useStore } from "@/state/store";
import { focusTerminal, interruptTerminal, runScript, runningScriptTab, scriptKey } from "@/state/terminals";

/** Scripts qu'on lance sans cesse : ils viennent en tête, dans cet ordre. */
const FAVORITE_SCRIPTS = ["dev", "start", "build", "test", "lint", "preview", "typecheck"];

function orderScripts<T extends { name: string }>(scripts: readonly T[]): T[] {
  const rank = (script: T): number => {
    const index = FAVORITE_SCRIPTS.indexOf(script.name);
    return index === -1 ? FAVORITE_SCRIPTS.length : index;
  };
  return [...scripts].sort((a, b) => rank(a) - rank(b));
}

/** Une commande qu'on peut cocher et lancer : un script npm ou une commande d'outil. */
interface Runnable {
  directory: string;
  name: string;
  run: string;
  /** Ce qu'on montre sous le nom : la ligne du `package.json`, ou celle tapée. */
  detail: string;
}

/** Un groupe tel que le serveur le range : ses dossiers relatifs au projet. */
interface ScriptGroup {
  id: string;
  label: string;
  scripts: { directory: string; name: string; run: string }[];
}

const TOOL_LABEL: Record<string, string> = {
  make: "make",
  cargo: "cargo",
  go: "go",
  python: "python",
  powershell: "Scripts PowerShell",
  shell: "Scripts shell",
};

/** Sections d'un dossier : ses `package.json`, puis ses autres outils. */
function sectionsOf(project: ProjectScripts): { title: string; items: Runnable[] }[] {
  const command = (name: string): string => (project.manager === "npm" ? `npm run ${name}` : `${project.manager} run ${name}`);
  return [
    ...project.sources
      .filter((source) => source.scripts.length > 0)
      .map((source) => ({
        title: source.packageName ?? (source.relativePath || t("racine")),
        items: orderScripts(source.scripts).map((script) => ({
          directory: source.directory,
          name: script.name,
          run: command(script.name),
          detail: script.command,
        })),
      })),
    ...(project.tools ?? []).map((tool) => ({
      title: TOOL_LABEL[tool.tool] ?? tool.tool,
      items: tool.commands.map((entry) => ({ directory: tool.directory, name: entry.name, run: entry.run, detail: entry.run })),
    })),
  ];
}

/** Chemin d'un dossier relatif au projet, comme un groupe le range. */
function relativeTo(root: string, directory: string): string {
  const clean = (path: string) => path.replace(/[\\/]+$/, "").replace(/\//g, "\\");
  const base = clean(root);
  const target = clean(directory);
  if (target.toLowerCase() === base.toLowerCase()) return "";
  if (target.toLowerCase().startsWith(`${base.toLowerCase()}\\`)) return target.slice(base.length + 1).split("\\").join("/");
  // Un dossier lié voisin : un cran au-dessus, puis son nom.
  const parent = base.slice(0, base.lastIndexOf("\\"));
  if (target.toLowerCase().startsWith(`${parent.toLowerCase()}\\`)) return `../${target.slice(parent.length + 1).split("\\").join("/")}`;
  return target;
}

function absoluteFrom(root: string, directory: string): string {
  if (/^[a-zA-Z]:[\\/]/.test(directory) || directory.startsWith("\\\\")) return directory;
  const parts = root.replace(/[\\/]+$/, "").split(/[\\/]/);
  for (const segment of directory.split("/").filter(Boolean)) {
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return parts.join("\\");
}

function ScriptLine({
  item,
  checked,
  onCheck,
}: {
  item: Runnable;
  checked: boolean;
  onCheck: (value: boolean) => void;
}) {
  // L'état des onglets change ce que la ligne propose : lancer, ou arrêter.
  useStore((state) => state.terminals);
  const running = runningScriptTab(item.directory, item.name);
  return (
    <li className="group flex items-center gap-2 rounded px-1 py-0.5 text-[12px] hover:bg-accent">
      <input
        type="checkbox"
        className="size-3.5 shrink-0 accent-[var(--primary)]"
        checked={checked}
        onChange={(event) => onCheck(event.target.checked)}
      />
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate", FAVORITE_SCRIPTS.includes(item.name) && "font-medium")}>
          {running && <span className="mr-1.5 inline-block size-1.5 rounded-full bg-emerald-500 align-middle" />}
          {item.name}
        </span>
        <span className="block truncate font-mono text-[10.5px] text-muted-foreground">{item.detail}</span>
      </span>
      {running ? (
        <>
          <Button variant="ghost" size="icon" className="size-6 shrink-0" title={t("Arrêter (Ctrl+C)")} onClick={() => interruptTerminal(running)}>
            <Square className="size-3" />
          </Button>
          <Button variant="ghost" size="icon" className="size-6 shrink-0" title={t("Aller à l'onglet")} onClick={() => focusTerminal(running)}>
            <SquareArrowOutUpRight className="size-3.5" />
          </Button>
        </>
      ) : (
        <Button variant="ghost" size="icon" className="size-6 shrink-0" title={t("Lancer dans son onglet")} onClick={() => runScript(item.name, item.directory, item.run)}>
          <Play className="size-3.5" />
        </Button>
      )}
    </li>
  );
}

/**
 * Scripts du projet et de ses dossiers liés, chacun dans son onglet : on en
 * coche plusieurs pour les lancer ensemble, et un groupe enregistré les relance
 * d'un coup. Un script en cours se voit en tête, avec son adresse s'il en annonce une.
 */
export function ScriptsPanel({ root }: { root: string }) {
  const state = useAsync(() => api<ProjectScripts>("/api/scripts", { root }), [root]);
  const [checked, setChecked] = useState<Map<string, Runnable>>(new Map());
  const [groups, setGroups] = useState<ScriptGroup[]>([]);
  const [naming, setNaming] = useState<string>();
  const [error, setError] = useState<string>();
  const terminals = useStore((store) => store.terminals);

  const loadGroups = useCallback(() => {
    api<{ groups: ScriptGroup[] }>("/api/scripts/groups", { root })
      .then((result) => setGroups(result.groups))
      .catch((caught: unknown) => setError((caught as Error).message));
  }, [root]);

  useEffect(() => {
    setChecked(new Map());
    loadGroups();
  }, [loadGroups]);

  const running = useMemo(
    // Un onglet de script où Claude tourne n'a pas de script en cours : Ctrl+C viserait la session.
    () =>
      Object.values(terminals).filter(
        (entry) => entry.owner === root && entry.info.script && entry.info.kind === "shell" && entry.info.state === "running" && !entry.info.exited,
      ),
    [terminals, root],
  );

  const toggle = (item: Runnable, value: boolean) =>
    setChecked((current) => {
      const next = new Map(current);
      if (value) next.set(scriptKey(item.directory, item.name), item);
      else next.delete(scriptKey(item.directory, item.name));
      return next;
    });

  const launch = (items: { directory: string; name: string; run: string }[]) => {
    // Le dernier lancé prend le premier plan ; les autres démarrent dans leur onglet.
    items.forEach((item, index) => runScript(item.name, item.directory, item.run, { focus: index === items.length - 1 }));
  };

  const saveGroups = async (next: ScriptGroup[]) => {
    try {
      const result = await post<{ groups: ScriptGroup[] }>("/api/scripts/groups/save", { root, groups: next });
      setGroups(result.groups);
    } catch (caught) {
      setError((caught as Error).message);
    }
  };

  const stopGroup = (group: ScriptGroup) => {
    for (const script of group.scripts) {
      const tab = runningScriptTab(absoluteFrom(root, script.directory), script.name);
      if (tab) interruptTerminal(tab);
    }
  };

  return (
    <Async state={state}>
      {(project) => {
        const folders = [
          { title: undefined as string | undefined, project },
          ...(project.linked ?? []).map((folder) => ({ title: t("lié {name}", { name: shortName(folder.root) }), project: folder })),
        ];
        const empty = folders.every(({ project: folder }) => sectionsOf(folder).length === 0);
        if (empty) return <Empty icon={Package}>{t("Aucun script dans ce projet.")}</Empty>;
        const selected = [...checked.values()];
        return (
          <div className="grid grid-cols-1 gap-3">
            {running.length > 0 && (
              <div>
                <p className="py-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{t("En cours")}</p>
                <ul className="m-0 grid list-none gap-0.5 p-0">
                  {running.map(({ info }) => (
                    <li key={info.id} className="flex items-center gap-2 px-1 text-[12px]">
                      <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" />
                      <span className="min-w-0 flex-1 truncate">{info.title}</span>
                      {info.devUrl && (
                        <a href={info.devUrl} target="_blank" rel="noreferrer" title={info.devUrl} className="max-w-[45%] min-w-0 truncate font-mono text-[11px] text-muted-foreground hover:text-foreground hover:underline">
                          {info.devUrl.replace(/^https?:\/\//, "")}
                        </a>
                      )}
                      <Button variant="ghost" size="icon" className="size-6 shrink-0" title={t("Arrêter (Ctrl+C)")} onClick={() => interruptTerminal(info.id)}>
                        <Square className="size-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="size-6 shrink-0" title={t("Aller à l'onglet")} onClick={() => focusTerminal(info.id)}>
                        <SquareArrowOutUpRight className="size-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {groups.length > 0 && (
              <div>
                <p className="py-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{t("Groupes")}</p>
                <ul className="m-0 grid list-none gap-0.5 p-0">
                  {groups.map((group) => (
                    <li key={group.id} className="group flex items-center gap-2 px-1 text-[12px]" title={group.scripts.map((script) => script.name).join(", ")}>
                      <Layers className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">
                        {group.label} <span className="text-[11px] text-muted-foreground">({group.scripts.length})</span>
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6 shrink-0"
                        title={t("tout lancer")}
                        onClick={() => launch(group.scripts.map((script) => ({ ...script, directory: absoluteFrom(root, script.directory) })))}
                      >
                        <Play className="size-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="size-6 shrink-0" title={t("tout arrêter")} onClick={() => stopGroup(group)}>
                        <Square className="size-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6 shrink-0 opacity-0 group-hover:opacity-100"
                        title={t("Supprimer le groupe")}
                        onClick={() => void saveGroups(groups.filter((item) => item.id !== group.id))}
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {error && <p className="text-[12px] text-destructive">{error}</p>}

            {folders.map(({ title, project: folder }) => {
              const sections = sectionsOf(folder);
              if (sections.length === 0) return null;
              return (
                <div key={folder.root} className="grid grid-cols-1 gap-2">
                  <div className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="min-w-0 flex-1 truncate">
                      {title ?? (folder.managerDetected ? folder.manager : t("{manager} (défaut, aucun lockfile)", { manager: folder.manager }))}
                    </span>
                    {folder.sources.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 shrink-0 px-1.5 text-[11px]"
                        onClick={() => runScript("install", folder.root, `${folder.manager} install`)}
                      >
                        {t("installer")}
                      </Button>
                    )}
                  </div>
                  {sections.map((section) => (
                    <div key={`${folder.root}|${section.title}`}>
                      <p className="truncate py-0.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase" title={section.title}>{section.title}</p>
                      <ul className="m-0 list-none p-0">
                        {section.items.map((item) => (
                          <ScriptLine
                            key={scriptKey(item.directory, item.name)}
                            item={item}
                            checked={checked.has(scriptKey(item.directory, item.name))}
                            onCheck={(value) => toggle(item, value)}
                          />
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              );
            })}

            {/* Collée en bas : on coche en défilant, le bouton pour lancer reste à portée. */}
            {selected.length > 0 && (
              <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 rounded-md border bg-background px-2 py-1.5 text-[12px]" data-scripts-selection>
                <span className="basis-full">{t("{count} script(s) coché(s)", { count: selected.length })}</span>
                <Button size="sm" className="h-auto min-h-7 max-w-full whitespace-normal" onClick={() => launch(selected)}>
                  <Play className="size-3.5" /> {t("Lancer ({count})", { count: selected.length })}
                </Button>
                {naming === undefined ? (
                  <Button size="sm" variant="outline" className="h-auto min-h-7 max-w-full whitespace-normal text-left" onClick={() => setNaming("")}>
                    <Save className="size-3.5" /> {t("Enregistrer comme groupe")}
                  </Button>
                ) : (
                  <form
                    className="grid min-w-0 basis-full grid-cols-1 gap-1.5"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!naming.trim()) return;
                      const group: ScriptGroup = {
                        id: crypto.randomUUID(),
                        label: naming.trim(),
                        scripts: selected.map((item) => ({ directory: relativeTo(root, item.directory), name: item.name, run: item.run })),
                      };
                      void saveGroups([...groups, group]);
                      setNaming(undefined);
                      setChecked(new Map());
                    }}
                  >
                    <Input
                      autoFocus
                      value={naming}
                      onChange={(event) => setNaming(event.target.value)}
                      placeholder={t("Nom du groupe, par exemple Tout démarrer")}
                      className="h-8 w-full min-w-0 text-[12px]"
                      onKeyDown={(event) => event.key === "Escape" && setNaming(undefined)}
                    />
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => setNaming(undefined)}>
                        {t("Annuler")}
                      </Button>
                      <Button type="submit" size="sm" className="h-7" disabled={!naming.trim()}>
                        {t("Enregistrer")}
                      </Button>
                    </div>
                  </form>
                )}
              </div>
            )}
          </div>
        );
      }}
    </Async>
  );
}
