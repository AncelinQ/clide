# Personnaliser

Apparence, langue, police du terminal et raccourcis clavier.

## Thème

Sombre par défaut, clair quand le système le demande, et un bouton dans la barre
de titre qui force l'un ou l'autre. Le réglage explicite l'emporte sur le système,
et le suivi est immédiat — aucun rechargement.

Les couleurs sont des variables CSS, **y compris les seize couleurs ANSI du
terminal**. xterm peint sur un canevas et ne lit pas la feuille de style : sa
palette lui est repassée à chaque changement. Sans cela, le jaune et le cyan
réglés pour un fond noir deviennent illisibles sur blanc — c'est tout le terminal
qui suit l'apparence, pas seulement son fond.

## Langue

L'interface est en français ou en anglais, au choix dans les préférences, ou selon
la langue du système. Le français est la source, écrit tel quel dans le code : il se
lit à l'endroit où il s'affiche. L'anglais vient d'une table indexée par la chaîne
française ; une chaîne qu'elle n'a pas s'affiche en français plutôt que de
disparaître, et une phrase à trous passe par des marques `{nom}`, jamais par une
concaténation qui figerait l'ordre des mots. Ce qui est tapé dans un terminal ou
envoyé à Claude ne se traduit pas.

## Palette et raccourcis

`Ctrl+Maj+P` ouvre la palette : toute action de l'application, cherchée par mots et
lancée d'Entrée, avec son raccourci affiché — c'est ce qui les rend découvrables.

| Action | Raccourci |
|---|---|
| Palette de commandes | `Ctrl+Maj+P` |
| Nouveau shell · nouvel onglet Claude | `Ctrl+Maj+T` · `Ctrl+Maj+A` |
| Fermer l'onglet | `Ctrl+Maj+W` |
| Onglet suivant · précédent | `Ctrl+Maj+Page suiv.` · `Ctrl+Maj+Page préc.` |
| Projet suivant · précédent | `Alt+Page suiv.` · `Alt+Page préc.` |
| Ouvrir un projet | `Ctrl+Maj+O` |
| Replier le bloc session | `Ctrl+Maj+J` |
| Colonne du projet · panneau global | `Ctrl+Maj+B` · `Ctrl+Maj+E` |
| Capture d'écran vers le prompt | `Ctrl+Maj+S` |

Un terminal capte le clavier, et ces touches sont choisies pour ne rien lui voler :
`Ctrl+Maj` sur des lettres que ni PowerShell ni Claude Code n'utilisent ainsi —
jamais C ni V, qui copient et collent —, jamais `Ctrl+Alt`, qui est AltGr sur un
clavier français et sert à taper `€`, `[` ou `@`, et pas `Ctrl+Tab`, qu'un navigateur
ne laisse pas intercepter. La touche est prise en phase de capture, avant xterm :
elle n'atteint pas le shell, et la palette se ferme sans laisser de caractère. Une
combinaison qui n'est à aucune action passe au terminal telle quelle. Les
raccourcis se changent dans les préférences ; une combinaison déjà prise est
retirée à l'autre action, et le dialogue le dit.

## Préférences

Le bouton de réglage de la barre de titre ouvre les préférences propres à
l'application, rangées avec le thème dans sa configuration — jamais dans
`settings.json`, qui appartient à Claude Code. Elles portent pour l'instant la
police du terminal et sa taille, appliquées aussitôt aux terminaux ouverts, et les
raccourcis.

Une page ne peut pas lister les polices installées : la liste est faite de
polices à chasse fixe courantes, dont on ne garde que celles qui changent la
largeur d'un texte par rapport à deux polices proportionnelles.
