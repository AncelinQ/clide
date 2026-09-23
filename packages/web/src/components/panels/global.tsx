import { Bell, Cpu, History, Plug, Sparkles } from "lucide-react";
import { useState } from "react";

import { ActionButton, Async, DangerButton, Empty, Row, Rows, Section, useAsync } from "@/components/common";
import { McpHealth, useMcpStatus } from "@/components/panels/mcp";
import { SkillEditor, SkillRow } from "@/components/panels/skills";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
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
                <SelectItem value="all">Tous les projets</SelectItem>
                <SelectItem value="project">Ce projet</SelectItem>
              </SelectContent>
            </Select>

            {shown.length === 0 ? (
              <Empty icon={History}>Aucune session.</Empty>
            ) : (
              <Rows>
                {shown.slice(0, 200).map((session) => (
                  <Row
                    key={session.sessionId}
                    selected={selectedSession?.sessionId === session.sessionId}
                    onClick={() => setState({ selectedSession: session, followLive: false })}
                    title={session.title ?? session.lastPrompt ?? session.sessionId.slice(0, 8)}
                    badges={session.prLinks.length > 0 && <Badge variant="outline">MR</Badge>}
                    sub={[
                      formatDate(session.lastActivityAt),
                      shortName(session.effectiveCwd ?? ""),
                      session.gitBranch,
                      `${session.fileCount} fichiers`,
                    ]
                      .filter(Boolean)
                      .join("  ·  ")}
                    actions={
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
                        reprendre
                      </ActionButton>
                    }
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

        return (
          <>
            <Section>Personnels</Section>
            {personal.length === 0 ? (
              <p className="py-2 text-muted-foreground">Aucun skill personnel.</p>
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
              Nouveau skill
            </Button>

            <Section>Commandes ({shown.length})</Section>
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
                <Section>{label}</Section>
                {own.length === 0 ? (
                  <p className="py-2 text-muted-foreground">Aucun.</p>
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
                            server.url ?? [server.command, ...(server.args ?? [])].join(" "),
                            keys.length ? `secrets masqués : ${keys.join(", ")}` : "",
                          ]
                            .filter(Boolean)
                            .join("  ·  ")}
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
              <Section>Connecteurs claude.ai</Section>
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
            <ActionButton onAction={check}>Vérifier l'état</ActionButton>
            <span className="text-[11px] text-muted-foreground">
              interroge chaque serveur, quelques secondes
            </span>
          </div>

          {/* Ces portées vivent dans ~/.claude.json, qui porte aussi l'état de
              chaque projet : elles se modifient par la CLI, pas d'ici. */}
          <p className="pb-3 text-[11px] text-muted-foreground">
            Ces portées se modifient par <code>claude mcp add|remove</code>.
          </p>
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
            Une sauvegarde de l'original est posée avant la première modification.
          </p>
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
              Enregistrer
            </ActionButton>
            <ActionButton
              onAction={() => {
                setDraft(null);
                state.reload();
              }}
            >
              Recharger
            </ActionButton>
          </div>
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
                ? "ce terminal"
                : node.link.kind === "inferred"
                  ? "lancé ailleurs"
                  : "enfant"}
            </Badge>
            <span>
              {node.name} · {node.pid}
            </span>
            {node.link.kind !== "orphan" && (
              // Révélé au survol de sa ligne : un bouton d'arrêt sur chaque
              // processus en permanence noie l'arbre.
              <span className="opacity-0 transition-opacity group-hover/process:opacity-100 focus-within:opacity-100 has-[[data-armed]]:opacity-100">
                <DangerButton
                  label="arrêter"
                  onConfirm={async () => {
                    await api("/api/processes/stop", { pid: node.pid }, { method: "POST" });
                    reload();
                  }}
                />
              </span>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground">{node.memoryMB} Mo</div>
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
          <Empty icon={Cpu}>Aucun processus Claude en cours.</Empty>
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
                  ? "hooks installés"
                  : status.kinds.length > 0
                    ? "installation partielle"
                    : "hooks absents"}
              </Badge>
              <span className="text-[11px] text-muted-foreground">
                {status.installed
                  ? "Claude Code signale permissions, attentes, fins de réponse et reprises."
                  : "Sans eux, aucun événement ne remonte."}
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
              {status.installed ? "Désinstaller" : "Installer les hooks"}
            </ActionButton>

            <Section>Reçus</Section>
            {all.length === 0 ? (
              <p className="py-2 text-muted-foreground">Aucun événement reçu.</p>
            ) : (
              <Rows>
                {all.slice(0, 60).map((item) => (
                  <Row
                    key={item.id}
                    title={item.message ?? NOTIFICATION_LABEL[item.kind]}
                    badges={
                      <Badge variant={item.kind === "permission" ? "default" : "outline"}>
                        {NOTIFICATION_LABEL[item.kind]}
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
