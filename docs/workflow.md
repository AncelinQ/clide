# Plan d'implémentation

Portage standalone solo de ClaudeTerm (app macOS de Jérôme Laval) vers Windows, pour se
passer de WebStorm avant l'échéance de licence de juin 2027.

Ce document ordonnance le travail et garde les mesures qui ont tranché les arbitrages.
L'état d'avancement vit dans le [README](../README.md).

## 1. Ce qui est déjà validé sur le poste cible

Mesuré, pas supposé :

| Élément | Résultat |
|---|---|
| node-pty 1.1.0 | prebuild `win32-x64`, installé en 10 s, **aucun Visual Studio Build Tools** |
| ConPTY | duplex OK, pwsh 7, séquences ANSI, `resize` |
| Intégration shell | OSC 7 (cwd) et OSC fin-de-commande reçues, codes `[0,0,0,1]` — l'échec est détecté |
| `file-history` | `backup.backupFileName` résolu sur disque (`d3a39404d153ac8f@v1`, 5698 o) |
| Corpus transcripts | 75 fichiers (63 racine + 12 sous-agents), 221 Mo, 103 097 lignes, **0 ligne illisible** |
| Parsing | plus gros transcript (18,2 Mo) parsé en 116 ms |

Le pari technique du portage — remplacer l'intégration zsh/`ZDOTDIR` par PowerShell — est tenu.

## 2. Deux découvertes qui modifient le plan

### 2.1 La surface du parser est plus large que prévu

22 types d'events, dont 8 qu'aucune spec n'annonçait :

```
assistant 27200   attachment 23811   user 17158      atis-latch 5067
mode 5061         last-prompt 5010   ai-title 4504   permission-mode 4250
bridge-session 2141  system 2075     pr-link 2009    file-history-delta 1098
file-history-snapshot 1042  agent-name 958           queue-operation 663
relocated 439     worktree-state 438  frame-link 126  cost-state 34
artifact-autoreact-ledger 7  continued-in 3  artifact-comment-monitor 3
```

Trois ont des conséquences directes sur les panneaux :

- **`relocated` (439)** — une session change de chemin projet en cours de route. L'History
  ne peut pas indexer une session par son dossier d'origine.
- **`continued-in` (3)** — les sessions se chaînent. Reprendre une session doit suivre la chaîne.
- **`worktree-state` (438)** — l'usage des worktrees est massif chez l'utilisateur.
  ClaudeTerm ne les gère pas ; c'est une **fonctionnalité à ajouter**, pas à porter.
- **`agent-name` (958)** — les sous-agents ont leurs propres transcripts, dans
  `<sessionId>/subagents/agent-*.jsonl` : 12 fichiers imbriqués qu'un parcours à plat rate.
  Le reader doit descendre récursivement, et Activity doit pouvoir ouvrir la session d'un
  sous-agent. Non couvert par l'original.

67 outils distincts apparaissent dans les transcripts (dont une trentaine de MCP). Le panneau
Activity doit donc avoir un **rendu générique d'outil** avec spécialisations optionnelles,
jamais un rendu par outil.

### 2.2 Un index est obligatoire, alors que l'original n'en avait pas besoin

Sur macOS, ClaudeTerm lisait `sessions-index.json` pour peupler l'History. Ce fichier
n'existe pas ici. Reconstruire la liste exige de parcourir 240 Mo : **17 s mesurées** à
froid, lecture et projection comprises — inacceptable à chaque ouverture de panneau.

**Conséquence : une tâche d'indexation persistante entre au plan (A3b), absente du design
d'origine.** Invalidation sur `mtime` + taille, reconstruction incrémentale.

## 3. Structure : deux voies parallèles

`core/` n'a besoin ni du PTY ni d'Electron. Le terminal n'a besoin d'aucun parser.
Les deux voies se développent en parallèle et convergent à l'intégration.

```
Étape 0 ─┬─> VOIE A : core/ (TypeScript pur, TDD)  ─┐
         └─> VOIE B : terminal (Electron + ConPTY) ─┴─> INTÉGRATION ─> PACKAGING
```

La voie A porte la valeur et le risque. La voie B est du câblage déjà prototypé.

## 4. Tâches

### Étape 0 — Amorçage

| ID | Tâche | Dép. | Fait quand |
|---|---|---|---|
| T0.1 | **Accord de Jérôme sur la licence PolyForm** | — | réponse écrite obtenue |
| T0.2 | Repo, pnpm workspace, TS strict, vitest | — | fait — 54 tests, `./claude-ide` |
| T0.3 | Code OSC privé | — | fait — **OSC 7771** (1337 iTerm2, 633 VS Code, 133 FinalTerm, 7770 ClaudeTerm sont pris) |

T0.1 est un **prérequis non technique** : usage personnel probablement couvert, diffusion à
des collègues non. Le régler avant d'investir, pas après.

### Voie A — `core/`

| ID | Tâche | Dép. | Fait quand |
|---|---|---|---|
| A1 | Fixtures anonymisées depuis les 75 transcripts réels | T0.2 | fait — 22 types représentés |
| A2 | `TranscriptReader` : parcours **récursif** (sous-agents), tail incrémental, ligne partielle, ligne invalide non fatale | A1 | fait — rejoue le corpus sans exception |
| A3 | `SessionProjection` : reduce pur, gère `relocated`, `continued-in` et le rattachement des sous-agents | A2 | fait |
| A3b | **Index persistant** des sessions, invalidation mtime+taille, incrémental | A3 | fait — 65 sessions listées en 8 ms à chaud |
| A4 | `FileHistoryResolver` + diff (backup vN vs fichier courant, création vs vide) | A3 | fait — 513 diffs calculés sur 25 sessions, 0 sauvegarde introuvable |
| A5 | `SkillStore` : skills projet et perso, 3 modes d'invocation | T0.2 | fait — 31 commandes et les skills perso inventoriés |
| A6 | `McpStore` : scopes projet/local/user, secrets masqués | T0.2 | fait — les 8 MCP globaux listés, jetons masqués |
| A7 | `SettingsEditor` via `jsonc-parser`, éditions chirurgicales | T0.2 | fait — **G2 franchi** |
| A8 | `ScriptStore` : package.json, workspaces, gestionnaire déduit du lockfile | T0.2 | fait — **npm** détecté sur les 12 projets, pas pnpm |
| A9 | `LinkStore` : projets liés via `additionalDirectories` | T0.2 | fait — aller-retour stable, permissions préservées |

### Voie B — terminal (serveur local, Electron reporté)

**Electron n'est pas au départ.** Le critère n'est pas le poids du binaire mais l'endroit
où tourne `core/` : 2028 lignes qui importent `node:fs`. Tauri ou Wails obligeraient à le
réécrire en Rust ou en Go, ou à lui coller un sidecar Node. Electron et un serveur local
le font tourner tel quel — et **le serveur local est ce qu'Electron encapsulerait de toute
façon**. On le construit donc d'abord, et l'emballage devient une décision réversible,
prise quand l'outil sera robuste.

Ce que ça retire du chemin critique : le packaging, la signature, SmartScreen. Ce que ça
coûte : la pastille de barre des tâches, les raccourcis globaux, et le glisser-déposer
depuis l'Explorateur Windows — le glisser depuis le Finder de l'app et le dépôt d'images
fonctionnent, eux, en passant par le serveur.

node-pty est compilé en N-API (`node-addon-api`), son ABI est donc stable de Node à
Electron : l'emballage ultérieur ne demandera aucune recompilation.

| ID | Tâche | Dép. | Fait quand |
|---|---|---|---|
| B1 | Serveur HTTP + WebSocket, protocole typé, API adossée à `core/` | T0.2 | fait — jeton d'accès + refus d'origine tierce |
| B2 | `PtyManager` : spawn, resize, kill, cycle de vie | B1 | fait — testé sous ConPTY réel |
| B3 | Hôte xterm.js dans le navigateur, resize, thème | B1 | fait — shell utilisable au clavier |
| B4 | Profil PowerShell chaînant le prompt existant + parseur OSC | B2, T0.3 | fait — prompt existant chaîné, jamais remplacé |
| B5 | Onglets : état idle / running / failed, réutilisation du shell inactif | B4 | fait |
| B6 | Emballage Electron | C8 | **optionnel, décidé à l'usage** |

B4 porte le seul risque restant de la voie B : **ne pas casser le prompt de l'utilisateur.**
Le profil capture `$function:prompt` et le rappelle, il ne le remplace pas.

### Intégration

| ID | Tâche | Dép. | Fait quand |
|---|---|---|---|
| C1 | Fenêtre : barre projets, colonne gauche, centre, panneau droit | A3, B5 | fait — trois colonnes, onglets, barre d'état |
| C2 | Panneaux History et Activity | C1, A3b | fait — 65 sessions ; flux d'activité avec rendu générique d'outil |
| C3 | Panneau Files avec diff par session | C1, A4 | fait — diffs affichés, créations comprises |
| C4 | Panneaux Skills, MCP, Settings, Scripts, Liens | C1, A5–A9 | fait — lecture et écriture |
| C5 | Panneau Processes, `Win32_Process`, liens `owned` / `inferred` | C1 | fait — 5 racines Claude, 214 processus ; arrêt refusé hors arbre |
| C6 | Notifications : hooks `Notification` / `Stop`, pastille d'onglet | C1, A7 | fait — routage par dossier, notification système cliquable |
| C7 | Panneau Plan | C1 | fait — plan lu dans `ExitPlanMode` ; le mode plan n'apparaît nulle part dans le corpus |
| C8 | Démarrage en un clic | C2–C6 | fait — `claude-ide.cmd`, ouverture du navigateur comprise |

## 5. Ordre d'exécution

```
T0.1 (licence, en parallèle de tout)
T0.2 ──┬── A1 ─ A2 ─ A3 ─┬─ A3b ──────────────┐
       │                 └─ A4 ───────────────┤
       │   A5 A6 A7 A8 A9 (parallélisables) ──┤
       │                                      ├─ C1 ─┬─ C2 ─┐
       └── B1 ─┬─ B2 ─ B4 ─ B5 ───────────────┘      ├─ C3 ─┤
               └─ B3 ────────────────────────────────┼─ C4 ─┼─ C8
                                                     ├─ C5 ─┤
                                                     ├─ C6 ─┤
                                                     └─ C7 ─┘
```

**Chemin critique : T0.2 → A1 → A2 → A3 → A3b → C1 → C2 → C8.**
Tout le reste a du mou. Si le temps manque, C5, C6 et C7 se coupent sans dommage —
l'app reste utilisable sans panneau Processes.

## 6. Points de contrôle

| # | Après | Critère — binaire, pas d'appréciation |
|---|---|---|
| **G1** | A3 | Rejouer les 75 transcripts, sous-agents inclus : zéro exception, et un rapport listant les types inconnus rencontrés. Un type inconnu n'est pas un échec, une exception si. |
| **G2** | A7 | **Franchi** — sur le `settings.json` réel (46 lignes), une modification n'en change qu'une : celle visée. Hooks identiques. |
| **G3** | C2 | Lancer une session Claude dans l'app, la fermer, la retrouver dans History par son titre, la reprendre. |
| **G4** | C3 | Sur une session ayant modifié 3 fichiers, le diff affiché correspond à `git diff` — écarts expliqués. |
| **G5** | C8 | 3 projets ouverts, une session Claude active dans chacun, pendant 2 h de travail réel, sans fuite mémoire ni onglet fantôme. |

G2 est le point de contrôle le plus important du plan : c'est le seul endroit où un bug
détruirait une configuration existante.

## 7. Estimation

Jours-homme **effectifs** (temps concentré, hors calendrier) :

| Bloc | j-h |
|---|---|
| Étape 0 | 1 |
| Voie A (dont A3b index : 1 j) | 12 |
| Voie B | 6 |
| Intégration | 13 |
| **Total** | **~32, fourchette 30–40** |

Repères de calibrage : l'original fait 5 000 lignes de Swift plus 450 de tests, et la couche
UI est intégralement à réécrire. La fourchette haute suppose que le panneau Plan trouve sa
source et que les worktrees soient traités.

Avec 21 mois avant l'échéance de licence, **le calendrier n'est pas une contrainte.** Inutile
de compresser : la seule urgence réelle est T0.1.

## 8. Risques

| Risque | Probabilité | Parade |
|---|---|---|
| Le format des transcripts change en cours de route | élevée — il a **déjà** changé | A2 tolérant par construction, G1 rejoué à chaque montée de version de Claude Code |
| Diffusion à des collègues bloquée par PolyForm | moyenne | T0.1 en premier ; à défaut, usage strictement personnel |
| Le panneau Plan reste sans source | moyenne | C7 isolé derrière une interface, coupable sans impact |
| Injection du profil casse le prompt utilisateur | faible | B4 chaîne le prompt existant, testé avec oh-my-posh |
| SmartScreen au premier lancement | **écartée** | plus de binaire à signer tant qu'Electron n'est pas là |
| Perf : rejeu complet du corpus à 17 s | **avérée** | A3b indexe et n'en relit que le delta ; un transcript isolé reste à ~116 ms |

## 9. Hors périmètre

- Éditeur de code : l'app ouvre les fichiers dans l'éditeur système. La sortie de WebStorm
  passe par VS Code et DBeaver, traitée séparément.
- Support macOS : le `core/` reste pur pour ne pas fermer la porte, mais rien n'est fait pour.
- Gestion des worktrees : identifiée comme un besoin réel (438 events) mais **non incluse** —
  à arbitrer comme une évolution après C8.

**Étape suivante : `/sc:implement` sur A1 puis A2.** Le cœur se construit sans Electron,
sans PTY et sans Windows — donc sans aucun des risques du portage.
