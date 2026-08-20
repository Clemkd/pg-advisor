# Intention de design — PostgreSQL Advisor

Ce document est le contrat de l'interface. Il énonce d'abord l'usage, puis les règles qui en
découlent. Chaque règle est justifiée par l'usage : si une règle ne sert aucun usage décrit
ici, elle n'a pas lieu d'être et doit être discutée plutôt qu'appliquée.

Il s'adresse à qui écrit une vue. Les jetons et les primitives citées existent : `src/index.css`,
`src/components/ui/**`, `src/components/layout/**`. La section **Migration des vues**, en fin de
document, liste ce qui doit être repris vue par vue.

---

## 1. L'usage

Un Advisor PostgreSQL en lecture seule qui supervise N instances, calcule un score de santé et
produit des diagnostics depuis un moteur de règles YAML. Trois traits commandent tout le
reste.

**La fréquence d'usage est très inégale.** Elle décide de la densité, et elle seule.

| Famille | Vues | Usage réel |
|---|---|---|
| **Balayage** | Vue d'ensemble, Diagnostics | Quotidien, en diagonale, parfois dans l'urgence |
| **Étude** | Requêtes, plan d'exécution | Session longue et concentrée sur un seul objet |
| **Installation** | Instances, Règles, Notifications, Comptes, Mon profil | Rare : à l'installation, puis à l'occasion |
| **Établi** | Éditeur de règle | Écrire du YAML, l'exécuter à blanc, lire le résultat |

**L'outil reste ouvert et se met à jour seul**, par flux SSE, souvent sur un second écran. Ce qui
change doit se remarquer sans qu'on fixe l'écran ; ce qui ne change pas ne doit pas attirer l'œil.

**L'utilisateur n'agit pas depuis l'outil.** Le principe zero-touch veut que l'Advisor ne corrige
rien : il donne à lire un diagnostic, des mesures et une commande à exécuter ailleurs. L'unité de
travail est « comprendre un diagnostic et décider quoi en faire », jamais « cliquer sur un bouton
d'action ».

---

## 2. Cinq principes

1. **La fréquence commande la densité.** Une vue quotidienne se compacte pour tenir sous l'œil ;
   une vue annuelle s'explique. Aucune vue n'a la densité d'une autre famille.
2. **Ce qui change se signale, ce qui dure se tait.** Sur un second écran, une valeur qui se
   remplace en silence est une information perdue. Le changement porte une marque qui survit à
   l'instant où il se produit.
3. **Ce qui se lit prime sur ce qui se clique.** L'objet de la page est un diagnostic, pas une
   commande. Les boutons se rangent, le texte du diagnostic occupe le centre.
4. **Une seule échelle.** Toute taille, tout écart, toute hauteur de contrôle sort des tableaux du
   § 3. Une valeur hors échelle est un défaut, pas une nuance.
5. **Le violet de marque ne dit jamais un état.** Il ne signale que ce avec quoi on interagit.
   Un état se dit en vert, ambre, rouge ou bleu, et jamais par la couleur seule.

---

## 3. Jetons

Tout passe par les jetons. Aucune couleur en dur : ni `bg-white`, ni `text-gray-500`, ni
`dark:bg-slate-800`. Les deux thèmes sont tenus par les mêmes classes — une classe qui a besoin
d'un `dark:` est le signe qu'un jeton manque.

### 3.1 Couleur

**Surfaces** — `canvas` (fond de l'application) < `surface` (carte) < `surface-raised` (bulle,
modale) ; `surface-sunken` pour ce qui est en creux : bloc de code, en-tête de tableau, piste de
jauge. **Bordures** — `border-subtle` sépare, `border-strong` entoure un contrôle.

**Encre** — `ink` pour toute valeur et tout contenu ; `ink-muted` pour tout le reste du texte :
étiquette, indication, unité, décompte. **`ink-faint` ne porte jamais de texte à lire** — il est
réservé aux chevrons, aux icônes décoratives, aux séparateurs et au texte indicatif d'un champ
vide. La raison est mesurée : sur la surface claire, `ink-faint` plafonne autour de 4,3:1, ce qui
ne suffit pas à une étiquette de 11 px, quand `ink-muted` tient 6:1.

**Interaction** — `brand` et lui seul : lien, action principale, entrée de navigation active,
option sélectionnée. Réserve stricte : voir le principe 5.

**État** — `success`, `warning`, `danger`, `info`, chacun avec deux déclinaisons : `-subtle` pour
le fond, `-strong` pour l'encre posée dessus. Le jeton nu sert à remplir une pastille ou tracer une
jauge ; employé comme encre sur son propre fond clair, il tombait sous 3,5:1. Le couple
`-subtle` / `-strong` tient 6,3:1 au minimum en thème clair et 8:1 en sombre.

`info` est un bleu, distinct du violet de marque : sans quoi un diagnostic d'information se
lit comme un bouton.

**Sévérité** — `severity-critical` → `danger`, `severity-warning` → `warning`,
`severity-info` → `info`. La correspondance est faite une fois dans `SeverityBadge` ; aucune vue
ne redécide d'une couleur de sévérité.

**Fraîcheur** — `fresh` marque ce qui vient de changer (§ 6).

**Code** — `code-key`, `code-string`, `code-number`, `code-type`, `code-param`. Jetons distincts
des couleurs d'état : ceux-ci sont calibrés pour porter du texte sur fond creusé, pas pour remplir
une pastille.

### 3.2 Typographie

Six tailles. Le défaut est `text-body`, pas `text-meta` — l'interface se lit à 14 px.

| Jeton | Taille | Graisse | Emploi |
|---|---|---|---|
| `text-display` | 32 px | 600 | Le score global. Une fois par page, au plus |
| `text-title` | 18 px | 600 | Titre de page. Un seul, posé par `Page` |
| `text-section` | 15 px | 600 | Titre de carte, titre de modale |
| `text-body` | 14 px | 400 | **Défaut.** Toute valeur, tout contenu, toute ligne de tableau |
| `text-meta` | 12 px | 400 | Ce qui accompagne : horodatage, aide, décompte, sous-titre |
| `text-micro` | 11 px | 600, capitales, interlettrage | **Étiquette seulement** |

**Règle d'or : une valeur ne descend jamais sous `text-body`, et n'est jamais plus petite que son
étiquette.** L'état constaté était l'inverse — 120 emplois de `text-xs` contre 47 de `text-sm` —
et produisait des vues où rien ne ressort parce que tout est petit. Le 12 px accompagne, le 11 px
étiquette, le 14 px dit.

`text-micro` ne porte jamais de phrase : en capitales, un libellé anglais 30 % plus long devient
illisible avant de déborder.

**Chiffres.** Toute valeur numérique destinée à être comparée d'une ligne à l'autre porte
`tabular-nums` : sans quoi les colonnes de nombres ne s'alignent pas et un tableau de mesures
cesse d'être balayable.

### 3.3 Espacement

Échelle utile : **4, 8, 12, 16, 24, 32 px** — soit `1, 2, 3, 4, 6, 8`. Les demi-crans
(`1.5`, `2.5`) sont réservés au calage optique *à l'intérieur* d'une primitive ; ils n'apparaissent
pas dans la mise en page d'une vue.

| Écart | Valeur |
|---|---|
| Entre deux blocs d'une page | `space-y-4` (16) |
| Gouttière d'une grille de cartes | `gap-4` (16) |
| Entre deux champs d'un formulaire | `gap-3` (12) |
| Gouttière intérieure d'une carte | **16 px**, en-tête, corps et lignes de liste confondus |
| Entre un libellé et sa valeur | `gap-1` (4) |

La gouttière de carte est unique et vaut pour l'en-tête comme pour le corps : l'état constaté
mélangeait `px-5` en en-tête et `p-4` en corps, si bien que rien ne s'alignait verticalement d'un
bloc à l'autre. Les vues d'installation gagnent leur air par le rythme vertical et l'espacement des
champs, jamais par une gouttière plus large — une gouttière unique tient plus sûrement sur dix vues.

La marge extérieure de page est posée une fois par la coquille. Une vue n'ajoute jamais la sienne.

### 3.4 Contrôles, rayons, ombres

**Trois hauteurs, et trois seulement.**

| Taille | Hauteur | Emploi |
|---|---|---|
| `sm` | 32 px | Barre de filtres dense, filtre de colonne. Pointeur uniquement |
| `md` | 36 px | **Défaut.** Aligné sur `Input`, `Select`, `MultiSelect` |
| `lg` | 44 px | Action principale d'un formulaire d'installation, et tout contexte tactile |

Le défaut passe à 36 px pour une raison mesurable : un `Button` était haut de 32 px et un `Input`
de 36, si bien que toute barre associant les deux était désalignée de 4 px. Un bouton à icône seule
fait 36 × 36 au minimum, glyphe de 16 px — jamais moins, c'est la cible de clic.

**Rayons** — `--radius-card` pour une surface, `--radius-control` pour un contrôle, `rounded-full`
pour une pastille. `rounded-md` et `rounded-lg` ne s'emploient pas.

**Ombres** — `shadow-card` pour une carte posée sur le fond, `shadow-popover` pour ce qui flotte.
Rien d'autre ; en particulier, une carte ne prend pas d'ombre au survol : elle n'est pas cliquable.

### 3.5 Mouvement

`--motion-fast` (120 ms) pour un survol ou un focus, `--motion-base` (200 ms) pour un dépliement,
`--motion-fresh` (6 s) pour la décroissance du signal de fraîcheur.

Tout mouvement est neutralisé sous `prefers-reduced-motion: reduce` — la règle est posée une fois
dans `index.css` et n'a pas à être répétée. Le signal de fraîcheur, lui, ne disparaît pas dans ce
cas : il devient statique (§ 6). Un signal d'information ne se supprime pas au motif qu'on refuse
l'animation.

---

## 4. Densités

Trois densités, une par famille de vue. Elles se choisissent, elles ne se dosent pas.

### Balayage — Vue d'ensemble, Diagnostics

Lu tous les jours, en diagonale, parfois pendant un incident. La question posée est *« qu'est-ce
qui a changé, et qu'est-ce qui est grave ? »* — pas *« quelle est la valeur exacte de ce
paramètre ? »*.

- Ligne de liste : **hauteur minimale 40 px**, gouttière 16 px, deux niveaux de texte au plus —
  un titre en `text-body`, un accompagnement en `text-meta`. Une troisième ligne par élément coûte
  un écran entier sur trente diagnostics.
- Barre de filtres en `Toolbar` : contrôles `sm`, sur une seule ligne, jamais repliée en bloc.
- **Un point d'entrée par écran, et un seul** : le chiffre qui commande la lecture — score global,
  nombre de critiques — en `text-display`, teinté par sa valeur. Tout le reste lui est
  hiérarchiquement inférieur. Une grille de quatre tuiles identiques n'a pas de point d'entrée :
  l'œil doit lire les quatre libellés pour savoir laquelle compte.
- Tri par défaut : le plus grave d'abord, puis le plus récent. C'est l'ordre de la question posée.
- Aucune information à révéler au survol : sur un second écran, personne ne survole.

### Étude — Requêtes, plan d'exécution

Session longue sur un seul objet. La surface appartient à l'objet.

- L'objet étudié — texte SQL, nœud de plan — occupe la hauteur disponible, mesurée par
  `useFillHeight` et non budgétée en `calc()` : un filtre qui change de hauteur fausse un budget.
- Le chrome se compacte : contrôles `sm`, en-têtes sur une ligne, filtres de colonne intégrés à
  l'en-tête du tableau plutôt qu'en barre séparée.
- Ce qui défile est le bloc, jamais la page. Une session d'investigation qui perd sa barre de
  filtres au défilement oblige à remonter à chaque changement de critère.
- Le monospace est de rigueur pour tout SQL, tout identifiant d'objet et toute mesure de plan.

### Installation — Instances, Règles, Notifications, Comptes, Mon profil

Vues rares. Un utilisateur qui y revient après six mois ne se souvient de rien : elles doivent être
explicites, pas compactes.

- Formulaire sur **une colonne**, champs en `gap-3`, contrôles `md`, action principale `lg`.
- Chaque champ porte une indication (`hint`) qui dit la conséquence, pas la syntaxe : « l'Advisor
  ouvre la session en lecture seule » plutôt que « chaîne de connexion ».
- Les groupes de champs sont nommés par `FormSection`. Un formulaire de dix champs se lit comme
  trois ensembles courts.
- Les états vides portent le geste attendu, pas un constat : « Ajouter une instance » et non
  « Aucune instance ».
- La densité de liste peut monter à 56 px par ligne : ces listes sont courtes et se lisent une fois.

### Établi — Éditeur de règle

Écrire, exécuter à blanc, lire le résultat, recommencer. La boucle doit être courte.

- L'éditeur occupe la hauteur disponible ; le résultat d'exécution s'affiche à côté ou dessous
  sans jamais remplacer l'éditeur — perdre le texte qu'on vient d'écrire pour lire son résultat
  interdit la comparaison.
- Exécution à blanc atteignable au clavier, et le raccourci est affiché sur le bouton.
- Le résultat d'une exécution ne remplace pas le précédent en silence : il porte le signal de
  fraîcheur (§ 6).
- Les erreurs de validation se posent au plus près de la ligne fautive, et jamais uniquement en
  haut de page.

---

## 5. Anatomies

### Page

`Page` pose le titre, la marge et la largeur. Une vue ne redéclare ni l'un ni les autres.

```
[ Titre ] [ descriptif ] [ méta ]                      [ actions ]
[ avertissements éventuels ]
[ contenu, en space-y-4 ]
```

Titre en `text-title`, un seul par page, aligné sur la même ligne que le descriptif et la méta tant
qu'il y a la place : un en-tête de trois lignes vole un tiers de l'écran utile d'une vue de
balayage. `wide` retire la limite de lecture pour les vues qui alignent des tableaux.

### Carte

```
CardHeader : [ titre text-section ] [ description text-meta ]    [ action ]
CardBody   : contenu, gouttière 16
```

L'action d'un en-tête de carte est un `CardAction` — la même écriture partout, plutôt qu'un lien
rhabillé à chaque vue. Une carte ne porte jamais plus d'une action : au-delà, c'est un `SplitButton`.

### Tableau

Les tableaux passent par les primitives `Table`, `Th`, `Td` — sept tableaux étaient écrits à la
main, chacun avec ses paddings.

- En-tête en `text-micro`, collant (`sticky`) dès que le corps défile.
- Nombres alignés à droite, en `tabular-nums` (`<Td numeric>`). Texte à gauche. Jamais l'inverse.
- Colonne d'identité en premier, elle seule peut être large ; les mesures sont étroites et fixes.
- Ligne survolée teintée en `surface-sunken`, ligne sélectionnée en `brand-subtle`. Le survol ne
  révèle rien qui ne soit déjà lisible.
- Tri : une seule colonne à la fois, direction indiquée par une icône **et** par `aria-sort`.
- Débordement horizontal contenu par `TableScroll` : c'est le tableau qui défile, jamais la page.

**Filtrer et trier se font dans l'en-tête de la colonne concernée, jamais dans une barre à part.**
Une barre de filtres séparée oblige à rétablir mentalement le lien entre un contrôle et la colonne
qu'il gouverne, et coûte une carte entière de hauteur pour trois champs. Le contrôle posé dans son
en-tête supprime ce lien à établir et rend visible d'un coup d'œil ce qui est filtré.

Le contrôle se choisit selon la nature de la donnée, pas selon une règle uniforme :

| Donnée | Filtre | Tri |
| --- | --- | --- |
| Texte libre — nom, identifiant, description | zone de saisie (`FilterInput`) | alphabétique |
| Valeur énumérée — catégorie, origine, état | sélection multiple (`MultiSelect`) | alphabétique |
| Énumération ordonnée — sévérité, impact | sélection multiple | **selon l'ordre de gravité**, jamais l'alphabet |
| Mesure numérique | comparateur et seuil (`FilterInput` avec opérateur) | numérique |
| Colonne sans filtre pertinent | aucun contrôle, plutôt qu'un contrôle inventé | selon le cas |

Trois obligations : l'état filtré reste lisible menu fermé — un décompte ou une marque sur
l'en-tête concerné ; une action efface tout (`common.clearFilters`) ; et l'état vide distingue
« rien à afficher » de « rien ne correspond à ces filtres », qui n'appellent pas la même réaction.

Quand le coût est raisonnable, l'état des filtres vit dans l'URL : une vue filtrée se partage alors
par simple lien.

### Modale

```
[ titre text-section ] [ description text-meta ]   [ actions d'en-tête ]  [ × ]
[ corps défilant ]
[ pied : secondaire à gauche, principale à droite ]
```

Quatre largeurs : `sm` (confirmation), `md` (formulaire une colonne), `lg` (deux colonnes),
`full` (plan de requête, tableau). Le contenu commande la largeur.

Le focus entre dans la modale à l'ouverture et n'en sort pas au `Tab` ; `Échap` ferme ; le focus
revient à l'élément qui l'a ouverte. C'est `Modal` qui s'en charge, aucune vue n'a à le refaire.

### Formulaire

`Field` porte le libellé, l'indication et l'erreur sur la ligne du libellé — une ligne de moins par
champ. L'erreur remplace l'indication : les deux disent la même chose au même endroit.

Ordre des boutons : secondaire à gauche, principale à droite. La principale nomme le verbe
(« Enregistrer l'instance ») et jamais « OK ». Un formulaire se valide aussi par `Entrée`.

### État vide

Un titre qui nomme ce qui manque, une phrase qui dit pourquoi, et — dans les vues d'installation —
le geste attendu. Jamais d'illustration : l'espace vaut mieux au contenu.

Un état vide *filtré* n'est pas un état vide *initial* : « Aucune règle pour ces filtres » propose
d'effacer les filtres, « Aucune règle » propose d'en créer une.

### Chargement

Trois cas, trois traitements — l'amalgame est la cause du clignotement constaté.

1. **Premier chargement d'une page** : `LoadingBlock`, centré, une fois.
2. **Rechargement d'un contenu déjà affiché** (SSE, changement de filtre) : le contenu **reste
   affiché**. Il prend `aria-busy` et un liseré de progression `RefreshBar` en tête de bloc.
   Remplacer une liste par un spinner à chaque événement fait clignoter un écran qu'on regarde
   toute la journée, et décale la mise en page à chaque retour.
3. **Chargement d'une zone dont la forme est connue** : `Skeleton` aux dimensions finales, pour que
   rien ne saute quand le contenu arrive.

### Erreur

`Notice tone="danger"` en tête du bloc concerné, jamais en remplacement de la page : une erreur de
rafraîchissement ne doit pas effacer les données déjà lues. Le message dit ce qui a échoué et
propose de réessayer.

---

## 6. Temps réel

C'est le point le plus mal traité de l'état constaté : cinq vues se rechargent entièrement sur
événement SSE, et rien ne distingue une valeur qui vient de changer d'une valeur inchangée.

**Trois obligations pour toute vue qui se met à jour seule.**

### 6.1 Dater plutôt que teinter

**Aucune coloration de fond ne signale un rafraîchissement.** Une carte qui s'allume puis s'éteint
demande d'avoir regardé au bon moment ; six secondes plus tard, elle ne dit plus rien. Et sur un
écran qui se recharge seul toute la journée, la teinte finit par se lire comme un état de la
donnée — la carte est-elle en alerte ? — alors qu'elle ne parle que de l'instant du chargement.

La fraîcheur se dit par un chiffre qui reste vrai : « Mis à jour il y a 5 s ». Il répond à la même
question sans exiger d'avoir vu quoi que ce soit, il survit au regard qui arrive en retard, et il
se lit aussi bien en teinte qu'en noir et blanc.

Voir § 6.2 pour le composant.

### 6.2 Dire quand

`LastUpdated` affiche l'écart depuis la dernière donnée reçue et se réactualise seul. Toute vue qui
vit sans intervention en porte un : devant un écran figé, la première question est « est-ce à
jour ? », et un chiffre immobile ne répond pas.

### 6.3 Annoncer

`LiveRegion` (`aria-live="polite"`) annonce ce qui vient d'arriver — « 2 nouveaux diagnostics
critiques ». L'état constaté ne comportait **aucune** région live : une interface qui se réécrit
seule est muette pour un lecteur d'écran.

L'état du flux, dans la barre supérieure, est un `role="status"`. Flux interrompu = `warning`, pas
un gris discret : sur un second écran, un flux mort qui ne se voit pas fait lire des données
périmées pendant des heures.

---

## 7. Couleur, sévérité, zero-touch

**Jamais la couleur seule.** Une sévérité se dit par un mot (`SeverityBadge`), une pastille `Dot`
ne paraît jamais sans le texte qu'elle accompagne, un score porte son chiffre. Le daltonisme n'est
pas un cas limite sur un outil d'exploitation.

**Trois sévérités, trois poids** : critique se voit de loin (fond plein), avertissement se voit à
la lecture (fond atténué), information ne se voit qu'en la cherchant (contour). Une liste où les
trois pèsent pareil oblige à lire les mots pour trier — exactement ce qu'un balayage cherche à
éviter.

**Zero-touch.** L'Advisor ne corrige rien : ce que la vue livre, c'est un texte à comprendre et une
commande à exécuter ailleurs. Deux conséquences fermes :

- Toute commande SQL affichée est copiable. `CommandBlock` porte le bouton de copie et l'accusé
  « Copié ». L'état constaté n'avait **aucune** copie vers le presse-papiers dans toute
  l'application, alors que les clés de traduction existaient — un diagnostic qu'on doit resaisir à
  la main n'est pas exploitable.
- Les boutons ne prennent pas le centre. Le diagnostic occupe la colonne de lecture ; changer son
  statut est un geste de rangement, pas l'objet de la page.

**Un score qui remonte n'est pas forcément une bonne nouvelle.** Le garde-fou de coût écarte d'une
instance les règles qui pèsent trop sur elle. La catégorie qu'une règle notait cesse alors d'être
notée, et le score monte sans qu'aucune base n'aille mieux. C'est le seul cas où une amélioration
affichée doit être expliquée avant d'être crue :

- une quarantaine ne fait jamais disparaître un diagnostic en silence — la vue d'ensemble et le
  détail d'instance portent un bandeau `warning` qui nomme le nombre de règles écartées ;
- le badge vert « aucun diagnostic » s'efface dès qu'une règle a cessé de regarder : il dirait
  autrement le calme là où il n'y a plus d'observation ;
- la nature du dernier incident se dit, car elle ne mène pas à la même conclusion — un dépassement
  de délai ou une exécution lente disent que l'instance souffre, une erreur SQL que la règle est
  fautive.

---

## 8. Conventions de comportement

**Confirmations.** Une seule action en demande : la suppression. `ConfirmDialog` la porte —
trois vues écrivaient la même modale à la main. Un pas, jamais deux ; le titre nomme l'objet, le
corps dit la conséquence, le bouton porte le verbe (« Supprimer l'instance »).

**Réversible = pas de confirmation.** Ignorer un diagnostic, ou le reconsidérer, se défait : le
confirmer serait un péage. Le retour se fait par un `Notice` de succès porteur de l'action
inverse. Le résoudre n'est pas offert : un diagnostic décrit un fait constaté sur l'instance, et
seul le moteur le clôt lorsque la règle cesse de le remonter.

**Actions destructrices.** `variant="danger"`, à droite, jamais en position de défaut ; le focus
initial va sur l'annulation, `Échap` annule.

**Valeurs par défaut.** Elles répondent à la question quotidienne : Diagnostics ouvre sur les
actives, les plus graves d'abord. Les filtres vivent dans l'URL — un état d'investigation doit se
partager et survivre à un rechargement — et ne se réinitialisent jamais tout seuls.

**Clavier.** `Échap` ferme tout ce qui flotte. Les listes déroulantes se parcourent aux flèches,
`Début`/`Fin` vont aux extrémités, `Entrée` valide. Un raccourci affiché est un raccourci qui
existe : l'inverse aussi.

**Focus.** Anneau `:focus-visible` global, posé une fois. Aucune vue ne pose `outline-none` sans
fournir un remplaçant visible. Après une action qui retire un élément de la liste, le focus va au
suivant, jamais au `<body>`.

**Listes déroulantes.** Toujours `Select`, `MultiSelect` ou `Bubble` — jamais un `<select>` natif,
dont la liste est peinte par le système, reste claire en thème sombre et ignore la typographie.

---

## 9. Bilingue

Un libellé anglais est couramment 30 % plus long. La mise en page doit y survivre sans réglage.

- Toute chaîne visible passe par `useT()` / `useTc()`, ou `tr()` dans un rappel mémorisé — jamais
  `t` en dépendance d'un `useCallback`, qui recréerait le rappel à chaque changement de langue.
- **Un décompte injecté impose `useTc()`.** `t('x', { count })` sur un libellé au pluriel écrit
  « 1 critiques ». L'état constaté en comportait plusieurs.
- Aucune largeur fixe sur du texte : pas de `w-20` sur un libellé, pas de `w-*` sur un bouton.
  `min-w-0` + `truncate` sur ce qui peut déborder, `flex-wrap` sur ce qui peut se replier.
  Seule exception : une colonne d'étiquettes qui doit rester alignée d'une rangée à l'autre — les
  jauges de `ScoreBar`, où l'alignement *est* la lisibilité. Elle s'exprime alors en `ch`, pour
  suivre la taille du texte, avec troncature et `title`.
- `text-micro` en capitales n'accueille qu'un ou deux mots.
- Parité stricte : toute clé ajoutée dans `fr.ts` l'est dans `en.ts`, au même endroit.

---

## 10. Primitives disponibles

Tout est exporté par `@/components/ui/primitives`, sauf mention.

**Actions** — `Button` (`primary`/`secondary`/`outline`/`ghost`/`danger` × `sm`/`md`/`lg`/`icon`),
`SplitButton`, `CopyButton`, `CardAction`.

**Champs** — `Input`, `Textarea`, `Select`, `MultiSelect`, `Checkbox`, `Field`, `Fieldset`,
`FormSection`, `Label`, `FilterInput` (`@/components/ui/FilterInput`).

**Surfaces** — `Card`, `CardHeader`, `CardBody`, `Toolbar`, `Tabs`, `TableScroll`,
`Bubble` / `BubbleItem` (`@/components/ui/Bubble`).

**Tableau** — `Table`, `THead`, `TBody`, `Tr`, `Th` (`numeric`, `sort`, `onSort`),
`Td` (`numeric`).

**Signalétique** — `Badge` (`neutral`/`brand`/`info`/`success`/`warning`/`danger`),
`SeverityBadge`, `Dot`, `KeyValue`, `KeyValueGrid`, `ScoreRing` / `ScoreBar`
(`@/components/ui/score`).

**États** — `Spinner`, `LoadingBlock`, `Skeleton`, `RefreshBar`, `EmptyState`, `Notice`.

**Temps réel** — `LastUpdated`, `LiveRegion` dans les primitives ;
`useFresh`, `freshClass` dans `@/components/ui/fresh` — un module à part, parce qu'un fichier qui
exporte à la fois des composants et des fonctions perd le rechargement à chaud.

**Superpositions** — `Modal`, `ConfirmDialog`.

**Code** — `CodeBlock`, `CommandBlock`, `CopyButton`.

**Mise en page** — `Page`, `Stat`, `StatGrid`, `Hero` (`@/components/layout/Page`).

---

## 11. Migration des vues

Les primitives restent compatibles : rien ne casse à la compilation, et l'adaptateur historique
`@/components/ui` continue de fonctionner. Ce qui suit relève de la reprise volontaire.

### Change pour toutes les vues

| Changement | Effet | À faire |
|---|---|---|
| `Button` : taille par défaut `sm` → `md` (32 → 36 px) | Les boutons sans `size` grandissent de 4 px et s'alignent enfin sur les champs | Envelopper les barres de filtres denses dans `Toolbar` : elle resserre d'elle-même tous les contrôles qu'elle contient, sans `size` à répéter |
| `Button size="md"` : 40 → 36 px | Alignement sur `Input` | Rien, sauf recherche d'une hauteur de 40 px : utiliser `lg` |
| `CardHeader` : gouttière `px-5` → `px-4` | En-tête et corps alignés | Aligner les lignes de liste posées à `px-5` (Vue d'ensemble) |
| `Badge` : nouveau ton `info` | Une information n'est plus violette | Remplacer `tone="brand"` par `tone="info"` sur tout ce qui dit un **état** ; garder `brand` pour ce qui est **interactif** |
| `Badge` : encre `-strong` sur fond `-subtle` | Contraste conforme dans les deux thèmes | Rien |
| `SeverityBadge` : trois poids distincts (plein / atténué / contour) | Le critique ressort d'une liste | Rien, sauf badge de sévérité redessiné à la main : le retirer |
| `Modal` : piège de focus et restitution du focus | Comportement conforme | Retirer les gestions de focus faites à la main, s'il en existe |
| `ink-faint` ne porte plus de texte | Étiquettes lisibles | Remplacer `text-ink-faint` par `text-ink-muted` partout où il porte du texte ; le garder sur les icônes et les séparateurs |
| Échelle typographique nommée | Hiérarchie retrouvée | Remplacer `text-xs` → `text-meta`, `text-sm` → `text-body`, `text-lg` → `text-title`, `text-2xl` → `text-metric`, `text-[11px]` → `text-micro` |

### Reprise attendue, vue par vue

**Vue d'ensemble** (`DashboardPage.tsx`) — famille *balayage*.
- Le score global est une tuile `Stat` identique aux trois autres : la donnée qui commande la
  lecture n'a aucun relief. La passer en `Hero` avec `ScoreRing` et `text-display`, teintée par
  `scoreTone`.
- `dashboard.criticalCount` / `warningCount` / `infoCount` / `bundled` / `custom` / `failing`
  injectent un décompte sur un libellé au pluriel via `t()` : passer à `useTc()` (clés `.one` /
  `.other` à ajouter dans les deux catalogues).
- Le composant local `Metric` rend l'étiquette en 11 px et la valeur en 12 px : la valeur doit
  passer en `text-body`. Le remplacer par `KeyValue` / `KeyValueGrid`.
- Les cinq liens d'en-tête `text-brand text-xs font-medium hover:underline` deviennent `CardAction`.
- Le rechargement complet à chaque événement SSE remplace la page par `LoadingBlock` au premier
  passage, puis réécrit tout en silence : appliquer le § 6 — `RefreshBar`, `useFresh` sur le score
  et les décomptes par instance, `LastUpdated` dans l'en-tête, `LiveRegion`.
- Le `setInterval` de 30 s double le flux SSE : ne le conserver qu'en repli lorsque `connected`
  est faux.
- Lignes d'instance à `px-5` : passer à `px-4`.

**Diagnostics** (`FindingsPage.tsx`) — famille *balayage*.
- `loading ? <LoadingBlock/>` remplace la liste à chaque changement de filtre : appliquer le cas 2
  du § 5 (contenu conservé, `aria-busy`, `RefreshBar`).
- Les onglets de statut sont un `<nav>` de `<button aria-current="page">` : `aria-current="page"`
  ne convient pas à un onglet. Utiliser `Tabs`, ou `role="tab"` avec `aria-selected`.
- Le rechargement sur `finding.created` n'annonce ni ne marque la nouveauté : `useFresh` par ligne
  et `LiveRegion` pour l'arrivée.
- Résoudre / ignorer sont réversibles : pas de confirmation, un `Notice` porteur de l'action
  inverse (§ 8).
- Le tableau interne passe aux primitives `Table`.
- Toute commande SQL du détail passe en `CommandBlock`.

**Requêtes** (`QueriesPage.tsx`, `QueryTable.tsx`) et **plan** (`PlanView.tsx`) — famille *étude*.
- Vérifier que la hauteur de l'objet étudié vient de `useFillHeight` et non d'un `h-56` / `h-72` /
  `h-44` en dur — quatre hauteurs fixes distinctes sont posées dans ces fichiers.
- Contrôles de la barre d'outils en `size="sm"` dans un `Toolbar`.
- Texte SQL et mesures de plan en monospace et `tabular-nums`.
- Le SQL affiché passe en `CommandBlock`.

**Éditeur de règle** (`RuleEditorPage.tsx`) — famille *établi*.
- Le résultat d'exécution à blanc prend `useFresh` pour se distinguer du précédent.
- Afficher le raccourci d'exécution sur le bouton.
- Erreurs de validation reportées près de la ligne fautive.

**Instances, Règles, Notifications, Comptes** — famille *installation*.
- Les modales de suppression écrites à la main dans `InstancesPage`, `UsersPage` et
  `WebhooksPage` sont trois copies : passer à `ConfirmDialog`.
- Les six tableaux écrits à la main passent aux primitives `Table`.
- Formulaires sur une colonne, contrôles `md`, action principale `lg`, une indication par champ.
- États vides porteurs du geste attendu.

**Connexion** (`LoginPage.tsx`) — hors coquille.
- Le sélecteur de langue est écrit à la main et ses boutons mesurent 24 px de haut : sous le
  minimum de 32 px, et seule cible tactile de la page. Le passer en `Button size="sm"`.
- L'action principale du formulaire passe en `size="lg"` (§ 3.4).

### Ce qui reste en place

`PageHeader`, `Card` à en-tête intégré, `Modal wide` : conservés pour ne rien casser. Les vues
reprises leur préfèrent les primitives directes, mais rien n'oblige à tout migrer d'un coup.

L'adaptateur historique `ui.tsx` a, lui, été supprimé : la migration des vues l'avait vidé de tout
importateur, et avec lui `Alert` et `Tag`, qui n'existaient plus nulle part ailleurs. Ce n'était
plus de la compatibilité, seulement du code mort.
