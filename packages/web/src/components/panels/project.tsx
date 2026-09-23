import { GitBranch, Link2, Package, Plug, Play, Sparkles } from "lucide-react";
import { useState } from "react";

import { ActionButton, Async, DangerButton, Empty, Row, Rows, Section, useAsync } from "@/components/common";
import { McpHealth, useMcpStatus } from "@/components/panels/mcp";
import { McpEditor, McpLibrary, serverTarget } from "@/components/panels/mcp-editor";
import { SkillEditor, SkillRow } from "@/components/panels/skills";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, post, shortName } from "@/lib/api";
import type { McpServer, ProjectLink, ProjectScripts, Skill, SlashCommand, Worktree } from "@/lib/types";
import { openTerminal, runScript } from "@/state/terminals";

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

/** Scripts d'un dossier, groupés par `package.json`, lancés avec son propre gestionnaire. */
function ScriptGroups({ project, prefix }: { project: ProjectScripts; prefix?: string }) {
  return (
    <>
      {project.sources
        .filter((source) => source.scripts.length > 0)
        .map((source) => (
          <div key={source.directory}>
            <Section>
              {prefix ? `${prefix} · ` : ""}
              {source.packageName ?? (source.relativePath || "racine")}
            </Section>
            <Rows>
              {source.scripts.map((script) => (
                <Row
                  key={script.name}
                  title={script.name}
                  sub={script.command}
                  actions={
                    <ActionButton
                      onAction={() =>
                        runScript(
                          script.name,
                          source.directory,
                          project.manager === "npm"
                            ? `npm run ${script.name}`
                            : `${project.manager} run ${script.name}`,
                        )
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
}

export function ScriptsPanel({ root }: { root: string }) {
  const state = useAsync(() => api<ProjectScripts>("/api/scripts", { root }), [root]);

  return (
    <Async state={state}>
      {(project) => {
        const own = project.sources.some((source) => source.scripts.length > 0);
        const linked = project.linked ?? [];
        if (!own && linked.length === 0) return <Empty icon={Package}>Aucun script dans ce projet.</Empty>;
        return (
          <>
            {own && (
              <>
                <p className="text-[11px] text-muted-foreground">
                  {project.manager}
                  {project.managerDetected ? "" : " (défaut, aucun lockfile)"}
                </p>
                <ScriptGroups project={project} />
              </>
            )}
            {linked.map((folder) => (
              <ScriptGroups
                key={folder.root}
                project={folder}
                prefix={`lié ${shortName(folder.root)} (${folder.manager})`}
              />
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
  // `null` : création ; un serveur : édition ; `undefined` : fermé. La clé
  // remonte l'éditeur à chaque ouverture, pour qu'il parte des bonnes valeurs.
  const [editing, setEditing] = useState<McpServer | null | undefined>(undefined);
  const [nonce, setNonce] = useState(0);
  const [browsing, setBrowsing] = useState(false);

  const openEditor = (server: McpServer | null) => {
    setNonce((value) => value + 1);
    setEditing(server);
  };

  return (
    <Async state={state}>
      {({ servers }) => {
        const own = servers.filter((server) => server.scope === "project");
        const linked = servers.filter((server) => server.scope === "linked");
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
                    sub={serverTarget(server)}
                    badges={
                      <>
                        <Badge variant="secondary">{server.transport}</Badge>
                        <McpHealth status={byName?.get(server.name)} />
                      </>
                    }
                    actions={
                      <>
                        <ActionButton variant="ghost" onAction={() => openEditor(server)}>
                          modifier
                        </ActionButton>
                        <DangerButton
                          label="retirer"
                          onConfirm={async () => {
                            await post("/api/mcp/remove", { root, name: server.name });
                            state.reload();
                          }}
                        />
                      </>
                    }
                  />
                ))}
              </Rows>
            )}

            {/* Un dossier lié n'apporte pas ses serveurs au projet : on les montre
                pour pouvoir les reprendre, pas comme s'ils s'appliquaient. */}
            {linked.length > 0 && (
              <>
                <Section>Dossiers liés</Section>
                <Rows>
                  {linked.map((server) => (
                    <Row
                      key={`${server.source}|${server.name}`}
                      title={server.name}
                      sub={`${shortName(server.source ?? "")}  ·  ${serverTarget(server)}`}
                      badges={<Badge variant="secondary">{server.transport}</Badge>}
                      actions={
                        own.some((mine) => mine.name === server.name) ? undefined : (
                          <ActionButton
                            onAction={async () => {
                              await post("/api/mcp/copy", {
                                root,
                                name: server.name,
                                from: server.source,
                                scope: "project",
                              });
                              state.reload();
                            }}
                          >
                            copier ici
                          </ActionButton>
                        )
                      }
                    />
                  ))}
                </Rows>
              </>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" className="h-7" onClick={() => openEditor(null)}>
                Ajouter un serveur
              </Button>
              <Button variant="ghost" size="sm" className="h-7" onClick={() => setBrowsing(!browsing)}>
                {browsing ? "Masquer les autres projets" : "Reprendre d'un autre projet"}
              </Button>
              {own.length > 0 && <ActionButton onAction={check}>Vérifier l'état</ActionButton>}
            </div>
            {browsing && (
              <div className="mt-2 rounded-md border p-2">
                <McpLibrary root={root} onCopied={state.reload} />
              </div>
            )}

            {editing !== undefined && (
              <McpEditor
                key={nonce}
                root={root}
                {...(editing ? { server: editing } : {})}
                open
                onClose={() => setEditing(undefined)}
                onSaved={state.reload}
              />
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
