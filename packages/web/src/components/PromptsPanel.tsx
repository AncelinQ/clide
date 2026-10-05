import { MessageSquarePlus, Pencil, Play, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Keys } from "@/components/CommandPalette";
import { useShortcutRecording } from "@/components/ShortcutsEditor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/i18n";
import { api, post } from "@/lib/api";
import { promptCommand, shadowedBy } from "@/lib/prompt-keys";
import { pushRecent } from "@/lib/suggestions";
import { SuggestionChips } from "@/components/SuggestionChips";
import { cachedPrompts, loadPrompts, onPromptsChange, promptKey, removePrompt, runPrompt, type SavedPrompt } from "@/state/prompts";
import { setState, useStore } from "@/state/store";
import { cn } from "cn";

type Draft = Omit<SavedPrompt, "id"> & { id?: string };

const EMPTY: Draft = { label: "", text: "", mode: "send", scope: "user" };

/** Les prompts connus, relus quand ils changent. */
export function usePrompts(): SavedPrompt[] {
  const [prompts, setPrompts] = useState(cachedPrompts());
  useEffect(() => onPromptsChange(() => setPrompts(cachedPrompts())), []);
  return prompts;
}

function PromptForm({ draft, root, onClose }: { draft: Draft; root: string; onClose: () => void }) {
  const [value, setValue] = useState(draft);
  const [error, setError] = useState<string>();
  const save = async () => {
    try {
      await post("/api/prompts/save", { prompt: value, root });
      await loadPrompts(root);
      onClose();
    } catch (caught) {
      setError((caught as Error).message);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{value.id ? t("Modifier le prompt") : t("Nouveau prompt")}</DialogTitle>
          <DialogDescription>
            {t("Variables : {sélection} (texte choisi dans l'éditeur), {fichier} (fichier ouvert), {branche}, {saisie} (demandée à l'envoi).")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Input value={value.label} onChange={(event) => setValue({ ...value, label: event.target.value })} placeholder={t("Nom : Brainstorm")} />
          <Textarea
            value={value.text}
            onChange={(event) => setValue({ ...value, text: event.target.value })}
            placeholder={t("/sc:brainstorm {saisie}")}
            spellCheck={false}
            className="min-h-24 font-mono text-[12px]"
          />
          <div className="flex flex-wrap gap-4 text-[12px]">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={value.mode === "send"} onChange={() => setValue({ ...value, mode: "send" })} />
              {t("Envoyer")}
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={value.mode === "insert"} onChange={() => setValue({ ...value, mode: "insert" })} />
              {t("Insérer, pour compléter avant d'envoyer")}
            </label>
          </div>
          {!value.id && (
            <div className="flex flex-wrap gap-4 text-[12px]">
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={value.scope === "user"} onChange={() => setValue({ ...value, scope: "user" })} />
                {t("Perso, dans tous les projets")}
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={value.scope === "project"} onChange={() => setValue({ ...value, scope: "project" })} />
                {t("Ce projet (.claude/clide-prompts.json, versionnable)")}
              </label>
            </div>
          )}
          {error && <p className="text-[12px] text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("Annuler")}
          </Button>
          <Button onClick={() => void save()}>{t("Enregistrer")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Les prompts qu'on envoie souvent à Claude, ceux du projet puis les siens, et
 * les commandes qu'on retape assez pour mériter d'être enregistrées.
 */
export function PromptsPanel({ root }: { root: string }) {
  const prompts = usePrompts();
  const [editing, setEditing] = useState<Draft>();
  const [notice, setNotice] = useState<string>();
  const [suggestions, setSuggestions] = useState<{ command: string; count: number }[]>([]);

  useEffect(() => {
    void loadPrompts(root);
    void api<{ suggestions: { command: string; count: number }[] }>("/api/prompts/suggestions", { root })
      .then((result) => setSuggestions(result.suggestions))
      .catch(() => setSuggestions([]));
  }, [root]);

  const run = async (prompt: SavedPrompt) => setNotice(await runPrompt(prompt));
  const remove = (prompt: SavedPrompt) => void removePrompt(prompt, root);
  const shortcuts = useStore((state) => state.shortcuts);
  const shadowed = shadowedBy(prompts, shortcuts);
  const keys = useShortcutRecording();

  /** La touche du prompt, ou de quoi lui en donner une ; un clic écoute la suivante. */
  const keyChip = (prompt: SavedPrompt) => {
    const id = promptCommand(prompt.id);
    const key = promptKey(prompt, shortcuts);
    const owner = shadowed[prompt.id];
    if (keys.recording === id) {
      return (
        <span className="shrink-0 self-center text-[11px] text-primary" data-prompt-key={prompt.id}>
          {t("tape la combinaison… (Échap : annuler, Suppr : aucun)")}
        </span>
      );
    }
    return (
      <button
        type="button"
        className={cn(
          "shrink-0 self-center rounded px-0.5 hover:bg-background",
          !key && "text-[11px] text-muted-foreground opacity-0 group-hover:opacity-100",
          owner && "opacity-50",
        )}
        title={
          owner
            ? t("Dans ce projet, cette touche lance « {label} ». Cliquer pour en changer.", { label: owner.label })
            : key
              ? t("Cliquer pour changer de touche")
              : t("Donner une touche à ce prompt")
        }
        onClick={() => {
          keys.setNotice(undefined);
          keys.record(id);
        }}
        data-prompt-key={prompt.id}
      >
        {key ? <Keys shortcut={key} /> : t("touche")}
      </button>
    );
  };

  const section = (title: string, items: SavedPrompt[]) =>
    items.length > 0 && (
      <div>
        <p className="py-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{title}</p>
        <ul className="m-0 grid list-none gap-1 p-0">
          {items.map((prompt) => (
            <li key={prompt.id} className="group flex items-start gap-2 rounded px-1 py-1 hover:bg-accent">
              <button type="button" className="min-w-0 flex-1 text-left" title={t("Envoyer à Claude")} onClick={() => void run(prompt)}>
                <span className="flex items-center gap-1.5 text-[12.5px]">
                  {prompt.label}
                  <Badge variant="secondary" className="px-1 py-0 text-[10px] font-normal">
                    {prompt.mode === "send" ? t("envoie") : t("insère")}
                  </Badge>
                </span>
                <span className="block truncate font-mono text-[11px] text-muted-foreground">{prompt.text}</span>
              </button>
              {keyChip(prompt)}
              <span className="flex shrink-0 opacity-0 group-hover:opacity-100">
                <Button variant="ghost" size="icon" className="size-6" title={t("Envoyer à Claude")} onClick={() => void run(prompt)}>
                  <Play className="size-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="size-6" title={t("Modifier")} onClick={() => setEditing(prompt)}>
                  <Pencil className="size-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="size-6" title={t("Supprimer")} onClick={() => remove(prompt)}>
                  <Trash2 className="size-3.5" />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      </div>
    );

  return (
    <div className="grid grid-cols-1 gap-3">
      <Button variant="outline" size="sm" className="justify-self-start" onClick={() => setEditing(EMPTY)}>
        <MessageSquarePlus className="size-3.5" />
        {t("Nouveau prompt")}
      </Button>
      {notice && <p className="text-[12px] text-amber-600 dark:text-amber-400">{notice}</p>}
      {keys.notice && <p className="text-[12px] text-amber-600 dark:text-amber-400">{keys.notice}</p>}
      {prompts.length === 0 && (
        <p className="text-[12px] text-muted-foreground">
          {t("Aucun prompt enregistré. Un prompt s'envoie d'un clic, par la palette (/) ou par un raccourci, dans l'onglet Claude du projet.")}
        </p>
      )}
      {prompts.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {t("Un prompt reçoit Ctrl+Maj+1 à 9 à sa création ; Ctrl+Maj+0 ouvre la liste. Un clic sur la touche d'un prompt la change.")}
        </p>
      )}
      {section(t("Ce projet"), prompts.filter((prompt) => prompt.scope === "project"))}
      {section(t("Perso"), prompts.filter((prompt) => prompt.scope === "user"))}
      {suggestions.length > 0 && (
        <div>
          <p className="py-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{t("Souvent tapées")}</p>
          <ul className="m-0 grid list-none gap-1 p-0">
            {suggestions.map((suggestion) => (
              <li key={suggestion.command} className="flex items-center gap-2 px-1 text-[12px]">
                <span className="min-w-0 flex-1 truncate font-mono">{suggestion.command}</span>
                <span className="text-[11px] text-muted-foreground">{t("{count} fois", { count: suggestion.count })}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[11px]"
                  onClick={() =>
                    setEditing({ label: suggestion.command.replace(/^\//, ""), text: `${suggestion.command} {saisie}`, mode: "insert", scope: "user" })
                  }
                >
                  {t("Enregistrer")}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {editing && <PromptForm draft={editing} root={root} onClose={() => setEditing(undefined)} />}
    </div>
  );
}

/** Dernières réponses données à `{saisie}`, par prompt : une commodité de ce navigateur, rien de plus. */
const ANSWERS_KEY = "clide.prompt-answers";

function readAnswers(): Record<string, string[]> {
  try {
    const value = JSON.parse(localStorage.getItem(ANSWERS_KEY) ?? "{}") as unknown;
    return typeof value === "object" && value !== null ? (value as Record<string, string[]>) : {};
  } catch {
    return {};
  }
}

function rememberAnswer(label: string, text: string): void {
  try {
    const all = readAnswers();
    localStorage.setItem(ANSWERS_KEY, JSON.stringify({ ...all, [label]: pushRecent(Array.isArray(all[label]) ? all[label] : [], text) }));
  } catch {
    // Mémoire du navigateur indisponible : la suggestion manquera, rien d'autre.
  }
}

/**
 * Demande la valeur de `{saisie}` quand un prompt enregistré en porte une. Pour
 * un prompt « insérer », un interrupteur à côté des boutons propose de l'envoyer
 * aussitôt plutôt que de le laisser à compléter dans le terminal ; son réglage
 * est retenu.
 * `data-takes-focus` garde le focus au champ quand le menu qui a lancé le prompt
 * se referme.
 */
export function PromptInputDialog() {
  const request = useStore((state) => state.promptInput);
  const sendAfterInput = useStore((state) => state.sendAfterInput);
  const [value, setValue] = useState("");
  const sends = request?.mode === "send" || sendAfterInput;
  useEffect(() => setValue(""), [request]);
  const past = request ? (readAnswers()[request.label] ?? []).filter((item) => typeof item === "string") : [];
  const answer = (text: string | undefined) => {
    if (request && text) rememberAnswer(request.label, text);
    request?.resolve(text);
    setState({ promptInput: null });
  };
  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && answer(undefined)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{request?.label}</DialogTitle>
          <DialogDescription>{t("Ce que le prompt doit porter à la place de {saisie}.")}</DialogDescription>
        </DialogHeader>
        <Textarea
          autoFocus
          data-takes-focus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="min-h-20 text-[12.5px]"
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (value.trim()) answer(value.trim());
            }
          }}
        />
        {!value.trim() && <SuggestionChips items={past} onPick={setValue} />}
        <DialogFooter className="sm:items-center">
          {request?.mode === "insert" && (
            <div className="flex items-center gap-2 sm:mr-auto" title={t("Sinon, le prompt est inséré dans l'onglet Claude, à compléter avant Entrée.")}>
              <Switch id="prompt-send-after-input" checked={sendAfterInput} onCheckedChange={(checked) => setState({ sendAfterInput: checked })} />
              <Label htmlFor="prompt-send-after-input" className="cursor-pointer text-[12.5px] font-normal">
                {t("Envoyer directement")}
              </Label>
            </div>
          )}
          <Button variant="ghost" onClick={() => answer(undefined)}>
            {t("Annuler")}
          </Button>
          <Button disabled={!value.trim()} onClick={() => answer(value.trim())}>
            {sends ? t("Envoyer") : t("Insérer")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
