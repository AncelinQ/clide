/**
 * Gestes des groupes d'onglets sur un projet : lire l'ordre rassemblé de sa barre,
 * appliquer la fonction pure de `lib/tab-groups.ts`, écrire `tabOrder` et
 * `tabGroups`.
 *
 * Ne dépend que du store : `terminals.ts` et `editor.ts` l'appellent pour oublier
 * un onglet fermé, placer celui qu'on ouvre et déplier le groupe de ce qu'on montre.
 */

import {
  addToGroup,
  createGroup,
  dropInBar,
  gather,
  groupTabId,
  nextColor,
  prune,
  removeFromGroup,
  shiftInBar,
  ungroup,
  unfoldFor,
  updateGroup,
  type Arranged,
  type GroupColor,
  type TabGroups,
} from "@/lib/tab-groups";
import { orderTabs } from "@/lib/tab-order";
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
