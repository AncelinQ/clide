# Conception — modèle et effort, pour cette session

Contrats et structure de la piste 14 de [`pistes.md`](pistes.md). Une MR,
`aqn/feat/model-effort-session` ; le plan est en fin de document.

Le serveur ne change pas : tout se joue dans le client, qui tape dans l'onglet
Claude et lit son écran.

---

## 1. Le constat

- `ClaudeToolbar` envoie `/model <id>` et `/effort <niveau>` par `sendToClaude`.
  Claude Code traite ces deux formes comme `Entrée` dans son sélecteur : le choix
  devient le défaut des sessions suivantes.
- Le transcript garde la sortie de la commande ; `Projection#applyLocalCommand` y
  lit ``Set model to `X` `` et `Set effort level to x`, quel que soit le suffixe —
  `and saved as your default…` ou `for this session only`. L'affichage de la barre
  suit donc déjà un changement fait pour la session seule.
- `claudeLaunch` lit `--model` et `--effort` dans la commande d'un onglet : un onglet
  ouvert avec eux affiche ses valeurs dès le départ.

## 2. Le principe : piloter le sélecteur, en regardant l'écran

Seule la touche `s` du sélecteur applique un choix à la session seule. Clide fait
donc ce qu'on ferait au clavier, et lit l'écran du terminal entre chaque touche :

| Pas | Modèle | Effort |
|---|---|---|
| ouvrir | `/model`, Entrée | `/effort`, Entrée |
| reconnaître | une ligne porte « s to use this session only » | une ligne porte « s for this session only » et le curseur `▲` |
| se placer | `Début`, puis `↓` jusqu'à la ligne surlignée (`❯`) qui porte le nom du modèle | `←` ou `→` autant de fois que d'écart entre le niveau sous `▲` et le niveau voulu |
| vérifier | la ligne surlignée est celle du modèle | le niveau sous `▲` est celui voulu |
| valider | `s` | `s` |

**Ne jamais valider à l'aveugle.** Chaque pas attend ce qu'il doit voir, dans un
délai court. Un écran qui ne répond pas comme prévu — sélecteur absent, ligne
introuvable, curseur ailleurs — referme le sélecteur par Échap et le dit : rien
n'a changé. Entrée n'est jamais envoyée dans un sélecteur ; seul `s` y valide.

**Avant d'ouvrir.** Rien ne part tant que Claude travaille : le geste attend la fin
du tour, et un avis le dit. Une ligne de saisie où l'on a commencé à écrire arrête
le geste, plutôt que d'y mêler la commande ; le texte estompé d'une suggestion
(`Try "…"`) ne compte pas.

## 3. Lire l'écran

- `terminals.ts` : `screenRows(id)` rend les lignes de l'écran actif du terminal,
  tampon alternatif compris (le rendu fullscreen de Claude Code), avec, pour chaque
  caractère, s'il est estompé.
- `lib/claude-picker.ts`, pur et testé sur des écrans relevés dans une vraie
  session :
  - `isModelPicker(lines)`, `highlightedModel(lines)` : le nom de la ligne
    surlignée, sans sa coche ;
  - `effortSlider(lines)` : les niveaux de la règle et l'indice de celui sous `▲` ;
  - `inputDraft(rows)` : ce qu'on a tapé sur la ligne de saisie `❯` qui suit un
    filet, sans les caractères estompés.
- `state/claude-picker.ts` : `switchModel(id, model)` et `switchEffort(id, level)`,
  un geste à la fois par onglet ; ils rendent un message quand rien n'a changé.

## 4. L'interface

- **La barre flottante** : les menus du modèle et de l'effort disent qu'ils valent
  pour la session, le défaut se réglant dans Réglages › Claude Code ; leurs entrées
  passent par `switchModel` et `switchEffort`. Un échec, ou l'attente de la fin du
  tour, s'affiche en bas du terminal comme le rappel d'un script fini.
- **Le menu `+`** : dans « Claude avec le modèle », chaque modèle qui a un effort
  réglable devient un sous-menu — « Effort par défaut », puis ses niveaux —, qui
  ouvre `claude --model <id> [--effort <niveau>]`. « Claude avec l'effort » ouvre
  `claude --effort <niveau>` sur le modèle par défaut.

## 5. Ce qui n'est pas fait

- Le défaut des nouvelles sessions ne se règle pas depuis la barre : Réglages ›
  Claude Code le fait.
- Un sélecteur dont Claude Code changerait les libellés arrêterait le geste, sans
  rien changer : c'est voulu.

## Plan

1. `lib/claude-picker.ts` et ses tests ; `screenRows`.
2. `state/claude-picker.ts` ; la barre flottante et son avis.
3. Le menu `+`.
4. Guide (`terminaux.md`), traductions, piste à jour.
