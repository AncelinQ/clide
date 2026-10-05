/**
 * Groupes d'onglets de la barre, façon Chrome : une étiquette devant des onglets
 * voisins, qui se replie.
 *
 * `tabOrder` reste le seul ordre. Les membres d'un groupe y sont rassemblés à la
 * lecture (`gather`) : tout le groupe se pose à la place de son premier membre.
 * Chaque geste reçoit l'ordre rassemblé des onglets présents dans la barre et
 * rend l'ordre et les groupes qui en découlent.
 *
 * Un membre absent de la barre — un shell rangé dans Scripts — garde son groupe :
 * seule la fermeture d'un onglet le fait oublier (`prune`).
 */

import { dropTab } from "@/lib/tab-order";

/** La palette, dans l'ordre où les groupes la prennent : le gris, qui se voit le moins, en dernier. */
export const GROUP_COLORS = ["blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange", "grey"] as const;
export type GroupColor = (typeof GROUP_COLORS)[number];

/** Le type d'onglets qu'un groupe a réunis d'un geste : « Grouper les onglets Claude », « Grouper les shells ». */
export type GroupKind = "claude" | "shell";

export interface TabGroup {
  id: string;
  /** Vide : l'étiquette n'est qu'une puce de couleur. */
  name: string;
  color: GroupColor;
  folded: boolean;
  kind?: GroupKind;
}

export interface TabGroups {
  groups: TabGroup[];
  /** Groupe de chaque onglet, par identifiant de terminal ou chemin de fichier. */
  members: Record<string, string>;
}

/** Ce que rend un geste : les groupes et l'ordre rassemblé des onglets. */
export interface Arranged {
  groups: TabGroups;
  order: string[];
}

export const NO_GROUPS: TabGroups = { groups: [], members: {} };

const PREFIX = "group:";

/** Identifiant de l'étiquette d'un groupe parmi ceux des onglets : au glisser, au renommage. */
export function groupTabId(id: string): string {
  return `${PREFIX}${id}`;
}

/** Le groupe que désigne l'identifiant d'une étiquette, ou rien pour un onglet. */
export function groupIdOf(tabId: string): string | undefined {
  return tabId.startsWith(PREFIX) ? tabId.slice(PREFIX.length) : undefined;
}

/** Une entrée de la barre : un onglet seul, ou un groupe et ses onglets présents. */
export type BarItem = { kind: "tab"; id: string } | { kind: "group"; group: TabGroup; ids: string[] };

/** Rassemble les membres de chaque groupe à la place du premier d'entre eux. */
export function gather(order: readonly string[], members: Readonly<Record<string, string>>): string[] {
  const out: string[] = [];
  const done = new Set<string>();
  for (const id of order) {
    if (done.has(id)) continue;
    const group = members[id];
    for (const member of group ? order.filter((item) => members[item] === group) : [id]) {
      if (done.has(member)) continue;
      out.push(member);
      done.add(member);
    }
  }
  return out;
}

/** La barre, à partir de l'ordre rassemblé : un groupe sans onglet présent n'y paraît pas. */
export function barItems(order: readonly string[], state: TabGroups): BarItem[] {
  const items: BarItem[] = [];
  for (const id of order) {
    const group = state.groups.find((item) => item.id === state.members[id]);
    const last = items.at(-1);
    if (!group) items.push({ kind: "tab", id });
    else if (last?.kind === "group" && last.group.id === group.id) last.ids.push(id);
    else items.push({ kind: "group", group, ids: [id] });
  }
  return items;
}

/** Le groupe de l'onglet `id`, s'il en a un. */
export function groupOf(state: TabGroups, id: string): TabGroup | undefined {
  const group = state.members[id];
  return group ? state.groups.find((item) => item.id === group) : undefined;
}

/** Onglets présents d'un groupe, dans l'ordre. */
function block(order: readonly string[], state: TabGroups, group: string): string[] {
  return order.filter((id) => state.members[id] === group);
}

/** Pose `ids` devant `before`, ou au bout sans lui. */
function place(order: readonly string[], ids: readonly string[], before: string | null): string[] {
  const moving = new Set(ids);
  const rest = order.filter((id) => !moving.has(id));
  const index = before === null ? -1 : rest.indexOf(before);
  const at = index === -1 ? rest.length : index;
  return [...rest.slice(0, at), ...ids, ...rest.slice(at)];
}

/** L'onglet qui suit `last` une fois `moving` retiré de l'ordre : là où poser ce qui va juste après. */
function following(order: readonly string[], last: string | undefined, moving: readonly string[]): string | null {
  const rest = order.filter((id) => !moving.includes(id));
  return last === undefined ? null : (rest[rest.indexOf(last) + 1] ?? null);
}

/** Les groupes sans plus aucun membre, présent ou non, disparaissent. */
function clean(state: TabGroups): TabGroups {
  const used = new Set(Object.values(state.members));
  const groups = state.groups.filter((group) => used.has(group.id));
  return groups.length === state.groups.length ? state : { ...state, groups };
}

/** La première couleur qu'aucun groupe ne porte, sinon la suivante dans la palette. */
export function nextColor(state: TabGroups): GroupColor {
  const used = new Set(state.groups.map((group) => group.color));
  return GROUP_COLORS.find((color) => !used.has(color)) ?? (GROUP_COLORS[state.groups.length % GROUP_COLORS.length] as GroupColor);
}

/** Un nouveau groupe avec `ids`, qui quittent le leur ; il se pose à la place du premier. */
export function createGroup(state: TabGroups, order: readonly string[], ids: readonly string[], group: TabGroup): Arranged {
  const members = { ...state.members };
  for (const id of ids) members[id] = group.id;
  const groups = clean({ groups: [...state.groups, group], members });
  return { groups, order: gather(order, members) };
}

/** Ajoute `id` au bout du groupe `group`. */
export function addToGroup(state: TabGroups, order: readonly string[], id: string, group: string): Arranged {
  if (state.members[id] === group || !state.groups.some((item) => item.id === group)) return { groups: state, order: [...order] };
  const present = block(order, state, group);
  const members = { ...state.members, [id]: group };
  const placed = present.length > 0 ? place(order, [id], following(order, present.at(-1), [id])) : [...order];
  return { groups: clean({ ...state, members }), order: gather(placed, members) };
}

/** Fait entrer `id` en tête du groupe `group`, replié ou non : là où va un onglet lâché sur son étiquette. */
export function enterGroup(state: TabGroups, order: readonly string[], id: string, group: string): Arranged {
  if (!state.groups.some((item) => item.id === group)) return { groups: state, order: [...order] };
  const present = block(order, state, group).filter((item) => item !== id);
  const members = { ...state.members, [id]: group };
  const placed = present.length > 0 ? place(order, [id], present[0] as string) : [...order];
  return { groups: clean({ ...state, members }), order: gather(placed, members) };
}

/** Sort `id` de son groupe ; il se pose juste après lui. Un groupe vidé disparaît. */
export function removeFromGroup(state: TabGroups, order: readonly string[], id: string): Arranged {
  const group = state.members[id];
  if (!group) return { groups: state, order: [...order] };
  const members = { ...state.members };
  delete members[id];
  const rest = block(order, { ...state, members }, group);
  const placed = rest.length > 0 ? place(order, [id], following(order, rest.at(-1), [id])) : [...order];
  return { groups: clean({ ...state, members }), order: gather(placed, members) };
}

/** Retire un groupe ; ses onglets restent à leur place. */
export function ungroup(state: TabGroups, group: string): TabGroups {
  const members = Object.fromEntries(Object.entries(state.members).filter(([, value]) => value !== group));
  return { groups: state.groups.filter((item) => item.id !== group), members };
}

/** Change le nom, la couleur ou le repli d'un groupe. */
export function updateGroup(state: TabGroups, group: string, patch: Partial<Omit<TabGroup, "id">>): TabGroups {
  return { ...state, groups: state.groups.map((item) => (item.id === group ? { ...item, ...patch } : item)) };
}

/**
 * Le glisser. Un onglet lâché sur un onglet prend son groupe, ou n'en a plus. Lâché
 * sur une étiquette, de quelque côté qu'il tombe, il entre en tête du groupe,
 * replié ou non. Une étiquette emmène tout son groupe, avant ou après l'onglet
 * visé — ou tout le groupe de celui-ci.
 */
export function dropInBar(state: TabGroups, order: readonly string[], moved: string, target: string, side: "before" | "after"): Arranged {
  const same = { groups: state, order: [...order] };
  const movedGroup = groupIdOf(moved);
  const targetGroup = groupIdOf(target);

  if (movedGroup) {
    const moving = block(order, state, movedGroup);
    const aimed = targetGroup ?? state.members[target];
    const targets = aimed ? block(order, state, aimed) : [target];
    if (moving.length === 0 || targets.length === 0 || targets.some((id) => moving.includes(id))) return same;
    const before = side === "before" ? (targets[0] as string) : following(order, targets.at(-1), moving);
    return { groups: state, order: place(order, moving, before) };
  }

  if (targetGroup) return enterGroup(state, order, moved, targetGroup);

  if (moved === target) return same;
  const members = { ...state.members };
  const group = state.members[target];
  if (group) members[moved] = group;
  else delete members[moved];
  return { groups: clean({ ...state, members }), order: gather(dropTab(order, moved, target, side), members) };
}

/**
 * `Alt+Maj+Page` : un cran à gauche (`-1`) ou à droite (`1`). Au bord de son groupe,
 * l'onglet en sort ; arrivé au bord d'un groupe déplié, il y entre ; un groupe
 * replié se saute d'un coup.
 */
export function shiftInBar(state: TabGroups, order: readonly string[], id: string, step: -1 | 1): Arranged {
  const same = { groups: state, order: [...order] };
  const index = order.indexOf(id);
  if (index === -1) return same;
  const neighbor = order[index + step];
  const swapped = () => {
    const next = [...order];
    next[index] = neighbor as string;
    next[index + step] = id;
    return next;
  };
  const group = state.members[id];
  if (group) {
    if (neighbor !== undefined && state.members[neighbor] === group) return { groups: state, order: swapped() };
    const members = { ...state.members };
    delete members[id];
    return { groups: clean({ ...state, members }), order: gather(order, members) };
  }
  if (neighbor === undefined) return same;
  const next = state.groups.find((item) => item.id === state.members[neighbor]);
  if (!next) return { groups: state, order: swapped() };
  if (next.folded) {
    const jumped = block(order, state, next.id);
    const before = step === 1 ? following(order, jumped.at(-1), [id]) : (jumped[0] as string);
    return { groups: state, order: place(order, [id], before) };
  }
  const members = { ...state.members, [id]: next.id };
  return { groups: { ...state, members }, order: gather(order, members) };
}

/**
 * « Grouper les onglets Claude » ou « les shells » : les onglets du type qui ne sont
 * dans aucun groupe rejoignent le groupe de ce type s'il en a un de visible, sinon
 * un nouveau groupe, `group`. Rien si aucun n'est libre : un onglet déjà rangé ne
 * bouge pas.
 */
export function groupByKind(state: TabGroups, order: readonly string[], kind: GroupKind, candidates: readonly string[], group: TabGroup): Arranged | undefined {
  const loose = candidates.filter((id) => order.includes(id) && !state.members[id]);
  if (loose.length === 0) return undefined;
  const existing = state.groups.find((item) => item.kind === kind && order.some((id) => state.members[id] === item.id));
  if (!existing) return createGroup(state, order, loose, { ...group, kind });
  let result: Arranged = { groups: state, order: [...order] };
  for (const id of loose) result = addToGroup(result.groups, result.order, id, existing.id);
  return result;
}

/**
 * Où va un onglet qu'on vient d'ouvrir, quand un groupe visible porte son type :
 * juste après ce groupe (`beside`), ou dedans, groupe déplié (`join`). Rien sans
 * groupe de ce type : il va au bout, comme tout nouvel onglet.
 */
export function placeOpened(state: TabGroups, order: readonly string[], id: string, kind: GroupKind, mode: "beside" | "join"): Arranged | undefined {
  const rest = gather(
    order.filter((item) => item !== id),
    state.members,
  );
  const group = state.groups.find((item) => item.kind === kind && rest.some((other) => state.members[other] === item.id));
  if (!group) return undefined;
  const present = block(rest, state, group.id);
  const placed = place(rest, [id], following(rest, present.at(-1), []));
  if (mode === "beside") return { groups: state, order: placed };
  const members = { ...state.members, [id]: group.id };
  return { groups: { groups: state.groups.map((item) => (item.id === group.id ? { ...item, folded: false } : item)), members }, order: gather(placed, members) };
}

/** Onglets présents dont le groupe est replié : la barre et la navigation les passent. */
export function hiddenTabs(state: TabGroups, order: readonly string[]): Set<string> {
  const folded = new Set(state.groups.filter((group) => group.folded).map((group) => group.id));
  return new Set(order.filter((id) => folded.has(state.members[id] ?? "")));
}

/** Le groupe replié de l'onglet `id`, déplié, ou rien s'il n'y a rien à déplier. */
export function unfoldFor(state: TabGroups, id: string): TabGroups | undefined {
  const group = groupOf(state, id);
  return group?.folded ? updateGroup(state, group.id, { folded: false }) : undefined;
}

/** Oublie les membres qui ne vivent plus, puis les groupes vides ; rend `state` tel quel s'il n'y a rien à oublier. */
export function prune(state: TabGroups, alive: (id: string) => boolean): TabGroups {
  const ids = Object.keys(state.members);
  if (ids.every(alive)) return state;
  const members = Object.fromEntries(Object.entries(state.members).filter(([id]) => alive(id)));
  return clean({ ...state, members });
}

/** Suit un onglet renommé : un fichier déplacé garde son groupe. */
export function renameMember(state: TabGroups, rename: (id: string) => string): TabGroups {
  const entries = Object.entries(state.members);
  if (entries.every(([id]) => rename(id) === id)) return state;
  return { ...state, members: Object.fromEntries(entries.map(([id, group]) => [rename(id), group])) };
}
