import { useState } from "react";

import { ActionButton, Async, useAsync } from "@/components/common";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api, post, shortName } from "@/lib/api";
import type { McpServer } from "@/lib/types";

type Transport = McpServer["transport"];
type WritableScope = "project" | "local" | "user";

const SCOPE_LABEL: Record<WritableScope, string> = {
  project: "Projet · .mcp.json, partagé avec l'équipe",
  local: "Local · ce projet, privé",
  user: "Perso · tous les projets",
};

/** Découpe une ligne de commande en mots, guillemets compris : `npx -y "mon paquet"`. */
export function splitCommand(line: string): string[] {
  const words: string[] = [];
  for (const match of line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) words.push(match[1] ?? match[2] ?? match[3] ?? "");
  return words;
}

export function joinCommand(words: string[]): string {
  return words.map((word) => (/\s/.test(word) ? `"${word}"` : word)).join(" ");
}

/** Lignes `CLÉ<sep>valeur` en table ; les lignes sans séparateur sont ignorées. */
function parsePairs(text: string, separator: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const index = line.indexOf(separator);
    if (index <= 0) continue;
    out[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return out;
}

function formatPairs(record: Record<string, string> | undefined, separator: string): string {
  return Object.entries(record ?? {})
    .map(([key, value]) => `${key}${separator}${value}`)
    .join("\n");
}

/** Cible d'un serveur telle qu'on la taperait : son URL, ou sa commande et ses arguments. */
export function serverTarget(server: McpServer): string {
  return server.url ?? joinCommand([server.command ?? "", ...(server.args ?? [])]);
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/**
 * Création d'un serveur, ou modification d'un serveur du `.mcp.json` du projet.
 *
 * Les secrets arrivent masqués : laisser un `***` en place garde la valeur
 * d'origine, que le serveur remet à l'écriture. Rien ne l'expose ici.
 *
 * Les portées `local` et `user` passent par `claude mcp add-json` : elles vivent
 * dans `~/.claude.json`, qu'on ne réécrit pas. Elles ne se modifient pas ici — la
 * CLI n'édite pas, elle ajoute et retire.
 */
export function McpEditor({
  root,
  server,
  defaultScope = "project",
  open,
  onClose,
  onSaved,
}: {
  root: string;
  server?: McpServer;
  defaultScope?: WritableScope;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = server !== undefined;
  const [scope, setScope] = useState<WritableScope>(defaultScope);
  const [name, setName] = useState(server?.name ?? "");
  const [transport, setTransport] = useState<Transport>(server?.transport ?? "stdio");
  const [command, setCommand] = useState(
    server?.command ? joinCommand([server.command, ...(server.args ?? [])]) : "",
  );
  const [url, setUrl] = useState(server?.url ?? "");
  const [headers, setHeaders] = useState(formatPairs(server?.headers, ": "));
  const [env, setEnv] = useState(formatPairs(server?.env, "="));
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const valid =
    NAME.test(name) && (transport === "stdio" ? splitCommand(command).length > 0 : /^https?:\/\//.test(url));

  const save = async () => {
    const envValues = parsePairs(env, "=");
    const headerValues = parsePairs(headers, ":");
    const [executable, ...args] = splitCommand(command);
    const config: Record<string, unknown> =
      transport === "stdio"
        ? { command: executable, ...(args.length ? { args } : {}) }
        : { type: transport, url: url.trim(), ...(Object.keys(headerValues).length ? { headers: headerValues } : {}) };
    if (Object.keys(envValues).length) config["env"] = envValues;

    setBusy(true);
    setError(undefined);
    try {
      if (editing || scope === "project") await post("/api/mcp/save", { root, name, config });
      else await post("/api/mcp/cli/add", { root, scope, name, config });
      onSaved();
      onClose();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Modifier le serveur MCP" : "Nouveau serveur MCP"}</DialogTitle>
          <DialogDescription>
            {editing ? "Dans le .mcp.json du projet, partagé avec l'équipe." : SCOPE_LABEL[scope]}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="mcp-name">Nom</Label>
            <Input
              id="mcp-name"
              value={name}
              disabled={editing}
              placeholder="browsermcp"
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          {!editing && (
            <div className="grid gap-1.5">
              <Label>Portée</Label>
              <Select value={scope} onValueChange={(value) => setScope(value as WritableScope)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(SCOPE_LABEL) as WritableScope[]).map((value) => (
                    <SelectItem key={value} value={value}>
                      {SCOPE_LABEL[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid gap-1.5">
            <Label>Transport</Label>
            <Select value={transport} onValueChange={(value) => setTransport(value as Transport)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stdio">Commande (stdio)</SelectItem>
                <SelectItem value="http">HTTP</SelectItem>
                <SelectItem value="sse">SSE</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {transport === "stdio" ? (
            <div className="grid gap-1.5">
              <Label htmlFor="mcp-command">Commande</Label>
              <Input
                id="mcp-command"
                className="font-mono text-[12px]"
                value={command}
                placeholder="npx @browsermcp/mcp@latest"
                onChange={(event) => setCommand(event.target.value)}
              />
            </div>
          ) : (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="mcp-url">URL</Label>
                <Input
                  id="mcp-url"
                  className="font-mono text-[12px]"
                  value={url}
                  placeholder="https://…/mcp"
                  onChange={(event) => setUrl(event.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="mcp-headers">En-têtes</Label>
                <Textarea
                  id="mcp-headers"
                  className="min-h-14 font-mono text-[12px]"
                  value={headers}
                  placeholder="Authorization: Bearer … (un par ligne)"
                  onChange={(event) => setHeaders(event.target.value)}
                />
              </div>
            </>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="mcp-env">Environnement</Label>
            <Textarea
              id="mcp-env"
              className="min-h-14 font-mono text-[12px]"
              value={env}
              placeholder="CLÉ=valeur (une par ligne)"
              onChange={(event) => setEnv(event.target.value)}
            />
            {server?.redacted && (
              <p className="text-[11px] text-muted-foreground">
                *** : valeur d'origine gardée telle quelle. La remplacer la change.
              </p>
            )}
          </div>
          {error && <p className="text-[12px] text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button disabled={!valid || busy} onClick={() => void save()}>
            {editing ? "Enregistrer" : "Ajouter"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Serveurs déjà configurés dans d'autres projets, à reprendre ici.
 *
 * La copie se fait côté serveur, secrets compris : la page ne les voit jamais.
 */
export function McpLibrary({ root, onCopied }: { root: string; onCopied: () => void }) {
  const state = useAsync(() => api<{ servers: McpServer[] }>("/api/mcp/library", { root }), [root]);
  return (
    <Async state={state}>
      {({ servers }) =>
        servers.length === 0 ? (
          <p className="py-1 text-[11px] text-muted-foreground">Aucun serveur dans tes autres projets.</p>
        ) : (
          <ul className="m-0 grid max-h-48 list-none gap-0.5 overflow-auto p-0">
            {servers.map((server) => (
              <li key={`${server.source}|${server.name}`} className="flex items-center gap-2 py-0.5">
                <span className="min-w-0 flex-1 truncate" title={server.source}>
                  {server.name}
                  <span className="ml-1.5 text-[11px] text-muted-foreground">{shortName(server.source ?? "")}</span>
                </span>
                <ActionButton
                  onAction={async () => {
                    await post("/api/mcp/copy", { root, name: server.name, from: server.source, scope: "project" });
                    onCopied();
                  }}
                >
                  reprendre
                </ActionButton>
              </li>
            ))}
          </ul>
        )
      }
    </Async>
  );
}
