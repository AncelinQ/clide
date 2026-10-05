/**
 * Gestes des groupes d'onglets sur un projet : lire l'ordre rassemblé de sa barre,
 * appliquer la fonction pure de `lib/tab-groups.ts`, écrire `tabOrder` et
 * `tabGroups`.
 *
 * Ne dépend que du store : `terminals.ts` et `editor.ts` l'appellent pour oublier
 * un onglet fermé, placer celui qu'on ouvre et déplier le groupe de ce qu'on montre.
 */

import { t } from "@/i18n";
import { placementOf } from "@/lib/script-shelf";
import {
  addToGroup,
  createGroup,
  dropInBar,
  gather,
  groupByKind,
  groupTabId,
  nextColor,
  placeOpened,
  prune,
  removeFromGroup,
  shiftInBar,
  ungroup,
  unfoldFor,
  updateGroup,
  type Arranged,
  type GroupColor,
  type GroupKind,
  type TabGroups,
} from "@/lib/tab-groups";
import { orderTabs } from "@/lib/tab-order";
import type { TerminalInfo } from "@/lib/types";
import { getState, setState, tabsOf, type Project, type State } from "@/state/store";

/** Onglets de la barre du projet `root`, terminaux et fichiers, dans l'ordre rassemblé. */
export function barOrder(current: State, root: string | null): string[] {
  const project = current.projects.find((item) => item.root === root);
  if (!project) return [];
  const present = [...tabsOf(current, root).bar.map((info) => info.id), ...project.openFiles];
  return gather(orderTabs(project.tabOrder, present), project.tabGroups.members);
}

/** Applique un geste à la barre du projet `root` ; rien quand le geste ne rend rien. */
export function arrange(root: string | null, gesture: (groups: TabGroups, order: string[], project: Project) => Arranged | undefined): void {
  const current = getState();
  const project = current.projects.find((item) => item.root === root);
  if (!project) return;
  const result = gesture(project.tabGroups, barOrder(current, root), project);
  if (!result) return;
  setState((state) => ({
    projects: state.projects.map((item) => (item.root === root ? { ...item, tabOrder: result.order, tabGroups: result.groups } : item)),
  }));
}

/** Change les groupes du projet `root` sans toucher à l'ordre ; rien quand `change` ne rend rien. */
function regroup(root: string | null, change: (groups: TabGroups) => TabGroups | undefined): void {
  const project = getState().projects.find((item) => item.root === root);
  const next = project ? change(project.tabGroups) : undefined;
  if (!next || next === project?.tabGroups) return;
  setState((state) => ({ projects: state.projects.map((item) => (item.root === root ? { ...item, tabGroups: next } : item)) }));
}

/** Projets où les onglets que `alive` ne garde pas quittent leur groupe, et les groupes vidés disparaissent. */
export function forgetInGroups(projects: Project[], alive: (project: Project, id: string) => boolean): Project[] {
  return projects.map((project) => {
    const tabGroups = prune(project.tabGroups, (id) => alive(project, id));
    return tabGroups === project.tabGroups ? project : { ...project, tabGroups };
  });
}

/** Déplie le groupe replié de l'onglet qu'on va montrer : montrer un onglet, c'est le rendre visible. */
export function unfoldTab(root: string | null, id: string): void {
  regroup(root, (groups) => unfoldFor(groups, id));
}

/** Un groupe avec l'onglet `id`, dont le nom s'écrit aussitôt. */
export function newGroupWith(root: string | null, id: string): void {
  const project = getState().projects.find((item) => item.root === root);
  if (!project) return;
  const group = { id: crypto.randomUUID(), name: "", color: nextColor(project.tabGroups), folded: false };
  arrange(root, (groups, order) => createGroup(groups, order, [id], group));
  setState({ renamingTab: groupTabId(group.id) });
}

export function addTabToGroup(root: string | null, id: string, group: string): void {
  arrange(root, (groups, order) => addToGroup(groups, order, id, group));
}

export function removeTabFromGroup(root: string | null, id: string): void {
  arrange(root, (groups, order) => removeFromGroup(groups, order, id));
}

export function dissolveGroup(root: string | null, group: string): void {
  regroup(root, (groups) => ungroup(groups, group));
}

export function toggleGroup(root: string | null, group: string): void {
  regroup(root, (groups) => updateGroup(groups, group, { folded: !groups.groups.find((item) => item.id === group)?.folded }));
}

export function renameGroup(root: string | null, group: string, name: string): void {
  regroup(root, (groups) => updateGroup(groups, group, { name: name.trim() }));
}

export function colorGroup(root: string | null, group: string, color: GroupColor): void {
  regroup(root, (groups) => updateGroup(groups, group, { color }));
}

/** Le glisser d'un onglet ou d'une étiquette dans la barre. */
export function dropOnBar(root: string | null, moved: string, target: string, side: "before" | "after"): void {
  arrange(root, (groups, order) => dropInBar(groups, order, moved, target, side));
}

/** `Alt+Maj+Page` sur l'onglet `id`. */
export function shiftTabInBar(root: string | null, id: string, step: -1 | 1): void {
  arrange(root, (groups, order) => shiftInBar(groups, order, id, step));
}

/** Terminaux de la barre ouverts comme `kind` et rangés dans aucun groupe : ce que le geste par type réunirait. */
function looseOfKind(current: State, root: string | null, kind: GroupKind): string[] {
  const members = current.projects.find((item) => item.root === root)?.tabGroups.members ?? {};
  return tabsOf(current, root)
    .bar.filter((info) => info.openedAs === kind && !members[info.id])
    .map((info) => info.id);
}

/** Vrai si « Grouper les onglets Claude » ou « les shells » a quelque chose à réunir. */
export function canGroupKind(root: string | null, kind: GroupKind): boolean {
  return looseOfKind(getState(), root, kind).length > 0;
}

/**
 * « Grouper les onglets Claude » ou « les shells » : un geste, pas un mode. Le type
 * est celui de l'ouverture, `openedAs` : un shell où `claude` tourne reste un shell.
 */
export function groupKind(root: string | null, kind: GroupKind): void {
  const candidates = looseOfKind(getState(), root, kind);
  const group = {
    id: crypto.randomUUID(),
    name: kind === "claude" ? t("Claude") : t("Shells"),
    color: kind === "claude" ? ("orange" as const) : ("blue" as const),
    folded: false,
  };
  arrange(root, (groups, order) => groupByKind(groups, order, kind, candidates, group));
}

/**
 * Projets une fois l'onglet `info` qu'on vient d'ouvrir posé près du groupe de son
 * type, à côté ou dedans selon le réglage ; tels quels sans groupe de ce type, ou
 * pour un onglet qui va dans Scripts. `current` connaît déjà le terminal.
 */
export function placeNewTab(current: State, projects: Project[], owner: string, info: TerminalInfo): Project[] {
  const project = projects.find((item) => item.root === owner);
  if (!project || placementOf(info, project.scripts.placed) !== "bar") return projects;
  const order = barOrder({ ...current, projects }, owner);
  const result = placeOpened(project.tabGroups, order, info.id, info.openedAs, current.newTabInGroup);
  if (!result) return projects;
  return projects.map((item) => (item.root === owner ? { ...item, tabOrder: result.order, tabGroups: result.groups } : item));
}
