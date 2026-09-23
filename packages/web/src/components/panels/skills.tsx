import { useState, type DragEvent, type ReactNode } from "react";

import { ActionButton, DangerButton, Row } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/i18n";
import { api, post } from "@/lib/api";
import type { Skill } from "@/lib/types";
import { useStore } from "@/state/store";
import { claudeTabFor, sendToClaude } from "@/state/terminals";

const INVOCATION_LABEL: Record<Skill["invocation"], string> = {
  "auto-and-slash": "auto + /",
  "manual-only": "/ seulement",
  "auto-only": "auto seulement",
};

/** Retire l'en-tête : le formulaire l'édite par ses champs, pas par le texte. */
function stripFrontmatter(raw: string): string {
  if (!raw.startsWith("---")) return raw;
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return raw;
  return raw.slice(raw.indexOf("\n", end + 1) + 1).replace(/^\n+/, "");
}

export function SkillRow({
  skill,
  root,
  onEdit,
  onDone,
}: {
  skill: Skill;
  root: string;
  onEdit: (skill: Partial<Skill> & { body?: string }) => void;
  onDone: () => void;
}) {
  const scoped = skill.scope === "project" ? { root } : {};
  const SCOPE_LABEL = { project: "projet", user: "perso", plugin: "plugin" } as const;
  return (
    <Row
      title={skill.name}
      sub={skill.description}
      badges={
        <>
          <Badge variant="secondary">{t(SCOPE_LABEL[skill.scope])}</Badge>
          <Badge variant="outline">{t(INVOCATION_LABEL[skill.invocation])}</Badge>
        </>
      }
      actions={
        skill.scope === "plugin" ? undefined : (
          <>
          <ActionButton
            onAction={async () => {
              const { raw } = await api<{ raw: string }>("/api/skill", {
                scope: skill.scope,
                directory: skill.directory,
                ...scoped,
              });
              onEdit({ ...skill, body: stripFrontmatter(raw) });
            }}
          >
            {t("éditer")}
          </ActionButton>
          {/* Promouvoir un skill de projet en skill perso, ou l'inverse. Vers le
              projet, il en faut un d'ouvert. */}
          {(skill.scope === "project" || root) && (
            <ActionButton
              variant="ghost"
              onAction={async () => {
                await post("/api/skills/copy", {
                  scope: skill.scope,
                  to: skill.scope === "project" ? "user" : "project",
                  directory: skill.directory,
                  ...(root ? { root } : {}),
                });
                onDone();
              }}
            >
              {skill.scope === "project" ? t("vers perso") : t("vers projet")}
            </ActionButton>
          )}
          <DangerButton
            label={t("supprimer")}
            onConfirm={async () => {
              await post("/api/skills/remove", { scope: skill.scope, directory: skill.directory, ...scoped });
              onDone();
            }}
          />
          </>
        )
      }
    />
  );
}

export function SkillEditor({
  skill,
  root,
  onDone,
}: {
  skill: Partial<Skill> & { body?: string; scope: Skill["scope"] };
  root: string;
  onDone: () => void;
}) {
  const [directory, setDirectory] = useState(skill.directory ?? "");
  const [name, setName] = useState(skill.name ?? "");
  const [description, setDescription] = useState(skill.description ?? "");
  const [invocation, setInvocation] = useState<Skill["invocation"]>(skill.invocation ?? "auto-and-slash");
  const [body, setBody] = useState(skill.body ?? "");
  const creating = !skill.directory;
  const claudeTab = useStore((state) => claudeTabFor(state.activeRoot));

  const save = (content: string) =>
    post<{ skill: Skill }>("/api/skills/save", {
      scope: skill.scope,
      directory,
      name,
      description,
      invocation,
      body: content,
      ...(skill.scope === "project" ? { root } : {}),
    });

  return (
    <div className="flex flex-col gap-2">
      <Label>{t("Dossier")}</Label>
      <Input value={directory} onChange={(e) => setDirectory(e.target.value)} placeholder={t("revue-de-code")} />
      <Label>{t("Nom")}</Label>
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("celui de /nom")} />
      <Label>Description</Label>
      <Input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={t("quand Claude doit s'en servir")}
      />
      <Label>Invocation</Label>
      <Select value={invocation} onValueChange={(value) => setInvocation(value as Skill["invocation"])}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="auto-and-slash">{t("automatique et /nom")}</SelectItem>
          <SelectItem value="manual-only">{t("seulement /nom")}</SelectItem>
          <SelectItem value="auto-only">{t("seulement automatique")}</SelectItem>
        </SelectContent>
      </Select>
      <Label>{t("Contenu")}</Label>
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={10}
        className="font-mono text-[11px]"
      />
      <div className="flex gap-2">
        <ActionButton
          variant="default"
          onAction={async () => {
            await save(body);
            onDone();
          }}
        >
          {t("Enregistrer")}
        </ActionButton>
        {/* Le squelette est écrit d'abord : Claude reçoit un fichier existant à
            compléter, avec l'en-tête voulu, plutôt qu'un emplacement à deviner. */}
        {creating && (
          <ActionButton
            onAction={async () => {
              if (!description.trim()) throw new Error(t("décris d'abord ce que le skill doit faire"));
              if (!claudeTab) throw new Error(t("ouvre un onglet Claude pour lui confier la rédaction"));
              const { skill: written } = await save(
                body.trim() || "<!-- Instructions pour Claude : quand utiliser ce skill, étapes, contraintes. -->\n",
              );
              sendToClaude(
                `Rédige le skill Claude Code ${written.path} : ${description.trim()}. Garde le frontmatter ` +
                  "name/description, écris des instructions précises et actionnables (quand l'utiliser, étapes, " +
                  "contraintes), en français.",
              );
              onDone();
            }}
          >
            {t("Rédiger avec Claude")}
          </ActionButton>
        )}
        <ActionButton onAction={onDone}>{t("Annuler")}</ActionButton>
      </div>
    </div>
  );
}

type WriteScope = "user" | "project";

/**
 * Importe les fichiers déposés.
 *
 * Sous Electron, le chemin est connu : un dossier de skill s'importe entier, avec
 * ses fichiers voisins. Un navigateur ne livre que le contenu d'un fichier, jamais
 * son chemin ni un dossier : seuls les `.md` y passent, par leur texte.
 */
async function importDropped(files: File[], scope: WriteScope, root: string): Promise<void> {
  const target = { scope, ...(scope === "project" ? { root } : {}) };
  const desktop = window.claudeIde;
  for (const file of files) {
    const path = desktop?.pathForFile(file);
    if (path) {
      await post("/api/skills/import", { ...target, path });
      continue;
    }
    if (!file.name.toLowerCase().endsWith(".md")) {
      throw new Error(t("{file} : seul un .md s'importe depuis un navigateur", { file: file.name }));
    }
    await post("/api/skills/import-text", { ...target, name: file.name.replace(/\.md$/i, ""), text: await file.text() });
  }
}

/**
 * Zone d'import des skills : dépôt de fichiers sur tout le panneau, et un chemin à
 * saisir pour ce qu'on ne peut pas déposer.
 */
export function SkillImport({
  scope,
  root,
  onDone,
  children,
}: {
  scope: WriteScope;
  root: string;
  onDone: () => void;
  children: ReactNode;
}) {
  const [over, setOver] = useState(false);
  const [path, setPath] = useState("");
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setError(undefined);
    try {
      await action();
      onDone();
    } catch (caught) {
      setError((caught as Error).message);
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    const files = [...event.dataTransfer.files];
    setOver(false);
    if (files.length === 0) return;
    event.preventDefault();
    void run(() => importDropped(files, scope, root));
  };

  return (
    <div
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={over ? "rounded-md outline-2 outline-dashed outline-primary" : undefined}
    >
      {children}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" className="h-7" onClick={() => setOpen(!open)}>
          {t("Importer…")}
        </Button>
        <span className="text-[11px] text-muted-foreground">{t("ou dépose un .md sur le panneau")}</span>
      </div>
      {open && (
        <div className="mt-1 flex gap-2">
          <Input
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder={t("chemin d'un .md ou d'un dossier de skill")}
            className="h-7 font-mono text-[11px]"
          />
          <ActionButton
            onAction={() =>
              run(async () => {
                await post("/api/skills/import", { scope, path: path.trim(), ...(scope === "project" ? { root } : {}) });
                setPath("");
                setOpen(false);
              })
            }
          >
            {t("importer")}
          </ActionButton>
        </div>
      )}
      {error && <p className="mt-1 text-[11px] text-destructive">{error}</p>}
    </div>
  );
}
