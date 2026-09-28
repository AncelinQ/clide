# La session

Le bloc sous le terminal montre la session de l'onglet actif, ou celle choisie dans History. Ses modes — plan, activité, captures, fichiers, schéma, rédaction — se choisissent par ses icônes, et `ⓘ` dit à quoi sert le mode courant.

Son menu « ⋯ » masque les modes dont on ne se sert pas : ils y restent
accessibles, et le mode ouvert garde son icône tant qu'on ne le quitte pas. Le bloc
de la colonne du projet a le même menu, et chaque bloc garde son propre choix.
Activité, Captures et Fichiers ont un bouton ⇅ qui met les plus récents en haut,
retenu mode par mode.

## La session d'un onglet

Un `claude` tapé dans un shell fait de l'onglet un onglet Claude le temps de la
session, puis le rend au shell. C'est la fonction `claude` du profil qui le
signale — elle est ce qui lance Claude — par deux marqueurs, `CLAUDE_START` avec
la ligne de commande et `CLAUDE_END`, ce dernier émis dans un `finally` pour qu'un
Ctrl+C ou un échec ne laisse pas l'onglet en mode Claude. Chaque lancement repart
de zéro dans le suivi de session, sur la session neuve ou celle que nomme
`--resume`.

Le bloc session suit l'onglet Claude actif. Choisir une session dans History l'en
détache — sauf si c'est justement celle de l'onglet actif, qu'il continue de
suivre — et le bloc le dit : une puce « détaché » dans son en-tête, qui ramène
à l'onglet d'un clic ; un clic sur un onglet de terminal rattache aussi. Le serveur relie chaque onglet Claude à son transcript, puis le
lit par ajouts :

- **par les hooks**, quand ils sont installés : `SessionStart` donne la session
  et son transcript dès le démarrage, puis à chaque `/clear` ou reprise. L'onglet
  est reconnu à la variable `CLIDE_TERMINAL_ID` que Clide lui donne et que
  `claude` transmet à ses hooks : deux onglets du même dossier ne se confondent
  pas, et une session lancée hors de Clide dans ce dossier ne rattache rien ;
- **sinon, par le fichier créé** dans le dossier du projet après l'ouverture de
  l'onglet, hors de ceux qu'un autre onglet suit, les onglets servis du plus
  récent au plus ancien — un transcript créé après l'ouverture du dernier est
  le sien. La date de modification ne sert pas : toute session active dans le
  même dossier, lancée ailleurs, écrit sans cesse dans le sien, et serait prise
  avant que la nouvelle ait créé son fichier ;
- **par la commande**, pour `claude --resume <id>` : le transcript nommé est suivi.
  Son mode n'est montré qu'une fois la reprise repartie, le transcript décrivant
  jusque-là la séance précédente.

La barre d'état porte le mode de permission, le mode plan et la taille du
contexte ; l'activité, la consommation de la session. Une réponse s'écrit en
plusieurs events qui répètent le même `message.id` et le même `usage` : les tokens
sont comptés une fois par réponse. Le bloc bascule sur Plan quand l'onglet regardé
entre en mode plan.

## Le détail d'une ligne

L'activité résume : un texte à 400 caractères, un appel d'outil à son champ le plus
parlant, et sans son résultat. Un double-clic sur une ligne l'ouvre en entier — le
prompt ou la réponse tels qu'écrits, la réponse rendue en markdown, ou l'appel
d'outil avec son entrée complète et ce qu'il a rendu, plafonné à 50 000
caractères. Le serveur reparcourt le transcript exactement comme pour l'activité :
le rang d'une ligne désigne toujours la même entrée, et la page ne demande que ce
rang. Cela vaut pour les sessions passées comme pour celle en cours.

« Voir dans le terminal » fait défiler l'onglet de la session jusqu'à la ligne et
la sélectionne. Son texte y est cherché — lignes repliées recollées, espaces et
casse ignorés — et, s'il revient plusieurs fois, compté depuis la fin : le début de
l'historique a pu être perdu, la fin jamais. Un prompt se retrouve tel quel, un
appel d'outil par sa forme `Bash(…)` ; une réponse, par ses premiers mots, le rendu
du markdown changeant le reste. Le terminal garde 10 000 lignes.

Trois cas l'empêchent, et la fenêtre dit lequel :

- **le mode plein écran.** Claude Code y dessine lui-même son écran, dans le
  tampon secondaire du terminal, qui n'a pas d'historique. Le saut demande
  l'interface `default` (Réglages → Interface), puis un onglet relancé ;
- **une ligne qui n'est plus affichée** : session reprise dans un nouvel onglet,
  `/clear`, compactage ;
- **une session sans onglet ouvert**, ou l'activité d'un sous-agent, que le
  terminal ne détaille pas.

## Deux faits du format vivant

Le mode d'un tour est porté par son prompt
(`user.permissionMode`) : l'event `permission-mode` est écrit à la fin du tour
précédent, et dit encore `auto` quand le prompt qui suit part en mode plan. Et
Claude Code ne l'écrit qu'aux tours : un Maj+Tab n'apparaît qu'au prompt suivant.

## Le plan d'une session

Le plan a deux sources. L'appel à `ExitPlanMode` porte le texte soumis à
validation. En mode plan, Claude Code annonce aussi, par une pièce jointe
`plan_mode`, le fichier de `~/.claude/plans` où il le rédige : le plus récent des
deux l'emporte, et seul un fichier sous ce dossier est lu. Le dossier n'existe
qu'une fois un plan écrit. Une session peut repasser en mode plan et en proposer un
autre : le dernier décrit le travail en cours.

Le plan est rendu en markdown, sans HTML brut : un texte produit par un modèle ne
doit pas pouvoir injecter de balise dans la page.

Le panneau distingue trois situations, parce qu'elles n'appellent pas la même
réaction : un plan, une session passée en mode plan sans en soumettre, et une
session qui n'y est jamais passée. Le mode se lit sur le prompt de chaque tour et
sur la pièce jointe `plan_mode` ; l'event `mode`, qui vaut `"normal"` à chaque
tour, ne dit rien des permissions.

## Sous-agents

Dans l'activité d'une session, un appel `Agent` dont le sous-agent a laissé un
transcript porte « ouvrir ». Son activité remplace alors celle de la session, sous
un fil « session › description du sous-agent » ; « remonter » revient d'un cran, et
un sous-agent lancé par un sous-agent s'ouvre de la même façon.

Le lien vient de `toolUseResult.agentId`, écrit sur le résultat de l'appel, et le
transcript se retrouve sous `<session>/subagents/agent-<agentId>.jsonl`. Le client
ne donne que la session et l'identifiant : le serveur cherche le transcript parmi
ceux qu'il a découverts, jamais par un chemin reçu.

## La file d'attente

Un prompt tapé pendant que Claude travaille part dans sa file. Elle se reconstitue en
rejouant les `queue-operation` du transcript : `enqueue` ajoute le texte, `remove`
retire celui qu'absorbe le tour en cours, `dequeue` prend le premier, `popAll` vide
tout. La file de l'onglet regardé s'affiche au-dessus du bloc session, et un prompt
s'y ajoute en le tapant dans l'onglet ; retirer n'est pas offert, Claude Code ne
l'exposant pas. En pratique la file vit quelques secondes : la plupart des prompts
sont absorbés par le tour en cours.

## Restaurer un fichier

L'onglet Fichiers liste ce que la session a changé, avec le diff exact. Chaque
fichier se replie par son chevron, et « Tout replier » ou « Tout déplier »
agissent sur la liste ; une autre session repart dépliée. L'ordre est alphabétique,
ou, avec ⇅, du fichier le plus récemment touché au plus ancien, daté par sa dernière
sauvegarde dans l'historique de fichiers de Claude Code.

Un clic sur le chemin ouvre le fichier avec l'application par défaut ; Maj+clic
le montre dans l'Explorateur. Le serveur n'ouvre que les fichiers de la session
— le chemin vient de la page, il ne désigne rien d'autre — et, comme depuis
l'explorateur du projet, montre au lieu d'ouvrir ce que Windows exécuterait. Un
fichier supprimé n'a plus rien à ouvrir : son chemin reste du texte.

Un fichier écrit par une commande Bash y figure aussi, marqué « commande » : son
diff est celui que Claude Code relève dans le résultat de la commande, faute de
sauvegarde. Un fichier touché par les deux garde le diff de sa sauvegarde, et les
morceaux des commandes à la suite. Sans sauvegarde, rien ne se restaure.

Dans l'onglet Fichiers d'une session, « restaurer » ramène un fichier à son état
d'avant la session, tiré de la première sauvegarde que Claude Code en a prise
(`~/.claude/file-history/<session>/`). La fenêtre montre d'abord ce qui sera
perdu et ce qui revient ; rien ne s'écrit sans ce passage.

Le serveur refuse :

- un fichier modifié plus de cinq secondes après la dernière écriture de la
  session — le délai laisse passer un formateur lancé par un hook, pas une
  retouche à la main, qu'on perdrait ;
- un fichier que la session n'a écrit par aucun outil d'édition réussi ;
- une session qui tourne dans un onglet, ou qui a écrit il y a moins de deux
  minutes ;
- un fichier qui a changé depuis l'aperçu : l'empreinte qu'il a montrée doit être
  celle qu'on écrase.

Le contenu remplacé est copié dans `restores/<session>/<horodatage>/` des données
de l'application ; un fichier créé par la session part à la corbeille de Windows.
L'écriture passe par un fichier temporaire renommé : jamais de fichier à moitié
écrit. Les écritures d'un sous-agent comptent : ses appels d'outils sont lus dans
son transcript.

## Captures

Les images que porte un transcript — une capture qu'un outil a rendue
(`browser_take_screenshot`, un `Read` sur un PNG), une image collée dans un prompt
— s'affichent en vignettes sous leur entrée de l'activité ; un clic les montre en
grand. L'onglet Captures les rassemble dans l'ordre du temps, sous-agents compris,
et chacune s'ouvre à sa place dans l'activité.

Seuls les PNG, JPEG, GIF et WebP sont montrés. Le flux d'activité ne porte que leur
nombre : le contenu, souvent des centaines de Ko en base64, se charge par entrée
quand la vignette approche de l'écran.

## Schéma de la session

Le mode Schéma du bloc session fait dessiner par `claude -p` un diagramme Mermaid
de ce que la session a changé : chaque nœud nomme un changement, et les liens
disent comment ils s'articulent. Rien ne part sans un clic — l'appel coûte des
tokens, environ 0,15 $ pour une session de cent fichiers — et le schéma obtenu est
gardé dans `diagrams/<session>.json` des données de l'application jusqu'à ce qu'on
le refasse.

Claude lit un résumé de la session : ses demandes, la liste des fichiers changés
et leurs diffs, le tout plafonné à 60 000 caractères, chaque diff réduit à sa part
pour qu'un gros fichier n'efface pas les autres. Le schéma dit quand ce résumé a
dû couper.

L'appel est isolé : ni outil, ni serveur MCP, ni réglage — donc aucun hook —, pas
de session enregistrée qui encombrerait History, le modèle Sonnet et une dépense
plafonnée à 1 $. Le rendu se fait en `securityLevel: "strict"`, et la
bibliothèque Mermaid ne se charge qu'au premier schéma montré.

## Message de commit et description de MR

Le mode Rédaction fait rédiger par `claude -p`, sur le même résumé et avec le même
isolement que le schéma, un message de commit ou une description de merge
request. Le message de commit suit la convention des quinze derniers commits du
dépôt — type, portée, langue — ; la description de MR, dans la langue de
l'interface, donne pourquoi, ce qui change et comment tester. Environ 0,15 $
chacun pour une session de cent fichiers, gardés dans `writeups/` jusqu'à ce qu'on
les refasse.

Rien n'est écrit dans git : le texte se copie et se relit avant de commiter. Comme
dans l'onglet Fichiers, l'état « après » d'un fichier est son contenu actuel sur le
disque : rédigé pour une session ancienne, le brouillon compte aussi ce qui a
changé depuis. Il sert d'abord à la session en cours, avant son commit.
