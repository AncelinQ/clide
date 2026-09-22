import { GitBranch, Link2, Package, Plug, Play, Sparkles } from "lucide-react";
import { useState } from "react";

import { ActionButton, Async, DangerButton, Empty, Row, Rows, Section, useAsync } from "@/components/common";
import { McpHealth, useMcpStatus } from "@/components/panels/mcp";
import { SkillEditor, SkillRow } from "@/components/panels/skills";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, post } from "@/lib/api";
import type { McpServer, ProjectLink, ProjectScripts, Skill, SlashCommand, Worktree } from "@/lib/types";
import { openTerminal } from "@/state/terminals";

// ─── Dossiers liés ──────────────────────────────────────────────────────────

export function LinksPanel({ root }: { root: string }) {
  const state = useAsync(() => api<{ links: ProjectLink[] }>("/api/links", { root }), [root]);
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState("");
  const [role, setRole] = useState("");
  const [readOnly, setReadOnly] = useState("non");

  const save = async (links: ProjectLink[]) => {
    await post("/api/links/save", { root, links });
    state.reload();
  };

  return (
    <Async state={state}>
      {({ links }) => (
        <>
          {links.length === 0 ? (
            <Empty icon={Link2}>Les autres dépôts dont celui-ci dépend.</Empty>
          ) : (
            <Rows>
              {links.map((link) => (
                <Row
                  key={link.path}
                  title={link.path}
                  sub={link.role}
                  badges={link.readOnly && <Badge variant="outline">lecture seule</Badge>}
                  actions={
                    <>
                      <ActionButton
                        onAction={() =>
                          save(links.map((l) => (l.path === link.path ? { ...l, readOnly: !l.readOnly } : l)))
                        }
                      >
                        {link.readOnly ? "rendre modifiable" : "lecture seule"}
                      </ActionButton>
                      <DangerButton
                        label="délier"
                        onConfirm={() => save(links.filter((l) => l.path !== link.path))}
                      />
                    </>
                  }
                />
              ))}
            </Rows>
          )}

          {open ? (
            <div className="mt-3 flex flex-col gap-2">
              <Label>Chemin</Label>
              <Input value={path} onChange={(e) => setPath(e.target.value)} placeholder="C:\Projets\api" />
              <Label>Rôle</Label>
              <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="api, design system…" />
              <Label>Accès</Label>
              <Select value={readOnly} onValueChange={setReadOnly}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="non">Claude peut y écrire</SelectItem>
                  <SelectItem value="oui">Lecture seule</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex gap-2">
                <ActionButton
                  variant="default"
                  onAction={async () => {
                    await save([
                      ...links.filter((l) => l.path !== path.trim()),
                      { path: path.trim(), role, readOnly: readOnly === "oui" },
                    ]);
                    setOpen(false);
                    setPath("");
                    setRole("");
                  }}
                >
                  Lier
                </ActionButton>
                <ActionButton onAction={() => setOpen(false)}>Annuler</ActionButton>
              </div>
            </div>
          ) : (
            <Button variant="outline" size="sm" className="mt-3 h-7" onClick={() => setOpen(true)}>
              Lier un dossier
            </Button>
          )}
        </>
      )}
    </Async>
  );
}

// ─── Scripts ────────────────────────────────────────────────────────────────

export function ScriptsPanel({ root }: { root: string }) {
  const state = useAsync(() => api<ProjectScripts>("/api/scripts", { root }), [root]);

  return (
    <Async state={state}>
      {(project) => {
        const any = project.sources.some((source) => source.scripts.length > 0);
        if (!any) return <Empty icon={Package}>Aucun script dans ce projet.</Empty>;
        return (
          <>
            <p className="text-[11px] text-muted-foreground">
              {project.manager}
              {project.managerDetected ? "" : " (défaut, aucun lockfile)"}
            </p>
            {project.sources
              .filter((source) => source.scripts.length > 0)
              .map((source) => (
                <div key={source.directory}>
                  <Section>{source.packageName ?? source.relativePath ?? "racine"}</Section>
                  <Rows>
                    {source.scripts.map((script) => (
                      <Row
                        key={script.name}
                        title={script.name}
                        sub={script.command}
                        actions={
                          <ActionButton
                            onAction={() =>
                              openTerminal("shell", {
                                cwd: source.directory,
                                command:
                                  project.manager === "npm"
                                    ? `npm run ${script.name}`
                                    : `${project.manager} run ${script.name}`,
                              })
                            }
                          >
                            <Play className="size-3" /> lancer
                          </ActionButton>
                        }
                      />
                    ))}
                  </Rows>
                </div>
              ))}
          </>
        );
      }}
    </Async>
  );
}

// ─── Skills du projet ───────────────────────────────────────────────────────

export function ProjectSkillsPanel({ root }: { root: string }) {
  const state = useAsync(
    () => api<{ skills: Skill[]; commands: SlashCommand[] }>("/api/skills", { root }),
    [root],
  );
  const [editing, setEditing] = useState<Partial<Skill> | null>(null);

  if (editing) {
    return (
      <SkillEditor
        skill={{ ...editing, scope: "project" }}
        root={root}
        onDone={() => {
          setEditing(null);
          state.reload();
        }}
      />
    );
  }

  return (
    <Async state={state}>
      {({ skills, commands }) => {
        const own = skills.filter((skill) => skill.scope === "project");
        const ownCommands = commands.filter((command) => command.scope === "project");
        return (
          <>
            {own.length === 0 ? (
              <Empty icon={Sparkles}>Les skills vivent dans .claude/skills/&lt;nom&gt;/SKILL.md.</Empty>
            ) : (
              <Rows>
                {own.map((skill) => (
                  <SkillRow
                    key={skill.path}
                    skill={skill}
                    root={root}
                    onEdit={setEditing}
                    onDone={state.reload}
                  />
                ))}
              </Rows>
            )}
            <Button
              variant="outline"
              size="sm"
              className="mt-3 h-7"
              onClick={() => setEditing({ directory: "", description: "" })}
            >
              Nouveau skill
            </Button>
            {ownCommands.length > 0 && (
              <>
                <Section>Commandes ({ownCommands.length})</Section>
                <Rows>
                  {ownCommands.map((command) => (
                    <Row key={command.name} title={`/${command.name}`} sub={command.description} />
                  ))}
                </Rows>
              </>
            )}
          </>
        );
      }}
    </Async>
  );
}

// ─── MCP du projet ──────────────────────────────────────────────────────────

export function ProjectMcpPanel({ root }: { root: string }) {
  const state = useAsync(() => api<{ servers: McpServer[] }>("/api/mcp", { root }), [root]);
  const { byName, check } = useMcpStatus(root);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");

  return (
    <Async state={state}>
      {({ servers }) => {
        const own = servers.filter((server) => server.scope === "project");
        return (
          <>
            {own.length === 0 ? (
              <Empty icon={Plug}>Serveurs déclarés dans .mcp.json, partagés par l'équipe.</Empty>
            ) : (
              <Rows>
                {own.map((server) => (
                  <Row
                    key={server.name}
                    title={server.name}
                    sub={server.url ?? [server.command, ...(server.args ?? [])].join(" ")}
                    badges={
                      <>
                        <Badge variant="secondary">{server.transport}</Badge>
                        <McpHealth status={byName?.get(server.name)} />
                      </>
                    }
                    actions={
                      <DangerButton
                        label="retirer"
                        onConfirm={async () => {
                          await post("/api/mcp/remove", { root, name: server.name });
                          state.reload();
                        }}
                      />
                    }
                  />
                ))}
              </Rows>
            )}

            {open ? (
              <div className="mt-3 flex flex-col gap-2">
                <Label>Nom</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
                <Label>Cible</Label>
                <Input
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  placeholder="https://… ou une commande"
                />
                <div className="flex gap-2">
                  <ActionButton
                    variant="default"
                    onAction={async () => {
                      const value = target.trim();
                      const config = value.startsWith("http")
                        ? { type: "http", url: value }
                        : { command: value.split(/\s+/)[0], args: value.split(/\s+/).slice(1) };
                      await post("/api/mcp/save", { root, name, config });
                      setOpen(false);
                      setName("");
                      setTarget("");
                      state.reload();
                    }}
                  >
                    Ajouter
                  </ActionButton>
                  <ActionButton onAction={() => setOpen(false)}>Annuler</ActionButton>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" className="h-7" onClick={() => setOpen(true)}>
                  Ajouter un serveur
                </Button>
                {own.length > 0 && <ActionButton onAction={check}>Vérifier l'état</ActionButton>}
              </div>
            )}
          </>
        );
      }}
    </Async>
  );
}

// ─── Worktrees ──────────────────────────────────────────────────────────────

export function WorktreesPanel({ root }: { root: string }) {
  const state = useAsync(() => api<{ worktrees: Worktree[] }>("/api/worktrees", { root }), [root]);

  return (
    <Async state={state}>
      {({ worktrees }) =>
        worktrees.length === 0 ? (
          <Empty icon={GitBranch}>Ce dossier n'est pas un dépôt git.</Empty>
        ) : (
          <Rows>
            {worktrees.map((worktree) => (
              <Row
                key={worktree.path}
                title={worktree.branch ?? worktree.head?.slice(0, 8) ?? "?"}
                sub={[
                  worktree.ahead || worktree.behind ? `↑${worktree.ahead ?? 0} ↓${worktree.behind ?? 0}` : "",
                  worktree.sessions.length ? `${worktree.sessions.length} session(s)` : "",
                  worktree.path,
                ]
                  .filter(Boolean)
                  .join("  ·  ")}
                badges={
                  <>
                    {worktree.main && <Badge variant="secondary">principal</Badge>}
                    {worktree.detached && <Badge variant="outline">détaché</Badge>}
                    {worktree.locked !== undefined && <Badge variant="outline">verrouillé</Badge>}
                    {(worktree.dirty ?? 0) > 0 && (
                      <Badge variant="outline">{worktree.dirty} non commité(s)</Badge>
                    )}
                  </>
                }
                actions={
                  <>
                    <ActionButton onAction={() => openTerminal("shell", { cwd: worktree.path })}>
                      terminal ici
                    </ActionButton>
                    {!worktree.main && (
                      <DangerButton
                        label="retirer"
                        onConfirm={async () => {
                          await post("/api/worktrees/remove", { root, path: worktree.path });
                          state.reload();
                        }}
                      />
                    )}
                  </>
                }
              />
            ))}
          </Rows>
        )
      }
    </Async>
  );
}
