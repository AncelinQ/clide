# Conception — les prompts au clavier

Contrats et structure de la piste 13 de [`pistes.md`](pistes.md). La piste tient en
une MR ; le plan est en fin de document.

Le serveur ne change pas : les prompts gardent leurs fichiers, les touches vivent
avec les autres raccourcis, dans l'état de l'interface.

---

## 1. Le constat

- Chaque prompt est déjà une commande, `prompt.run:<id>`, produite par
  `commands()` à partir de `cachedPrompts()` — ceux du projet actif, puis ceux de
  l'utilisateur. Un raccourci qu'on lui donne dans les Réglages va dans
  `shortcuts` (`SavedPrefs`), comme pour toute commande, et `listenShortcuts` le
  déclenche partout, terminal compris.
- `shortcutOf` nomme une touche par `event.key`. Sur la rangée des chiffres, ce
  nom dépend du clavier : `Ctrl+Maj+1` donne `1` en AZERTY, `!` en QWERTY ; sans
  Maj, la touche du 1 donne `&` en AZERTY. Le `Alt+1` du jeu JetBrains ne se
  déclenche donc jamais sur un clavier français.
- La palette a un mode `/` (prompts et skills) que rien n'ouvre directement.

## 2. Le principe : un numéro est un raccourci comme un autre

Un numéro n'a pas de stockage propre : c'est l'entrée `shortcuts["prompt.run:<id>"]
= "Ctrl+Shift+N"`. Tout le reste en découle :

- **fixe** : rien ne le recalcule, il reste tant qu'on ne le change pas ;
- **réattribuable** : la vue Prompts et les Réglages écrivent la même entrée ;
- **personnel** : `shortcuts` vit dans l'état de l'interface, jamais dans
  `.claude/clide-prompts.json` ;
- **le projet prime** : `commandFor` prend la première commande qui porte la
  touche, et `cachedPrompts()` met ceux du projet d'abord.

Une entrée `null` dit « aucune touche » ; une entrée absente dit « jamais
numéroté ».

## 3. Numéroter : `lib/prompt-keys.ts`

Fonctions pures, testées :

```ts
export const PROMPT_KEYS: readonly string[]; // Ctrl+Shift+1 … Ctrl+Shift+9
export const LIST_KEY = "Ctrl+Shift+0";
export function promptCommand(id: string): string; // "prompt.run:<id>"

/** Entrées à ajouter à `shortcuts` pour les prompts jamais numérotés, ou rien. */
export function numberNew(prompts: readonly { id: string }[], overrides: Record<string, string | null>): Record<string, string | null> | undefined;

/** Prompt du projet qui prend la touche de chaque prompt perso masqué, par identifiant. */
export function shadowedBy(prompts: readonly SavedPrompt[], overrides): Record<string, SavedPrompt>;

/** Vrai si des commandes sur une même touche ne sont qu'un prompt du projet devant des prompts perso. */
export function isShadowing(ids: readonly string[], prompts: readonly SavedPrompt[]): boolean;
```

`numberNew` parcourt les prompts visibles dans l'ordre de la liste ; un prompt sans
entrée prend la première touche de `PROMPT_KEYS` qui n'est ni à un prompt visible,
ni à une commande qui n'est pas un prompt. Les prompts d'autres projets ne
comptent pas : invisibles ici, ils ne gênent rien. Plus de touche libre : l'entrée
vaut `null`, et le prompt n'en reçoit plus d'office — un numéro libéré attend le
prochain prompt créé.

Le même parcours sert à la création et aux prompts déjà là : `loadPrompts`
l'applique après chaque lecture. Un prompt du projet arrivé par git est numéroté à
sa première lecture, comme s'il venait d'être créé.

Supprimer un prompt retire son entrée : son numéro redevient libre.

## 4. La rangée des chiffres : `shortcutOf`

`shortcutOf` et `isUsableShortcut` passent dans `lib/keymap.ts`, purs et testés.
Avec Ctrl ou Alt, une touche de la rangée des chiffres (`event.code` `Digit0` à
`Digit9`) prend son chiffre pour nom, quel que soit le clavier. Le pavé numérique
garde son nom. AltGr reste écarté, et `Ctrl+Alt` avec lui.

Effet de bord voulu : le `Alt+1` et le `Alt+4` du jeu JetBrains marchent en AZERTY.

## 5. Les gestes

| Geste | Où |
|---|---|
| `Ctrl+Maj+0` ouvre la palette en mode `/` | commande `palette.prompts`, groupe Prompts, défaut `LIST_KEY` |
| `Ctrl+Maj+1…9` lance un prompt | `listenShortcuts`, sans changement |
| voir et changer la touche d'un prompt | vue Prompts : une puce à droite du nom ; un clic l'enregistre |
| voir la touche | palette `/`, menu des prompts de la barre flottante |

L'enregistrement d'une touche sort de `ShortcutsEditor` en un crochet,
`useShortcutRecording`, que la vue Prompts reprend : mêmes règles (Échap annule,
Suppr retire, une touche prise est retirée à l'autre commande, avec un avis).

Un prompt perso masqué dans le projet ouvert montre sa touche estompée, avec le nom
du prompt qui la prend en infobulle ; les Réglages ne comptent pas ce masquage
parmi les conflits (`isShadowing`).

## 6. Ce qui n'est pas fait

- Aucun numéro dans le fichier versionné du projet.
- `Ctrl+Maj+0` peut être pris par Windows quand plusieurs langues de saisie sont
  installées et qu'une touche d'accès leur est donnée ; le raccourci se change
  dans les Réglages.

## Plan

Une MR, `aqn/feat/prompt-keys` :

1. `shortcutOf` dans `lib/keymap.ts`, rangée des chiffres par `event.code`, tests.
2. `lib/prompt-keys.ts` et ses tests ; `loadPrompts` numérote, la suppression
   libère.
3. Commande `palette.prompts` ; touches dans la palette et le menu de la barre
   flottante.
4. `useShortcutRecording`, puce de la vue Prompts, masquage hors des conflits.
5. Guide (`projet.md`, `personnaliser.md`), traductions, piste à jour.
