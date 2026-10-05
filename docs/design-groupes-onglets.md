# Conception — grouper les onglets

Contrats et structure de la piste 12 de [`pistes.md`](pistes.md). La piste tient en
une MR, en deux commits qui suivent ses paliers ; le plan est en fin de document.

Le serveur ne change pas : un groupe est un rangement de la barre, gardé avec le
projet dans l'état de l'interface, comme `tabOrder`.

---

## 1. Le constat

- La barre range terminaux et fichiers mêlés par `tabOrder`, une liste
  d'identifiants recollée à ce qui est là (`orderTabs`) ; les nouveaux vont au
  bout. Le glisser (`Reorderable`, `dropTab`) et `Alt+Maj+Page` (`shiftTab`)
  l'écrivent.
- Un terminal se ferme par `closeTerminal`, un fichier par `forget` (`editor.ts`),
  qui sont leurs seules sorties ; `followRename` suit un fichier renommé.
- Un terminal rangé dans Scripts quitte la barre sans mourir : `placementOf`.
- La pastille du projet compte déjà les signes de ses onglets Claude.

## 2. Le modèle

```ts
type GroupColor = "grey" | "blue" | "red" | "yellow" | "green" | "pink" | "purple" | "cyan" | "orange";

interface TabGroup {
  id: string;
  name: string;          // vide : une puce de couleur seule
  color: GroupColor;
  folded: boolean;
  kind?: "claude" | "shell"; // né de « Grouper les onglets Claude / les shells »
}

interface TabGroups {
  groups: TabGroup[];
  /** Groupe de chaque onglet, par identifiant de terminal ou chemin de fichier. */
  members: Record<string, string>;
}
```

`SavedProject.tabGroups` le garde, lu par `migrate` comme le reste : un groupe
illisible est écarté, une couleur inconnue devient `grey`, un membre qui vise un
groupe absent est oublié.

**Un seul ordre.** `tabOrder` reste la seule liste. Les membres d'un groupe y sont
contigus parce qu'on les y rassemble à la lecture : `gather` pose tout le groupe à
la place de son premier membre. Chaque geste lit l'ordre rassemblé et l'écrit tel.

**Un membre absent n'est pas oublié.** Un shell rangé dans Scripts garde son
groupe : sorti des scripts, il le retrouve. Seule la fermeture fait oublier :
`closeTerminal`, `forget`, et l'adoption des terminaux à la connexion élaguent les
membres qui ne vivent plus, puis les groupes vides (`prune`).

## 3. Les gestes : `lib/tab-groups.ts`

Fonctions pures, testées. Chacune reçoit l'état des groupes et l'ordre rassemblé
des onglets présents dans la barre, et rend les deux.

| Fonction | Geste |
|---|---|
| `gather(order, members)` | rassembler chaque groupe à la place de son premier membre |
| `barItems(order, groups)` | la barre : onglets seuls et groupes avec leurs onglets présents |
| `createGroup` · `addToGroup` · `removeFromGroup` · `ungroup` | faits à la main ; retiré, un onglet se pose juste après son groupe |
| `dropInBar(moved, target, side)` | le glisser, onglets et groupes |
| `shiftInBar(id, step)` | `Alt+Maj+Page` |
| `groupByKind(kind, candidates)` | « Grouper les onglets Claude / les shells » |
| `placeOpened(id, kind, mode)` | où va un onglet qu'on vient d'ouvrir |
| `hiddenTabs` · `prune` · `renameMember` · `unfoldFor` | repli, fermeture, renommage, montrer |

**Le glisser.** Un onglet lâché sur un onglet prend le groupe de celui-ci, ou n'en a
plus : c'est la règle de Chrome, qu'on lit sans la connaître. Lâché sur une
étiquette : devant, il se pose avant le groupe, hors de lui ; derrière, il entre en
tête du groupe déplié, ou se pose juste après un groupe replié. Une étiquette
glissée emmène tout le groupe, et se pose avant ou après l'onglet visé, ou tout son
groupe s'il en a un.

**Le clavier.** `Alt+Maj+Page` fait sortir l'onglet de son groupe quand il en
atteint le bord, et l'y fait entrer quand il en arrive au bord ; un groupe replié
se saute d'un coup.

**Par type.** `groupByKind` réunit les onglets du type qui ne sont dans aucun
groupe, dans le groupe de ce type s'il en a un de visible, sinon dans un nouveau
groupe, nommé Claude ou Shells. Le type est celui de l'ouverture : la commande lit
`kind` au moment du geste, et un shell devenu Claude, dont le `kind` change, ne
quitte jamais son groupe — aucun geste ne déplace un onglet déjà rangé.

**À l'ouverture.** `placeOpened` ne joue que s'il existe un groupe visible du type
de l'onglet ouvert : « à côté », il pose l'onglet juste après le groupe ; « le
rejoindre », il l'y ajoute et déplie le groupe. Sans groupe de ce type, l'onglet va
au bout, comme aujourd'hui. Le réglage est `SavedPrefs.newTabInGroup`, `"beside"`
par défaut.

## 4. L'état : `state/groups.ts`

Les gestes de l'interface, sur le projet actif : lire l'ordre rassemblé, appeler
la fonction pure, écrire `tabOrder` et `tabGroups`. Ce module ne dépend que du
store : `terminals.ts` et `editor.ts` l'appellent pour élaguer, placer l'onglet
ouvert et déplier le groupe de ce qu'on montre.

**Montrer déplie.** `focusTerminal`, `openFile` et `showFile` déplient le groupe de
ce qu'ils montrent. Replier le groupe de l'onglet regardé ne passe par aucun
d'eux : l'onglet reste montré, et l'étiquette se marque active.

**La navigation.** `Ctrl+Maj+Page` saute les onglets d'un groupe replié, sauf
celui qu'on regarde.

## 5. L'affichage

- `TerminalArea` rend `barItems` : un onglet seul comme aujourd'hui ; un groupe
  dans un cadre teinté de sa couleur, l'étiquette puis ses onglets, ou l'étiquette
  seule s'il est replié.
- **L'étiquette** (`components/TabGroups.tsx`) : son nom, ou une puce de couleur ;
  repliée, le nombre de ses onglets et les signes de ses onglets Claude — ✦ au
  travail, ⚠ en attente, point vert fini sans être vu —, comme la pastille du
  projet. Un clic replie ou déplie, un double-clic renomme (`renamingTab` vaut
  `group:<id>`), le clic droit propose renommer, couleur, replier, dégrouper,
  fermer le groupe.
- **Le menu d'un onglet**, terminal ou fichier : « Nouveau groupe », « Ajouter au
  groupe › … », « Retirer du groupe », puis « Grouper les onglets Claude » et
  « Grouper les shells ».
- **Fermer le groupe** demande confirmation quand il porte un onglet Claude
  ouvert, une commande en cours ou un fichier modifié, et dit lesquels ; un fichier
  modifié reste ouvert, sa croix demandant comme aujourd'hui.
- **La palette** : nouveau groupe, replier ou déplier, retirer de son groupe et
  dégrouper, sur l'onglet montré ; grouper les onglets Claude, les shells. Sans
  raccourci par défaut.

## 6. Ce qui n'est pas fait

- L'onglet Scripts n'entre dans aucun groupe ; ses terminaux non plus, tant qu'ils
  y sont.
- Un groupe n'est pas partagé entre projets.

## Plan

Une MR, `aqn/feat/tab-groups`, deux commits :

1. **Groupes faits à la main** : `lib/tab-groups.ts` et ses tests, `tabGroups` dans
   l'état gardé, `state/groups.ts`, la barre, l'étiquette et ses menus, le glisser,
   le clavier, la fermeture, la palette ; guide `terminaux.md`.
2. **Par type** : `groupByKind`, `placeOpened`, le réglage « Nouvel onglet d'un
   type groupé » dans Réglages › Terminal ; guide.
