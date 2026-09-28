# Conception — lots 13 à 16

Suite de [`design-refonte.md`](design-refonte.md) pour les lots repris de ClaudeTerm
2.0.6 ([`refonte-ui.md`](refonte-ui.md), lots 13 à 16) : erreurs et TODO du projet,
tests, lancement depuis la marge de l'éditeur, onglets déplaçables. Même méthode :
les formes (types, routes, invariants) avant le code, une MR par lot.

Contraintes reprises telles quelles : `core/` pur et testé, le serveur seul maître
du disque et des processus, chaque chemin borné par `WorkspaceRoots`, pas
d'interrogation périodique quand un événement existe.

---

## 1. Ce qui déclenche une vérification

Trois événements, qu'on a déjà :

| Événement | D'où il vient | Ce qu'il relance |
|---|---|---|
| Un projet s'ouvre | `POST /api/workspace/roots` | erreurs et TODO du projet |
| Un fichier est enregistré | `POST /api/fs/write`, `/api/fs/create|rename|move|trash` | erreurs et TODO du projet qui le contient |
| Claude finit un tour | hook `Stop` → `NotificationWatcher`, `kind: "stop"`, avec `cwd` | erreurs et TODO du projet de `cwd` (`ownerOf`) |

Un tour de Claude écrit souvent vingt fichiers : c'est le `Stop` qui relance, pas
chaque écriture. Les enregistrements faits dans l'éditeur de Clide passent, eux,
par l'API et relancent aussitôt.

---

## 2. Lot 13 — Erreurs et TODO

### 2.1 Modèle, dans `core/src/diagnostics/`

```ts
export type Severity = "error" | "warning" | "info";

export interface Diagnostic {
  /** Chemin absolu du fichier. */
  path: string;
  line: number;        // 1-based
  column: number;      // 1-based
  severity: Severity;
  message: string;
  /** `tsc`, `eslint` ou `todo`. */
  source: "tsc" | "eslint" | "todo";
  /** Code de la règle : `TS2322`, `no-unused-vars`, `FIXME`. */
  code?: string;
}

export interface DiagnosticsReport {
  root: string;
  /** Un rapport par outil : il se remplace en entier à chaque passage de cet outil. */
  tools: { tool: Diagnostic["source"]; ranAt: string; durationMs: number; diagnostics: Diagnostic[]; error?: string }[];
}
```

Lecture des sorties, fonctions pures et testées sur de vraies sorties :

- `parseTsc(stdout, cwd)` : `tsc --noEmit --pretty false` écrit
  `chemin(ligne,colonne): error TS2322: message` ; le chemin est relatif au dossier
  du `tsconfig`, séparateurs de Windows ou non.
- `parseEslint(json)` : `eslint -f json .` rend `[{ filePath, messages: [{ line,
  column, severity: 1|2, message, ruleId }] }]`.
- `findTodos(path, text)` : `TODO`, `FIXME`, `HACK`, `XXX` suivis de `:` ou d'un
  espace, dans un commentaire (`//`, `#`, `/* */`, `<!-- -->`) ou n'importe où dans
  un Markdown. Le mot trouvé devient `code`, le reste de la ligne `message`.

### 2.2 Qui lance quoi, dans `server/src/modules/diagnostics.ts`

- **tsc** : chaque `tsconfig.json` du projet qui compile (pas de `"files": []` sans
  `references`, hors `node_modules`), lancé par le binaire local
  (`node_modules/.bin/tsc` du dossier ou d'un parent, jamais un `tsc` global ni
  `npx`), `--noEmit --pretty false -p <tsconfig>`.
- **ESLint** : si une configuration existe (`eslint.config.*`, `.eslintrc*`) et que
  `node_modules/.bin/eslint` est là : `eslint -f json .` depuis le dossier.
- **TODO** : parcours des fichiers texte du projet (`listProjectFiles`, qui passe
  déjà dépendances et sorties de build), 1 Mo au plus par fichier.
- Rien ne s'installe ni ne se télécharge : un projet sans l'outil n'a pas sa part.

**File par projet** : une vérification en cours pour un projet absorbe les
demandes qui arrivent pendant qu'elle tourne ; une seule relance suit, à la fin.
Délai de 1,5 s avant de partir, pour regrouper un enregistrement et le `Stop` qui
le suit. Deux projets différents tournent en parallèle, au plus deux à la fois.

### 2.3 Transport

- `GET /api/diagnostics?root=` : le dernier rapport, tout de suite.
- `POST /api/diagnostics/run { root, tools? }` : relancer à la main.
- WebSocket : `{ t: "diagnostics", report: DiagnosticsReport }` à chaque rapport
  terminé. Le client ne demande rien en boucle.

### 2.4 Interface

- Module web `diagnostics`, deux vues du bloc du bas : **Erreurs** et **TODO**,
  chacune groupée par fichier (icône Catppuccin, nombre, repli), triée erreurs
  d'abord. La pastille de l'onglet porte le nombre d'erreurs.
- Un clic ouvre le fichier dans l'éditeur à la ligne : `openFile(path, { line,
  column })` (nouveau paramètre de §4.3).
- **Corriger avec Claude** : un prompt `insert` — « Corrige l'erreur {code} de
  {chemin}:{ligne} : {message} » — passe par `runPrompt` (lot 10) ; il est tapé,
  pas envoyé.
- Dans l'éditeur, les diagnostics du fichier ouvert deviennent des marqueurs Monaco
  (`editor.setModelMarkers(model, "clide", …)`). Les diagnostics sémantiques propres
  à Monaco restent coupés
  (`typescriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true })`) :
  sans le `tsconfig` ni les dépendances, il signalerait des erreurs fausses.

### 2.5 Tests

Parseurs sur des sorties réelles (Windows et POSIX), `findTodos` sur chaque forme de
commentaire, file par projet (absorption, une seule relance, deux projets en
parallèle), route qui refuse une racine hors des projets ouverts.

---

## 3. Lot 14 — Tests

### 3.1 Détection, dans `core/src/tests/`

```ts
export type Framework = "vitest" | "jest" | "pytest";

export interface TestSuite {
  framework: Framework;
  /** Dossier du package, d'où les lancer. */
  directory: string;
  files: TestFile[];
}

export interface TestFile {
  path: string;
  tests: { name: string; line: number; parents: string[] }[];
}
```

- Vitest ou Jest : présent dans les dépendances du `package.json` du package, ou un
  `vitest.config.*` / `jest.config.*`. Fichiers : `**/*.{test,spec}.{ts,tsx,js,jsx,mts}`
  et le dossier `test(s)/`, hors `node_modules`.
- pytest : `pyproject.toml` ou `pytest.ini` avec `tests/`, fichiers `test_*.py` et
  `*_test.py`.
- `parseTestNames(text, framework)` : `describe` / `it` / `test` (avec `.each`,
  `.only`, `.skip`) et leurs parents pour JS ; `def test_…` et `class Test…` pour
  Python. Lecture par expressions, sans analyseur : un nom construit à l'exécution
  n'est pas vu, et c'est dit dans le guide.

### 3.2 Lancer et relire

- Lancer tout, un fichier ou un test passe par `runScript` (lot 11) : un onglet par
  package (`api › tests`), rien ne tourne en arrière-plan à l'insu de l'utilisateur.
- La commande ajoute un rapport machine écrit dans les données de Clide,
  `<dataDir>/tests/<hash du dossier>.json` :
  - Vitest : `vitest run --reporter=default --reporter=json --outputFile=<rapport> [fichier] [-t nom]` ;
  - Jest : `jest --json --outputFile=<rapport> [fichier] [-t nom]` ;
  - pytest : `pytest --junitxml=<rapport.xml> [fichier::test]`.
- Le rapport est relu quand la commande de l'onglet se termine (`command-end` de
  l'intégration shell, déjà suivi) : `GET /api/tests/results?directory=` lit le
  fichier, `parseVitestJson`, `parseJestJson`, `parseJunit` en font un même format :

```ts
export interface TestResult {
  path: string;
  name: string;
  parents: string[];
  status: "passed" | "failed" | "skipped";
  durationMs?: number;
  /** Message et pile de l'échec, tronqués à 4 Ko. */
  failure?: string;
}
```

Un test absent du dernier rapport garde son statut précédent : lancer un seul
fichier n'efface pas ce qu'on savait des autres.

### 3.3 Interface

- Onglet **Tests** dans la vue Scripts, à côté de Scripts : l'arbre package →
  fichier → test, avec pastille de statut, nombre d'échecs par nœud, filtre, et un
  bouton lancer à chaque niveau.
- Un échec se déplie sur son message ; **Corriger avec Claude** tape « Le test
  {nom} de {fichier} échoue : {message}. Corrige le code ou le test. », sans
  l'envoyer.
- Clavier dans l'arbre, comme l'explorateur : flèches, `→` / `←`, Entrée lance,
  Espace déplie.

### 3.4 Tests

`parseTestNames` sur des fichiers réels des deux familles, les trois lecteurs de
rapport sur de vrais rapports, fusion des résultats (un rapport partiel ne
réinitialise pas les autres), construction des commandes (chemins avec espaces,
apostrophes, filtre `-t`).

---

## 4. Lot 15 — Lancer depuis la marge

### 4.1 Lignes qui se lancent, dans `web/src/lib/runnables.ts`

```ts
export interface RunnableLine {
  line: number;
  name: string;
  /** Dossier et commande, prêts pour `runScript`. */
  directory: string;
  run: string;
  kind: "script" | "make" | "shell" | "test";
}

export function runnableLines(path: string, text: string, context: { manager: string }): RunnableLine[];
```

- `package.json` : la ligne de chaque clé de `scripts`, avec le gestionnaire du
  projet (déjà connu de `/api/scripts`).
- `Makefile` : chaque cible, par `makeTargets` (lot 11, déjà dans `core`).
- Markdown : chaque ligne d'un bloc ` ```sh `, ` ```bash `, ` ```powershell `,
  ` ```ps1 `, ` ```console ` (sans l'invite `$ ` ou `PS> `).
- `.ps1`, `.sh` : la première ligne, pour le fichier entier.
- Fichier de test : chaque test du lot 14, coloré par son dernier résultat.

Fonction pure, testée ; le Markdown et les tests se relisent à chaque frappe
(retardée de 300 ms), les autres à l'enregistrement.

### 4.2 Marge

- Décorations Monaco dans la marge des glyphes
  (`editor.createDecorationsCollection`, `glyphMarginClassName`) : ▷ quand rien ne
  tourne, ■ quand l'onglet du script tourne (`runningScriptTab`), vert / rouge pour
  un test passé / échoué.
- `editor.onMouseDown` sur la marge des glyphes : lancer ou arrêter, par
  `runScript` / `interruptTerminal`. Aucune commande nouvelle : c'est le même onglet
  par script, la même vue « En cours ».

### 4.3 Ouvrir à une ligne

`openFile(path, { line?, column? })` : une fois le modèle monté,
`editor.revealLineInCenter(line)` et le curseur posé. Sert aux lots 13 et 14.

---

## 5. Lot 16 — Onglets déplaçables

### 5.1 État

- Les projets : l'ordre est déjà celui de `state.projects`, sauvegardé.
- Le centre : terminaux et fichiers se mêlent. Chaque projet gagne
  `tabOrder: string[]` — ids de terminaux et chemins de fichiers, dans l'ordre
  voulu —, sauvegardé avec lui (`SavedProject`, migration : absent = ordre
  d'ouverture).
- `orderTabs(order, present)` : pure ; garde l'ordre connu, ajoute les onglets
  nouveaux à la fin, oublie ceux qui ont disparu. Un terminal qui revient après un
  rechargement reprend sa place, puisque son id ne change pas.
- `moveTab(order, id, before)` : pure, déplace un id devant un autre (ou en fin).

### 5.2 Geste

Glisser-déposer HTML5 sur les pastilles de projet et les onglets du centre : un
trait vertical montre la place d'arrivée, `Échap` annule. Au clavier :
`Ctrl+Maj+Page préc./suiv.` déplace l'onglet actif (commandes `tab.moveLeft`,
`tab.moveRight`, raccourcis modifiables). Un onglet ne quitte pas son projet.

### 5.3 Tests

`orderTabs` et `moveTab` (nouveaux, disparus, déplacement en tête et en fin),
migration d'un état sans `tabOrder`.

---

## 6. Découpage

| # | MR | Contenu | Dépend |
|---|---|---|---|
| 15 | `feat/diagnostics` | §1, §2 : module, file par projet, `tsc` / ESLint / TODO, onglets Erreurs et TODO, marqueurs, Corriger avec Claude, `openFile` à une ligne | — |
| 16 | `feat/tests` | §3 : détection, lancement par `runScript`, rapports, onglet Tests | 15 (ouverture à une ligne) |
| 17 | `feat/gutter-runs` | §4 : `runnableLines`, marge de l'éditeur, statuts des tests | 16 |
| 18 | `feat/tab-order` | §5 : `tabOrder`, glisser-déposer, commandes de déplacement | — |

## 7. Risques

- **Coût de `tsc`** sur un gros monorepo : plusieurs secondes et du processeur à
  chaque fin de tour. La file par projet évite l'empilement ; Réglages › Modules
  coupe le module, et une option limite aux fichiers ouverts si besoin.
- **ESLint 9 et les configurations anciennes** : un échec de configuration se
  montre comme erreur de l'outil (`tools[].error`), pas comme zéro erreur.
- **Rapports de tests** : l'écriture du rapport peut arriver après `command-end` ;
  relire au plus trois fois, à 300 ms d'écart, avant de conclure qu'il manque.
- **Faux TODO** : un `TODO` dans une chaîne n'est pas un commentaire ; la
  recherche s'en tient aux commentaires hors Markdown, au prix de rater un TODO
  dans une chaîne multiligne.
