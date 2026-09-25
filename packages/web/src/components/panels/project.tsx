import { CloudDownload, GitBranch, Link2, MoreHorizontal, Package, Plug, Play, Sparkles } from "lucide-react";
import { useState } from "react";

import { ActionButton, Async, DangerButton, Empty, FoldSection, Row, Rows, Section, useAsync } from "@/components/common";
import { BranchDialog } from "@/components/BranchDialog";
import { FolderInput } from "@/components/FolderInput";
import { useGitStatus } from "@/components/GitChip";
import { pullRepositories, usePullRunning } from "@/components/GitSync";
import { McpHealth, useMcpStatus } from "@/components/panels/mcp";
import { McpEditor, McpLibrary, serverTarget } from "@/components/panels/mcp-editor";
import { SkillEditor, SkillImport, SkillRow } from "@/components/panels/skills";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { t } from "@/i18n";
import { api, post, shortName } from "@/lib/api";
import type { McpServer, ProjectLink, ProjectScripts, Skill, SlashCommand, Worktree } from "@/lib/types";
import { openProject } from "@/state/store";
import { openTerminal, runScript } from "@/state/terminals";

// ─── Dossiers liés ──────────────────────────────────────────────────────────

/**
 * Un dossier lié, avec sa branche : c'est ce qu'on vérifie avant de lancer Claude
 * sur plusieurs dépôts, et ce qu'on change le plus souvent.
 */
function LinkRow({
  link,
  onToggleReadOnly,
  onUnlink,
}: {
  link: ProjectLink;
  onToggleReadOnly: () => Promise<void>;
  onUnlink: () => Promise<void>;
}) {
  const [status, refresh] = useGitStatus(link.path);
  const [branching, setBranching] = useState(false);
  const pulling = usePullRunning();

  return (
    <>
      <Row
        title={link.path}
        sub={link.role}
        badges={
          <>
            {status && (
              <Badge variant="secondary" className="font-mono" title={t("branche courante")}>
                <GitBranch className="size-3" />
                {status.branch ?? status.head ?? "?"}
                {status.behind > 0 && ` ↓${status.behind}`}
                {status.ahead > 0 && ` ↑${status.ahead}`}
              </Badge>
            )}
            {link.readOnly && <Badge variant="outline">{t("lecture seule")}</Badge>}
          </>
        }
        actions={
          <>
            {status && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-6" title={t("Actions git")}>
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem
                    disabled={pulling}
                    onSelect={() =>
                      void pullRepositories([link.path], {
                        label: t("Mettre à jour {name}", { name: shortName(link.path) }),
                      }).then(refresh)
                    }
                  >
                    <CloudDownload /> {t("Mettre à jour (git pull)")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setBranching(true)}>
                    <GitBranch /> {t("Changer de branche…")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <ActionButton onAction={onToggleReadOnly}>
              {link.readOnly ? t("rendre modifiable") : t("lecture seule")}
            </ActionButton>
            <DangerButton label={t("délier")} onConfirm={onUnlink} />
          </>
        }
      />
      {branching && (
        <BranchDialog
          root={link.path}
          {...(status?.branch ? { current: status.branch } : {})}
          onClose={() => setBranching(false)}
          onDone={() => void refresh()}
        />
      )}
    </>
  );
}

export function LinksPanel({ root }: { root: string }) {
  const state = useAsync(() => api<{ links: ProjectLink[] }>("/api/links", { root }), [root]);
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState("");
  const [role, setRole] = useState("");
  const [readOnly, setReadOnly] = useState("non");
  const pulling = usePullRunning();

  const save = async (links: ProjectLink[]) => {
    await post("/api/links/save", { root, links });
    state.reload();
  };

  return (
    <Async state={state}>
      {({ links }) => (
        <>
          {links.length === 0 ? (
            <Empty icon={Link2}>{t("Les autres dépôts dont celui-ci dépend.")}</Empty>
          ) : (
            <>
              <Rows>
                {links.map((link) => (
                  <LinkRow
                    key={link.path}
                    link={link}
                    onToggleReadOnly={() =>
                      save(links.map((l) => (l.path === link.path ? { ...l, readOnly: !l.readOnly } : l)))
                    }
                    onUnlink={() => save(links.filter((l) => l.path !== link.path))}
                  />
                ))}
              </Rows>
              <Button
                variant="outline"
                size="sm"
                className="mt-2 h-7"
                disabled={pulling}
                onClick={() =>
                  void pullRepositories(
                    links.map((link) => link.path),
                    { label: t("Mettre à jour les dossiers liés") },
                  )
                }
              >
                <CloudDownload /> {t("Mettre à jour les dossiers liés")}
              </Button>
            </>
          )}

          {open ? (
            <div className="mt-3 flex flex-col gap-2">
              <Label>{t("Chemin")}</Label>
              <FolderInput value={path} onChange={setPath} title={t("Lier un dossier")} placeholder={t("C:\\Projets\\api")} />
              <Label>{t("Rôle")}</Label>
              <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder={t("api, design system…")} />
              <Label>{t("Accès")}</Label>
              <Select value={readOnly} onValueChange={setReadOnly}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="non">{t("Claude peut y écrire")}</SelectItem>
                  <SelectItem value="oui">{t("Lecture seule")}</SelectItem>
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
                  {t("Lier")}
                </ActionButton>
                <ActionButton onAction={() => setOpen(false)}>{t("Annuler")}</ActionButton>
              </div>
            </div>
          ) : (
            <Button variant="outline" size="sm" className="mt-3 h-7" onClick={() => setOpen(true)}>
              {t("Lier un dossier")}
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
              {source.packageName ?? (source.relativePath || t("racine"))}
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
                      <Play className="size-3" /> {t("lancer")}
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
        if (!own && linked.length === 0) return <Empty icon={Package}>{t("Aucun script dans ce projet.")}</Empty>;
        return (
          <>
            {own && (
              <>
                <p className="text-[11px] text-muted-foreground">
                  {project.managerDetected
                    ? project.manager
                    : t("{manager} (défaut, aucun lockfile)", { manager: project.manager })}
                </p>
                <ScriptGroups project={project} />
              </>
            )}
            {linked.map((folder) => (
              <ScriptGroups
                key={folder.root}
                project={folder}
                prefix={t("lié {name} ({manager})", { name: shortName(folder.root), manager: folder.manager })}
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
  const [filter, setFilter] = useState("");

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
        const needle = filter.trim().toLowerCase();
        const searching = needle.length > 0;
        const match = (text: string) => (searching ? text.toLowerCase().includes(needle) : true);
        const all = skills.filter((skill) => skill.scope === "project");
        const own = all.filter((skill) =>
          match(`${skill.name} ${skill.declaredName ?? ""} ${skill.description ?? ""}`),
        );
        const ownCommands = commands.filter(
          (command) => command.scope === "project" && match(`${command.name} ${command.description ?? ""}`),
        );
        return (
          <>
            {all.length + ownCommands.length > 0 && (
              <Input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder={t("Rechercher un skill ou une commande…")}
                spellCheck={false}
                className="mb-2 h-7 text-[12px]"
              />
            )}
            <SkillImport scope="project" root={root} onDone={state.reload}>
              {searching && own.length === 0 ? (
                <p className="py-2 text-muted-foreground">{t("Aucun skill du projet ne correspond.")}</p>
              ) : own.length === 0 ? (
                <Empty icon={Sparkles}>{t("Les skills vivent dans .claude/skills/<nom>/SKILL.md.")}</Empty>
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
                {t("Nouveau skill")}
              </Button>
            </SkillImport>
            {ownCommands.length > 0 && (
              <FoldSection id="project.commands" title={t("Commandes")} count={ownCommands.length} forceOpen={searching}>
                <Rows>
                  {ownCommands.map((command) => (
                    <Row key={command.name} title={`/${command.name}`} sub={command.description} />
                  ))}
                </Rows>
              </FoldSection>
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
              <Empty icon={Plug}>{t("Serveurs déclarés dans .mcp.json, partagés par l'équipe.")}</Empty>
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
                          {t("modifier")}
                        </ActionButton>
                        <DangerButton
                          label={t("retirer")}
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
                <Section>{t("Dossiers liés")}</Section>
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
                            {t("copier ici")}
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
                {t("Ajouter un serveur")}
              </Button>
              <Button variant="ghost" size="sm" className="h-7" onClick={() => setBrowsing(!browsing)}>
                {browsing ? t("Masquer les autres projets") : t("Reprendre d'un autre projet")}
              </Button>
              {own.length > 0 && <ActionButton onAction={check}>{t("Vérifier l'état")}</ActionButton>}
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
          <Empty icon={GitBranch}>{t("Ce dossier n'est pas un dépôt git.")}</Empty>
        ) : (
          <Rows>
            {worktrees.map((worktree) => (
              <Row
                key={worktree.path}
                title={worktree.branch ?? worktree.head?.slice(0, 8) ?? "?"}
                sub={[
                  worktree.ahead || worktree.behind ? `↑${worktree.ahead ?? 0} ↓${worktree.behind ?? 0}` : "",
                  worktree.sessions.length ? t("{count} session(s)", { count: worktree.sessions.length }) : "",
                  worktree.path,
                ]
                  .filter(Boolean)
                  .join("  ·  ")}
                badges={
                  <>
                    {worktree.main && <Badge variant="secondary">{t("principal")}</Badge>}
                    {worktree.detached && <Badge variant="outline">{t("détaché")}</Badge>}
                    {worktree.locked !== undefined && <Badge variant="outline">{t("verrouillé")}</Badge>}
                    {(worktree.dirty ?? 0) > 0 && (
                      <Badge variant="outline">{t("{count} non commité(s)", { count: worktree.dirty ?? 0 })}</Badge>
                    )}
                  </>
                }
                actions={
                  <>
                    <ActionButton onAction={() => openTerminal("shell", { cwd: worktree.path })}>
                      {t("terminal ici")}
                    </ActionButton>
                    <ActionButton onAction={() => openTerminal("claude", { cwd: worktree.path, command: "claude" })}>
                      {t("Claude ici")}
                    </ActionButton>
                    {!worktree.main && (
                      <ActionButton onAction={() => openProject(worktree.path)}>{t("ouvrir comme projet")}</ActionButton>
                    )}
                    {!worktree.main && (
                      <DangerButton
                        label={t("retirer")}
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
