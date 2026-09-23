import { Bell, Cpu, History, Plug, Sparkles } from "lucide-react";
import { useState } from "react";

import { ActionButton, Async, DangerButton, Empty, Row, Rows, Section, useAsync } from "@/components/common";
import { McpHealth, useMcpStatus } from "@/components/panels/mcp";
import { McpEditor, serverTarget } from "@/components/panels/mcp-editor";
import { formatSessionCost } from "@/components/panels/costs";
import { SessionRemovalDialog } from "@/components/panels/session-removal";
import { SettingsForm } from "@/components/panels/settings-form";
import { SkillEditor, SkillImport, SkillRow } from "@/components/panels/skills";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/i18n";
import { api, formatDate, formatTime, post, shortName } from "@/lib/api";
import type {
  ClaudeNotification,
  HooksStatus,
  McpServer,
  ProcessNode,
  SessionSummary,
  SettingsDocument,
  Skill,
  SlashCommand,
} from "@/lib/types";
import { getState, openProject, setState, useStore } from "@/state/store";
import { openTerminal } from "@/state/terminals";

// ─── History ────────────────────────────────────────────────────────────────

export function HistoryPanel({ filter }: { filter: string }) {
  const state = useAsync(() => api<{ sessions: SessionSummary[] }>("/api/sessions"), []);
  const [scope, setScope] = useState("all");
  const [removing, setRemoving] = useState<string>();
  const { activeRoot, selectedSession } = useStore((store) => store);

  return (
    <Async state={state}>
      {({ sessions }) => {
        const needle = filter.trim().toLowerCase();
        const root = activeRoot?.toLowerCase();
        const shown = sessions
          .filter((session) =>
            scope === "project" && root ? (session.effectiveCwd ?? "").toLowerCase().startsWith(root) : true,
          )
          .filter((session) =>
            needle
              ? `${session.title ?? ""} ${session.effectiveCwd ?? ""} ${session.gitBranch ?? ""}`
                  .toLowerCase()
                  .includes(needle)
              : true,
          );

        return (
          <>
            <Select value={scope} onValueChange={setScope}>
              <SelectTrigger className="mb-1 h-7 w-full text-[12px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("Tous les projets")}</SelectItem>
                <SelectItem value="project">{t("Ce projet")}</SelectItem>
              </SelectContent>
            </Select>

            {shown.length === 0 ? (
              <Empty icon={History}>{t("Aucune session.")}</Empty>
            ) : (
              <Rows>
                {shown.slice(0, 200).map((session) => (
                  <Row
                    key={session.sessionId}
                    selected={selectedSession?.sessionId === session.sessionId}
                    onClick={() => setState({ selectedSession: session, followLive: false })}
                    title={session.title ?? session.lastPrompt ?? session.sessionId.slice(0, 8)}
                    badges={
                      <>
                        {session.ticket && (
                          <Badge variant="secondary" className="font-mono">
                            {session.ticket}
                          </Badge>
                        )}
                        {session.prLinks.length > 0 && <Badge variant="outline">MR</Badge>}
                      </>
                    }
                    sub={[
                      formatDate(session.lastActivityAt),
                      shortName(session.effectiveCwd ?? ""),
                      session.gitBranch,
                      t("{count} fichiers", { count: session.fileCount }),
                      formatSessionCost(session.price),
                    ]
                      .filter(Boolean)
                      .join("  ·  ")}
                    actions={
                      <>
                      <ActionButton
                        onAction={() => {
                          // Reprendre est une action : elle ouvre le projet,
                          // contrairement à la simple sélection.
                          if (session.effectiveCwd) openProject(session.effectiveCwd);
                          openTerminal("claude", {
                            cwd: session.effectiveCwd,
                            command: `claude --resume ${session.sessionId}`,
                          });
                        }}
                      >
                        {t("reprendre")}
                      </ActionButton>
                      <ActionButton variant="ghost" onAction={() => setRemoving(session.sessionId)}>
                        {t("retirer")}
                      </ActionButton>
                      </>
                    }
                  />
                ))}
              </Rows>
            )}
            {removing && (
              <SessionRemovalDialog
                sessionId={removing}
                onClose={() => setRemoving(undefined)}
                onRemoved={() => {
                  if (selectedSession?.sessionId === removing) setState({ selectedSession: null });
                  state.reload();
                }}
              />
            )}
          </>
        );
      }}
    </Async>
  );
}

// ─── Skills personnels ──────────────────────────────────────────────────────

export function UserSkillsPanel({ filter }: { filter: string }) {
  const root = getState().activeRoot ?? "";
  const state = useAsync(
    () => api<{ skills: Skill[]; commands: SlashCommand[] }>("/api/skills", { root }),
    [root],
  );
  const [editing, setEditing] = useState<(Partial<Skill> & { body?: string }) | null>(null);

  if (editing) {
    return (
      <SkillEditor
        skill={{ ...editing, scope: "user" }}
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
        const match = (text: string) => (needle ? text.toLowerCase().includes(needle) : true);
        const personal = skills.filter(
          (skill) => skill.scope === "user" && match(`${skill.name} ${skill.description ?? ""}`),
        );
        const shown = commands.filter((command) => match(`${command.name} ${command.description ?? ""}`));
        const plugins = skills.filter(
          (skill) => skill.scope === "plugin" && match(`${skill.name} ${skill.description ?? ""}`),
        );

        return (
          <>
            <SkillImport scope="user" root={root} onDone={state.reload}>
              <Section>{t("Personnels")}</Section>
              {personal.length === 0 ? (
                <p className="py-2 text-muted-foreground">{t("Aucun skill personnel.")}</p>
              ) : (
                <Rows>
                  {personal.map((skill) => (
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
                className="mt-2 h-7"
                onClick={() => setEditing({ directory: "", description: "" })}
              >
                {t("Nouveau skill")}
              </Button>
            </SkillImport>

            {plugins.length > 0 && (
              <>
                <Section>Plugins ({plugins.length})</Section>
                <Rows>
                  {plugins.map((skill) => (
                    <SkillRow key={skill.path} skill={skill} root={root} onEdit={setEditing} onDone={state.reload} />
                  ))}
                </Rows>
              </>
            )}

            <Section>{t("Commandes ({count})", { count: shown.length })}</Section>
            <Rows>
              {shown.map((command) => (
                <Row key={command.name} title={`/${command.name}`} sub={command.description} />
              ))}
            </Rows>
          </>
        );
      }}
    </Async>
  );
}

// ─── MCP personnel ──────────────────────────────────────────────────────────

export function UserMcpPanel() {
  const root = getState().activeRoot ?? "";
  const state = useAsync(() => api<{ servers: McpServer[] }>("/api/mcp", { root }), [root]);
  const { byName, connectors, check } = useMcpStatus(root);
  const [creating, setCreating] = useState(0);

  return (
    <Async state={state}>
      {({ servers }) => (
        <>
          {(
            [
              ["user", "Personnels"],
              ["local", "Locaux à ce projet"],
            ] as const
          ).map(([scope, label]) => {
            const own = servers.filter((server) => server.scope === scope);
            return (
              <div key={scope}>
                <Section>{t(label)}</Section>
                {own.length === 0 ? (
                  <p className="py-2 text-muted-foreground">{t("Aucun.")}</p>
                ) : (
                  <Rows>
                    {own.map((server) => {
                      const keys = [...Object.keys(server.headers ?? {}), ...Object.keys(server.env ?? {})];
                      return (
                        <Row
                          key={server.name}
                          title={server.name}
                          badges={
                            <>
                              <Badge variant="secondary">{server.transport}</Badge>
                              <McpHealth status={byName?.get(server.name)} />
                            </>
                          }
                          sub={[
                            serverTarget(server),
                            keys.length ? t("secrets masqués : {keys}", { keys: keys.join(", ") }) : "",
                          ]
                            .filter(Boolean)
                            .join("  ·  ")}
                          actions={
                            <>
                              {root && (
                                <ActionButton
                                  variant="ghost"
                                  onAction={async () => {
                                    await post("/api/mcp/copy", { root, name: server.name, from: root, scope });
                                  }}
                                >
                                  {t("copier dans le projet")}
                                </ActionButton>
                              )}
                              <DangerButton
                                label={t("retirer")}
                                onConfirm={async () => {
                                  await post("/api/mcp/cli/remove", { root, scope, name: server.name });
                                  state.reload();
                                }}
                              />
                            </>
                          }
                        />
                      );
                    })}
                  </Rows>
                )}
              </div>
            );
          })}
          {/* Les connecteurs sont rattachés au compte, hors de toute
              configuration locale : ils n'existent ici qu'une fois l'état lu. */}
          {connectors && connectors.length > 0 && (
            <div>
              <Section>{t("Connecteurs claude.ai")}</Section>
              <Rows>
                {connectors.map((connector) => (
                  <Row
                    key={connector.name}
                    title={connector.name}
                    badges={<McpHealth status={connector} />}
                  />
                ))}
              </Rows>
            </div>
          )}

          <div className="flex items-center gap-2 py-3">
            <ActionButton onAction={check}>{t("Vérifier l'état")}</ActionButton>
            <span className="text-[11px] text-muted-foreground">
              {t("interroge chaque serveur, quelques secondes")}
            </span>
          </div>

          {/* Ces portées vivent dans ~/.claude.json, qui porte aussi l'état de
              chaque projet : l'écriture passe par la CLI, pas par ce fichier. */}
          <div className="flex items-center gap-2 pb-3">
            <Button variant="outline" size="sm" className="h-7" onClick={() => setCreating((value) => value + 1)}>
              {t("Ajouter un serveur")}
            </Button>
            <span className="text-[11px] text-muted-foreground">
              {t("par")} <code>claude mcp add-json</code>
            </span>
          </div>
          {creating > 0 && (
            <McpEditor
              key={creating}
              root={root}
              defaultScope="user"
              open
              onClose={() => setCreating(0)}
              onSaved={state.reload}
            />
          )}
        </>
      )}
    </Async>
  );
}

// ─── Réglages ───────────────────────────────────────────────────────────────

export function SettingsPanel() {
  const state = useAsync(() => api<SettingsDocument>("/api/settings"), []);
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <Async state={state}>
      {(document_) => (
        <>
          <p className="py-2 font-mono text-[11px] break-all text-muted-foreground">{document_.path}</p>
          <p className="pb-2 text-[11px] text-muted-foreground">
            {t("Une sauvegarde de l'original est posée avant la première modification.")}
          </p>
          <SettingsForm value={document_.value} onChanged={() => { setDraft(null); state.reload(); }} />
          <details>
            <summary className="cursor-pointer py-2 text-[12px] text-muted-foreground">{t("JSON brut")}</summary>
          <Textarea
            rows={18}
            className="font-mono text-[11px]"
            value={draft ?? document_.raw}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="mt-2 flex gap-2">
            <ActionButton
              variant="default"
              onAction={async () => {
                await post("/api/settings/replace", { raw: draft ?? document_.raw });
                setDraft(null);
                state.reload();
              }}
            >
              {t("Enregistrer")}
            </ActionButton>
            <ActionButton
              onAction={() => {
                setDraft(null);
                state.reload();
              }}
            >
              {t("Recharger")}
            </ActionButton>
          </div>
          </details>
        </>
      )}
    </Async>
  );
}

// ─── Processus ──────────────────────────────────────────────────────────────

function ProcessTree({ nodes, reload, root }: { nodes: ProcessNode[]; reload: () => void; root?: boolean }) {
  return (
    <ul className={root ? "m-0 list-none p-0" : "m-0 list-none border-l pl-3"}>
      {nodes.map((node) => (
        <li key={node.pid} className="py-1">
          <div className="group/process flex flex-wrap items-baseline gap-1.5">
            <Badge variant={node.link.kind === "owned" ? "default" : "outline"}>
              {node.link.kind === "owned"
                ? t("ce terminal")
                : node.link.kind === "inferred"
                  ? t("lancé ailleurs")
                  : t("enfant")}
            </Badge>
            <span>
              {node.name} · {node.pid}
            </span>
            {node.link.kind !== "orphan" && (
              // Révélé au survol de sa ligne : un bouton d'arrêt sur chaque
              // processus en permanence noie l'arbre.
              <span className="opacity-0 transition-opacity group-hover/process:opacity-100 focus-within:opacity-100 has-[[data-armed]]:opacity-100">
                <DangerButton
                  label={t("arrêter")}
                  onConfirm={async () => {
                    await api("/api/processes/stop", { pid: node.pid }, { method: "POST" });
                    reload();
                  }}
                />
              </span>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground">{t("{size} Mo", { size: node.memoryMB })}</div>
          {node.children.length > 0 && <ProcessTree nodes={node.children} reload={reload} />}
        </li>
      ))}
    </ul>
  );
}

export function ProcessesPanel() {
  const state = useAsync(() => api<{ tree: ProcessNode[] }>("/api/processes"), []);
  return (
    <Async state={state}>
      {({ tree }) =>
        tree.length === 0 ? (
          <Empty icon={Cpu}>{t("Aucun processus Claude en cours.")}</Empty>
        ) : (
          <ProcessTree nodes={tree} reload={state.reload} root />
        )
      }
    </Async>
  );
}

// ─── Notifications ──────────────────────────────────────────────────────────

const NOTIFICATION_LABEL: Record<string, string> = {
  permission: "permission demandée",
  idle: "en attente d'une réponse",
  stop: "réponse terminée",
  resume: "reprise",
  other: "événement",
};

const notificationLabel = (kind: string): string | undefined => {
  const label = NOTIFICATION_LABEL[kind];
  return label && t(label);
};

export function NotificationsPanel() {
  const live = useStore((store) => store.notifications);
  const state = useAsync(
    () => api<{ status: HooksStatus; recent: ClaudeNotification[] }>("/api/notifications"),
    [],
  );

  return (
    <Async state={state}>
      {({ status, recent }) => {
        const seen = new Set(live.map((item) => item.id));
        const all = [...live, ...recent.filter((item) => !seen.has(item.id))];
        return (
          <>
            <div className="flex flex-wrap items-center gap-2 py-2">
              <Badge variant={status.installed ? "default" : "outline"}>
                {status.installed
                  ? t("hooks installés")
                  : status.kinds.length > 0
                    ? t("installation partielle")
                    : t("hooks absents")}
              </Badge>
              <span className="text-[11px] text-muted-foreground">
                {status.installed
                  ? t("Claude Code signale permissions, attentes, fins de réponse et reprises.")
                  : t("Sans eux, aucun événement ne remonte.")}
              </span>
            </div>
            <ActionButton
              variant={status.installed ? "outline" : "default"}
              onAction={async () => {
                await post(
                  status.installed ? "/api/notifications/uninstall" : "/api/notifications/install",
                  {},
                );
                if (window.Notification && Notification.permission === "default") {
                  await Notification.requestPermission();
                }
                state.reload();
              }}
            >
              {status.installed ? t("Désinstaller") : t("Installer les hooks")}
            </ActionButton>

            <Section>{t("Reçus")}</Section>
            {all.length === 0 ? (
              <p className="py-2 text-muted-foreground">{t("Aucun événement reçu.")}</p>
            ) : (
              <Rows>
                {all.slice(0, 60).map((item) => (
                  <Row
                    key={item.id}
                    title={item.message ?? notificationLabel(item.kind)}
                    badges={
                      <Badge variant={item.kind === "permission" ? "default" : "outline"}>
                        {notificationLabel(item.kind)}
                      </Badge>
                    }
                    sub={[formatTime(item.receivedAt), shortName(item.cwd ?? "")].filter(Boolean).join("  ·  ")}
                  />
                ))}
              </Rows>
            )}
          </>
        );
      }}
    </Async>
  );
}

export const GLOBAL_TABS = [
  { id: "processes", icon: Cpu, label: "Process" },
  { id: "history", icon: History, label: "History" },
  { id: "skills", icon: Sparkles, label: "Skills" },
  { id: "mcp", icon: Plug, label: "MCP" },
  { id: "notifications", icon: Bell, label: "Alertes" },
] as const;
