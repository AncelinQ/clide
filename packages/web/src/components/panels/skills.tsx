import { useState } from "react";

import { ActionButton, DangerButton, Row } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api, post } from "@/lib/api";
import type { Skill } from "@/lib/types";

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
  return (
    <Row
      title={skill.name}
      sub={skill.description}
      badges={
        <>
          <Badge variant="secondary">{skill.scope === "project" ? "projet" : "perso"}</Badge>
          <Badge variant="outline">{INVOCATION_LABEL[skill.invocation]}</Badge>
        </>
      }
      actions={
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
            éditer
          </ActionButton>
          <DangerButton
            label="supprimer"
            onConfirm={async () => {
              await post("/api/skills/remove", { scope: skill.scope, directory: skill.directory, ...scoped });
              onDone();
            }}
          />
        </>
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

  return (
    <div className="flex flex-col gap-2">
      <Label>Dossier</Label>
      <Input value={directory} onChange={(e) => setDirectory(e.target.value)} placeholder="revue-de-code" />
      <Label>Nom</Label>
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="celui de /nom" />
      <Label>Description</Label>
      <Input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="quand Claude doit s'en servir"
      />
      <Label>Invocation</Label>
      <Select value={invocation} onValueChange={(value) => setInvocation(value as Skill["invocation"])}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="auto-and-slash">automatique et /nom</SelectItem>
          <SelectItem value="manual-only">seulement /nom</SelectItem>
          <SelectItem value="auto-only">seulement automatique</SelectItem>
        </SelectContent>
      </Select>
      <Label>Contenu</Label>
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
            await post("/api/skills/save", {
              scope: skill.scope,
              directory,
              name,
              description,
              invocation,
              body,
              ...(skill.scope === "project" ? { root } : {}),
            });
            onDone();
          }}
        >
          Enregistrer
        </ActionButton>
        <ActionButton onAction={onDone}>Annuler</ActionButton>
      </div>
    </div>
  );
}
