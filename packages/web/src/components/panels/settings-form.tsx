import { X } from "lucide-react";
import { useState, type ReactNode } from "react";

import { ActionButton, Section } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { post } from "@/lib/api";

type Json = Record<string, unknown>;
type Path = (string | number)[];

const DEFAULT = "__default__";
const MODELS = ["opus", "sonnet", "haiku", "fable", "opus[1m]", "sonnet[1m]"];
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const INTERFACES = ["fullscreen", "inline"];
const PERMISSION_MODES = ["default", "acceptEdits", "plan", "auto", "bypassPermissions"];
const HOOK_EVENTS = [
  "PreToolUse",
  "PostToolUse",
  "UserPromptSubmit",
  "Notification",
  "Stop",
  "SubagentStop",
  "PreCompact",
  "SessionStart",
  "SessionEnd",
];
/** Événements dont Claude Code ignore le `matcher` : en poser un ferait taire le hook. */
const WITHOUT_MATCHER = new Set(["UserPromptSubmit", "Stop", "SubagentStop", "SessionStart", "SessionEnd"]);

function read(value: Json, path: Path): unknown {
  let current: unknown = value;
  for (const segment of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string | number, unknown>)[segment];
  }
  return current;
}

const asString = (value: unknown): string => (typeof value === "string" ? value : "");
const asList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const asRecord = (value: unknown): Json =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};

/**
 * Formulaire de `settings.json`.
 *
 * Chaque champ s'écrit seul, par une édition chirurgicale : les clés que le
 * formulaire ne connaît pas, et la mise en forme du fichier, restent telles
 * quelles. Une valeur vidée retire sa clé plutôt que d'écrire une chaîne vide, que
 * Claude Code prendrait pour un réglage.
 */
export function SettingsForm({ value, onChanged }: { value: Json; onChanged: () => void }) {
  const [error, setError] = useState<string>();

  const write = async (path: Path, next: unknown) => {
    setError(undefined);
    try {
      // `undefined` n'existe pas en JSON : une clé absente du corps vaut retrait.
      await post("/api/settings/set", next === undefined ? { path } : { path, value: next });
      onChanged();
    } catch (caught) {
      setError((caught as Error).message);
    }
  };

  const text = (path: Path) => ({
    value: asString(read(value, path)),
    commit: (next: string) => write(path, next.trim() ? next.trim() : undefined),
  });

  return (
    <div className="flex flex-col gap-1 pb-3">
      {error && <p className="text-[11px] text-destructive">{error}</p>}

      <Section>Général</Section>
      <Field label="Modèle">
        <Choice options={MODELS} {...text(["model"])} />
      </Field>
      <Field label="Effort">
        <Choice options={EFFORTS} {...text(["effortLevel"])} />
      </Field>
      <Field label="Interface">
        <Choice options={INTERFACES} {...text(["tui"])} />
      </Field>
      <Field label="Langue">
        <TextField placeholder="ex. français" {...text(["language"])} />
      </Field>
      <Toggle
        label="Réflexion étendue toujours active"
        checked={read(value, ["alwaysThinkingEnabled"]) === true}
        onChange={(checked) => write(["alwaysThinkingEnabled"], checked ? true : undefined)}
      />
      <Toggle
        label="Co-Authored-By dans les commits"
        checked={read(value, ["includeCoAuthoredBy"]) !== false}
        // Vrai par défaut : seul le refus s'écrit.
        onChange={(checked) => write(["includeCoAuthoredBy"], checked ? undefined : false)}
      />
      <Field label="Purge des transcripts (jours)">
        <TextField
          placeholder="30"
          value={typeof read(value, ["cleanupPeriodDays"]) === "number" ? String(read(value, ["cleanupPeriodDays"])) : ""}
          commit={(next) => {
            const days = Number(next);
            return write(["cleanupPeriodDays"], next.trim() && Number.isInteger(days) && days > 0 ? days : undefined);
          }}
        />
      </Field>
      <Field label="Status line">
        <TextField placeholder="commande" {...text(["statusLine", "command"])} />
      </Field>

      <Section>Permissions</Section>
      <Field label="Mode par défaut">
        <Choice options={PERMISSION_MODES} {...text(["permissions", "defaultMode"])} />
      </Field>
      {(
        [
          ["allow", "Autorisées", "Bash(npm run:*)"],
          ["ask", "À confirmer", "Bash(git push:*)"],
          ["deny", "Refusées", "Read(./.env)"],
          ["additionalDirectories", "Dossiers supplémentaires", "C:\\chemin"],
        ] as const
      ).map(([key, label, placeholder]) => (
        <ListEditor
          key={key}
          label={label}
          placeholder={placeholder}
          items={asList(read(value, ["permissions", key]))}
          onChange={(items) => write(["permissions", key], items.length ? items : undefined)}
        />
      ))}

      <Section>Hooks</Section>
      <HooksEditor hooks={asRecord(read(value, ["hooks"]))} write={write} />

      <Section>Variables d'environnement</Section>
      <DictEditor
        items={Object.fromEntries(Object.entries(asRecord(read(value, ["env"]))).map(([k, v]) => [k, asString(v)]))}
        onSet={(key, next) => write(["env", key], next)}
      />

      {Object.keys(asRecord(read(value, ["enabledPlugins"]))).length > 0 && (
        <>
          <Section>Plugins</Section>
          {Object.entries(asRecord(read(value, ["enabledPlugins"]))).map(([plugin, enabled]) => (
            <Toggle
              key={plugin}
              label={plugin}
              checked={enabled === true}
              onChange={(checked) => write(["enabledPlugins", plugin], checked)}
            />
          ))}
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid grid-cols-[9rem_1fr] items-center gap-2 py-0.5 text-[12px]">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/** Texte enregistré en quittant le champ, ou sur Entrée : pas à chaque frappe. */
function TextField({
  value,
  commit,
  placeholder,
}: {
  value: string;
  commit: (next: string) => Promise<void> | void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState<string>();
  const shown = draft ?? value;
  const flush = () => {
    if (draft !== undefined && draft !== value) void commit(draft);
    setDraft(undefined);
  };
  return (
    <Input
      className="h-7 text-[12px]"
      value={shown}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={flush}
      onKeyDown={(event) => event.key === "Enter" && flush()}
    />
  );
}

/** Liste de choix, avec « par défaut » pour retirer la clé ; une valeur inconnue reste proposée. */
function Choice({
  options,
  value,
  commit,
}: {
  options: string[];
  value: string;
  commit: (next: string) => Promise<void> | void;
}) {
  const all = value && !options.includes(value) ? [value, ...options] : options;
  return (
    <Select value={value || DEFAULT} onValueChange={(next) => void commit(next === DEFAULT ? "" : next)}>
      <SelectTrigger className="h-7 w-full text-[12px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={DEFAULT}>par défaut</SelectItem>
        {all.map((option) => (
          <SelectItem key={option} value={option}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 py-0.5 text-[12px]">
      <input
        type="checkbox"
        className="accent-primary"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}

function ListEditor({
  label,
  items,
  placeholder,
  onChange,
}: {
  label: string;
  items: string[];
  placeholder: string;
  onChange: (items: string[]) => Promise<void> | void;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const item = draft.trim();
    if (!item || items.includes(item)) return;
    void onChange([...items, item]);
    setDraft("");
  };
  return (
    <details className="py-0.5 text-[12px]">
      <summary className="cursor-pointer text-muted-foreground">
        {label} ({items.length})
      </summary>
      <ul className="m-0 list-none py-1 pl-3">
        {items.map((item) => (
          <li key={item} className="group flex items-center gap-1 py-0.5 font-mono text-[11px]">
            <span className="min-w-0 flex-1 break-all">{item}</span>
            <Button
              variant="ghost"
              size="icon"
              className="size-5 opacity-50 hover:opacity-100"
              title="retirer"
              onClick={() => void onChange(items.filter((other) => other !== item))}
            >
              <X className="size-3" />
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex gap-1 pl-3">
        <Input
          className="h-7 font-mono text-[11px]"
          value={draft}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && add()}
        />
        <ActionButton onAction={add}>ajouter</ActionButton>
      </div>
    </details>
  );
}

function DictEditor({
  items,
  onSet,
}: {
  items: Record<string, string>;
  onSet: (key: string, value: string | undefined) => Promise<void> | void;
}) {
  const [key, setKey] = useState("");
  const [draft, setDraft] = useState("");
  return (
    <div className="flex flex-col gap-1 text-[12px]">
      {Object.entries(items).map(([name, current]) => (
        <div key={name} className="grid grid-cols-[9rem_1fr_auto] items-center gap-2">
          <span className="truncate font-mono text-[11px]" title={name}>
            {name}
          </span>
          <TextField value={current} commit={(next) => onSet(name, next)} />
          <Button variant="ghost" size="icon" className="size-6" title="retirer" onClick={() => void onSet(name, undefined)}>
            <X className="size-3" />
          </Button>
        </div>
      ))}
      <div className="grid grid-cols-[9rem_1fr_auto] items-center gap-2">
        <Input className="h-7 font-mono text-[11px]" value={key} placeholder="NOM" onChange={(e) => setKey(e.target.value)} />
        <Input className="h-7 text-[12px]" value={draft} placeholder="valeur" onChange={(e) => setDraft(e.target.value)} />
        <ActionButton
          onAction={async () => {
            if (!key.trim()) return;
            await onSet(key.trim(), draft);
            setKey("");
            setDraft("");
          }}
        >
          ajouter
        </ActionButton>
      </div>
    </div>
  );
}

interface HookRow {
  event: string;
  entry: number;
  hook: number;
  matcher: string;
  command: string;
}

/**
 * Hooks de `settings.json`, à plat : un événement, un filtre, une commande.
 *
 * Retirer un hook réécrit la liste de son événement ; le reste de l'arbre, y
 * compris les hooks posés par claude-ide pour ses notifications, ne bouge pas.
 */
function HooksEditor({ hooks, write }: { hooks: Json; write: (path: Path, value: unknown) => Promise<void> }) {
  const [event, setEvent] = useState("PreToolUse");
  const [matcher, setMatcher] = useState("");
  const [command, setCommand] = useState("");

  const rows: HookRow[] = [];
  for (const [name, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) continue;
    entries.forEach((entry: unknown, entryIndex) => {
      const record = asRecord(entry);
      const list = Array.isArray(record["hooks"]) ? record["hooks"] : [];
      list.forEach((hook: unknown, hookIndex) => {
        rows.push({
          event: name,
          entry: entryIndex,
          hook: hookIndex,
          matcher: asString(record["matcher"]),
          command: asString(asRecord(hook)["command"]),
        });
      });
    });
  }

  const remove = async (row: HookRow) => {
    const entries = (hooks[row.event] as unknown[]).map((entry, index) => {
      if (index !== row.entry) return entry;
      const record = asRecord(entry);
      const list = (record["hooks"] as unknown[]).filter((_hook, hookIndex) => hookIndex !== row.hook);
      return list.length ? { ...record, hooks: list } : undefined;
    });
    const kept = entries.filter((entry) => entry !== undefined);
    if (kept.length) {
      await write(["hooks", row.event], kept);
      return;
    }
    // Le dernier hook parti, la clé `hooks` part avec lui plutôt que de rester en
    // objet vide.
    const others = Object.entries(hooks).some(
      ([name, list]) => name !== row.event && Array.isArray(list) && list.length > 0,
    );
    await write(others ? ["hooks", row.event] : ["hooks"], undefined);
  };

  return (
    <div className="flex flex-col gap-1 text-[12px]">
      {rows.length === 0 && <p className="py-1 text-muted-foreground">Aucun hook.</p>}
      {rows.map((row) => (
        <div key={`${row.event}|${row.entry}|${row.hook}`} className="rounded border px-2 py-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{row.event}</span>
            {row.matcher && <span className="font-mono text-[11px] text-muted-foreground">{row.matcher}</span>}
            <span className="flex-1" />
            <Button variant="ghost" size="icon" className="size-5" title="retirer" onClick={() => void remove(row)}>
              <X className="size-3" />
            </Button>
          </div>
          <TextField
            value={row.command}
            commit={(next) => write(["hooks", row.event, row.entry, "hooks", row.hook, "command"], next)}
          />
        </div>
      ))}
      <div className="mt-1 grid grid-cols-[9rem_1fr] gap-1">
        <Select value={event} onValueChange={setEvent}>
          <SelectTrigger className="h-7 text-[12px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {HOOK_EVENTS.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          className="h-7 font-mono text-[11px]"
          value={matcher}
          disabled={WITHOUT_MATCHER.has(event)}
          placeholder={WITHOUT_MATCHER.has(event) ? "pas de filtre pour cet événement" : "filtre (ex. Bash)"}
          onChange={(e) => setMatcher(e.target.value)}
        />
        <Input
          className="col-span-2 h-7 font-mono text-[11px]"
          value={command}
          placeholder="commande"
          onChange={(e) => setCommand(e.target.value)}
        />
        <div className="col-span-2">
          <ActionButton
            onAction={async () => {
              if (!command.trim()) return;
              const existing = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
              const entry = {
                ...(!WITHOUT_MATCHER.has(event) && matcher.trim() ? { matcher: matcher.trim() } : {}),
                hooks: [{ type: "command", command: command.trim() }],
              };
              await write(["hooks", event], [...existing, entry]);
              setMatcher("");
              setCommand("");
            }}
          >
            ajouter un hook
          </ActionButton>
        </div>
      </div>
    </div>
  );
}
