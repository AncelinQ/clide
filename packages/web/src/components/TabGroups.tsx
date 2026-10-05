import { CircleAlert, Group as GroupIcon, Palette, Pencil, Sparkles, Ungroup, X } from "lucide-react";

import { NameInput } from "@/components/common";
import type { MenuItem } from "@/lib/menu";
import { ContextArea } from "@/components/Menu";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { t } from "@/i18n";
import { GROUP_COLORS, barItems, groupOf, groupTabId, type GroupColor, type TabGroup } from "@/lib/tab-groups";
import { cn } from "cn";
import { closeFile } from "@/state/editor";
import {
  addTabToGroup,
  barOrder,
  colorGroup,
  dissolveGroup,
  newGroupWith,
  removeTabFromGroup,
  renameGroup,
  toggleGroup,
} from "@/state/groups";
import { getState, setState, useStore } from "@/state/store";
import { closeTerminal, resize } from "@/state/terminals";

/**
 * Couleurs d'un groupe : le fond de son cadre, son étiquette, sa puce. Les classes
 * sont écrites en entier pour que Tailwind les trouve.
 */
export const GROUP_STYLE: Record<GroupColor, { label: string; tint: string; chip: string; dot: string }> = {
  grey: { label: "Gris", tint: "bg-zinc-500/15", chip: "bg-zinc-500/20 text-zinc-700 dark:text-zinc-200", dot: "bg-zinc-500" },
  blue: { label: "Bleu", tint: "bg-blue-500/15", chip: "bg-blue-500/20 text-blue-700 dark:text-blue-200", dot: "bg-blue-500" },
  red: { label: "Rouge", tint: "bg-red-500/15", chip: "bg-red-500/20 text-red-700 dark:text-red-200", dot: "bg-red-500" },
  yellow: { label: "Jaune", tint: "bg-amber-500/15", chip: "bg-amber-500/25 text-amber-800 dark:text-amber-200", dot: "bg-amber-500" },
  green: { label: "Vert", tint: "bg-emerald-500/15", chip: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-200", dot: "bg-emerald-500" },
  pink: { label: "Rose", tint: "bg-pink-500/15", chip: "bg-pink-500/20 text-pink-700 dark:text-pink-200", dot: "bg-pink-500" },
  purple: { label: "Violet", tint: "bg-violet-500/15", chip: "bg-violet-500/20 text-violet-700 dark:text-violet-200", dot: "bg-violet-500" },
  cyan: { label: "Cyan", tint: "bg-cyan-500/15", chip: "bg-cyan-500/20 text-cyan-700 dark:text-cyan-200", dot: "bg-cyan-500" },
  orange: { label: "Orange", tint: "bg-orange-500/15", chip: "bg-orange-500/20 text-orange-700 dark:text-orange-200", dot: "bg-orange-500" },
};

/** Nom d'un groupe dans un menu : le sien, ou sa couleur. */
function groupName(group: TabGroup): string {
  return group.name || t("Groupe sans nom ({color})", { color: t(GROUP_STYLE[group.color].label).toLowerCase() });
}

/** Ce que le menu d'un onglet, terminal ou fichier, propose sur les groupes. */
export function tabGroupItems(root: string | null, id: string): MenuItem[] {
  const current = getState();
  const project = current.projects.find((item) => item.root === root);
  if (!project) return [];
  const own = groupOf(project.tabGroups, id);
  const others = barItems(barOrder(current, root), project.tabGroups).flatMap((item) =>
    item.kind === "group" && item.group.id !== own?.id ? [item.group] : [],
  );
  return [
    { kind: "item", label: t("Nouveau groupe"), icon: GroupIcon, run: () => newGroupWith(root, id) },
    ...(others.length > 0
      ? [
          {
            kind: "submenu" as const,
            label: t("Ajouter au groupe"),
            items: others.map((group): MenuItem => ({ kind: "item", label: groupName(group), run: () => addTabToGroup(root, id, group.id) })),
          },
        ]
      : []),
    ...(own ? [{ kind: "item" as const, label: t("Retirer du groupe"), icon: Ungroup, run: () => removeTabFromGroup(root, id) }] : []),
  ];
}

/** Ce qui tourne dans un groupe qu'on va fermer : ce que la confirmation doit dire. */
export interface GroupContents {
  terminals: string[];
  files: string[];
  claude: number;
  commands: number;
  dirty: number;
}

export function contentsOf(root: string | null, group: string): GroupContents {
  const current = getState();
  const project = current.projects.find((item) => item.root === root);
  const ids = barOrder(current, root).filter((id) => project?.tabGroups.members[id] === group);
  const terminals = ids.filter((id) => current.terminals[id]);
  const files = ids.filter((id) => !current.terminals[id]);
  const infos = terminals.map((id) => current.terminals[id]?.info);
  return {
    terminals,
    files,
    claude: infos.filter((info) => info?.kind === "claude" && !info.exited).length,
    commands: infos.filter((info) => info?.kind === "shell" && info.state === "running").length,
    dirty: files.filter((path) => current.files[path]?.dirty).length,
  };
}

/** Ferme tout ce que le groupe montre dans la barre ; un fichier modifié reste ouvert. */
export function closeGroup(root: string | null, group: string): void {
  const { terminals, files } = contentsOf(root, group);
  for (const id of terminals) closeTerminal(id);
  for (const path of files) closeFile(path);
}

/** Fermer un groupe où quelque chose vit : un onglet Claude, une commande, un fichier modifié. */
export function CloseGroupDialog({ root, group, onDone }: { root: string | null; group: TabGroup | undefined; onDone: () => void }) {
  const contents = group ? contentsOf(root, group.id) : undefined;
  const lines = contents
    ? [
        contents.claude > 0 && t(contents.claude === 1 ? "{count} onglet Claude ouvert" : "{count} onglets Claude ouverts", { count: contents.claude }),
        contents.commands > 0 && t(contents.commands === 1 ? "{count} commande en cours" : "{count} commandes en cours", { count: contents.commands }),
        contents.dirty > 0 &&
          t(contents.dirty === 1 ? "{count} fichier modifié, qui restera ouvert" : "{count} fichiers modifiés, qui resteront ouverts", { count: contents.dirty }),
      ].filter((line): line is string => Boolean(line))
    : [];
  return (
    <Dialog open={!!group} onOpenChange={(open) => !open && onDone()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Fermer le groupe « {name} » ?", { name: group ? groupName(group) : "" })}</DialogTitle>
          <DialogDescription>{t("Le groupe porte encore :")}</DialogDescription>
        </DialogHeader>
        <ul className="m-0 list-disc pl-5 text-[12.5px]">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="ghost" onClick={onDone}>
            {t("Annuler")}
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (group) closeGroup(root, group.id);
              onDone();
            }}
          >
            {t("Fermer le groupe")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Rend le clavier au terminal montré quand le champ du nom disparaît sans le rendre. */
function endRename(): void {
  setState({ renamingTab: null });
  requestAnimationFrame(() => {
    const id = getState().activeTerminalId;
    if (document.activeElement === document.body && id) resize(id, { focus: true });
  });
}

/**
 * L'étiquette d'un groupe : son nom ou sa puce de couleur. Repliée, elle dit le
 * nombre de ses onglets et les signes de ses onglets Claude, comme la pastille du
 * projet. Un clic replie ou déplie, un double-clic renomme.
 */
export function GroupLabel({
  root,
  group,
  ids,
  active,
  onClose,
}: {
  root: string;
  group: TabGroup;
  /** Onglets du groupe présents dans la barre. */
  ids: string[];
  /** Le groupe est replié sur l'onglet qu'on regarde. */
  active: boolean;
  onClose: () => void;
}) {
  const renaming = useStore((state) => state.renamingTab === groupTabId(group.id));
  const claudeBusy = useStore((state) => state.claudeBusy);
  const attention = useStore((state) => state.attention);
  const busy = ids.some((id) => claudeBusy[id]);
  const asking = ids.some((id) => attention[id] === "permission");
  const done = ids.some((id) => attention[id] && attention[id] !== "permission");
  const style = GROUP_STYLE[group.color];

  const items = (): MenuItem[] => [
    { kind: "item", label: t("Renommer"), icon: Pencil, run: () => setState({ renamingTab: groupTabId(group.id) }) },
    {
      kind: "submenu",
      label: t("Couleur"),
      icon: Palette,
      items: GROUP_COLORS.map((color): MenuItem => ({
        kind: "item",
        label: t(GROUP_STYLE[color].label),
        checked: group.color === color,
        run: () => colorGroup(root, group.id, color),
      })),
    },
    { kind: "item", label: group.folded ? t("Déplier") : t("Replier"), run: () => toggleGroup(root, group.id) },
    { kind: "separator" },
    { kind: "item", label: t("Dégrouper"), icon: Ungroup, run: () => dissolveGroup(root, group.id) },
    { kind: "item", label: t("Fermer le groupe"), icon: X, danger: true, run: onClose },
  ];

  return (
    <ContextArea items={items}>
      <div
        onClick={(event) => {
          if (event.detail > 1) return;
          toggleGroup(root, group.id);
        }}
        onDoubleClick={() => {
          // Le premier clic a replié ou déplié : le double-clic renomme sans rien changer d'autre.
          toggleGroup(root, group.id);
          requestAnimationFrame(() => setState({ renamingTab: groupTabId(group.id) }));
        }}
        title={group.folded ? t("Déplier le groupe ; double-clic pour le renommer") : t("Replier le groupe ; double-clic pour le renommer")}
        className={cn(
          "flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] font-medium",
          style.chip,
          active && "ring-1 ring-current ring-inset",
        )}
        data-tab-group={group.id}
        data-folded={group.folded || undefined}
      >
        {renaming ? (
          <NameInput
            whole
            initial={group.name}
            className="w-32 flex-none"
            onSubmit={(value) => {
              renameGroup(root, group.id, value);
              endRename();
            }}
            onCancel={endRename}
          />
        ) : group.name ? (
          <span>{group.name}</span>
        ) : (
          <span className={cn("my-1 size-2.5 rounded-full", style.dot)} />
        )}
        {group.folded && (
          <>
            <span className="tabular-nums opacity-80">{ids.length}</span>
            {busy && <Sparkles className="size-3 animate-pulse text-amber-500" />}
            {asking && <CircleAlert className="size-3 text-amber-500" />}
            {done && <span className="size-2 rounded-full bg-emerald-500" />}
          </>
        )}
      </div>
    </ContextArea>
  );
}
