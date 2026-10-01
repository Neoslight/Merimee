# Plan — refonte de l'interface vers les standards Google Maps / Earth

Rédigé le 2026-10-01 à partir du code (`+page.svelte`, `MonumentMap`, `FacetPanel`,
`DetailPanel`, `queries.ts`, `filters`, `permalien`), de `docs/conception-*.md`, des
captures de `web/.audit-screenshots/`, de `To-do.txt` et de `recette/anomalies.json`.
Rien n'est modifié dans le code à ce stade.

## 1. Constat : ce qui s'écarte des standards

Le produit est construit comme un **tableau de bord** (barre d'application, vues
commutables, tiroirs) alors que l'usage visé est celui d'une **carte** : la carte en
plein écran, tout le reste flottant dessus, et une caméra qui répond à chaque action.

### Structure et navigation

| # | Aujourd'hui | Standard Maps / Earth |
|---|---|---|
| S1 | Barre d'en-tête pleine largeur (72 px, ~100 px sur téléphone) : marque, vues, recherche, compteur, thème | Pas d'en-tête. Carte plein cadre, carte de recherche flottante en haut à gauche |
| S2 | Trois vues paires `Carte / Matrice / Liste` ; la liste **remplace** la carte | La liste est un panneau **à côté** de la carte (bureau) ou une feuille **au-dessus** (téléphone) ; la carte ne disparaît jamais |
| S3 | Matrice : vue entière, sans clavier (ANO-06), sans légende (ANO-20) | À supprimer (`To-do.txt`) |
| S4 | Fiche à droite, filtres à gauche, liste au centre : trois emplacements | Un seul panneau latéral : résultats → fiche, avec retour |
| S5 | Téléphone : 4 onglets au pied (dont Matrice) + barre haute = ~170 px pris à la carte | Une feuille basse à crans (compte → liste → fiche), pas d'onglets |
| S6 | Zoom + géoloc + calques empilés en haut à droite, `--haut-fonds` calé à la main (ANO-37) | Bureau : zoom et géoloc en bas à droite. Téléphone : pas de boutons de zoom, géoloc en pastille flottante |
| S7 | Vue de départ = centre/zoom fixes (`2.6, 46.6, z4.7`) : sur téléphone portrait la France est coupée, l'écran montre l'Espagne et la Méditerranée | `fitBounds` sur la métropole, marges des panneaux déduites |
| S8 | Pas de bouton « revenir à la France », pas d'échelle, libellés de zoom en anglais (ANO-28) | Bouton d'accueil, `ScaleControl`, libellés traduits |
| S9 | Thème dans la barre ; aucune page « à propos / sources » | Menu discret (thème, sources, crédits) |

### Recherche

| # | Aujourd'hui | Standard |
|---|---|---|
| R1 | Le champ est un **filtre muet** : on tape, le compteur change, rien d'autre. Pas de suggestions, pas de résultat visible sans aller dans « Liste » | Liste de suggestions typées sous le champ, résultat immédiat |
| R2 | La carte ne bouge jamais après une recherche | Chercher un lieu **cadre** ce lieu ; chercher un édifice **y vole** |
| R3 | Bouton « Historiques » : bascule de mode cryptique, à côté du champ | Une ligne dans les suggestions : « Chercher *jubé* dans les historiques » |
| R4 | Pas de bouton d'effacement visible, pas de raccourci clavier, pas d'état vide utile | `×`, touche `/`, et à vide : raccourcis d'exploration |
| R5 | `replier()` ne plie ni `œ` ni l'apostrophe typographique (ANO-04) | Recherche tolérante |

### « Au hasard »

| # | Aujourd'hui | Standard Earth (« J'ai de la chance ») |
|---|---|---|
| H1 | Ouvre une fiche **sans toucher au cadrage** : sur téléphone le point peut être hors champ | Vol : recul sur la France, puis descente progressive vers l'édifice, fiche à l'arrivée |
| H2 | Muet si le filtre ne garde aucune notice avec historique (ANO-18) | Message |
| H3 | Peut tomber sur une notice sans coordonnées ni photo | Tirage parmi les notices situées, de préférence illustrées |

### Sélection et fiche

| # | Aujourd'hui | Standard |
|---|---|---|
| F1 | Choisir une notice dans la liste ou par permalien ne déplace pas la carte (sauf sous la feuille mobile) | La carte vient au point choisi |
| F2 | Point sélectionné = anneau de 11 px | Épingle nette, au-dessus de tout |
| F3 | Infobulle de survol : code mort (ANO-08) | Nom + commune au survol (bureau) |
| F4 | Fermer = chevron `‹` ; actions = un lien POP et une pastille « copier » | `×`, et une rangée d'actions : Partager, Itinéraire, POP, Centrer |
| F5 | Vignettes sans précédent/suivant ni balayage (ANO-49) | Carrousel au doigt |
| F6 | Fermer la fiche empile une entrée d'historique : Précédent la rouvre (ANO-03) | Précédent ferme, jamais ne rouvre |
| F7 | Rien sur le voisinage | « À proximité » : les 5 notices les plus proches |

### Calques

| # | Aujourd'hui | Standard |
|---|---|---|
| C1 | Cartes anciennes derrière une pastille de 31 px sous la géoloc — la fonction la plus distinctive du site est la moins visible | Vignette **fixe en bas à gauche** avec aperçu du calque, qui se déplie en tuiles illustrées |
| C2 | Légende en bas à gauche : clés + « colorer par » + densité + ACR dans une même boîte | Légende = lecture seule ; tous les choix d'affichage dans le panneau Calques |
| C3 | Deux fonds seulement, aucun fond photographique | Tuile « Photo aérienne » attendue par quiconque vient de Maps/Earth |
| C4 | Chiffres de la couche ACR affichés nulle part (ANO-53) | Compte sur la tuile |
| C5 | Légende = trois pastilles `classé · inscrit · les deux`, sans titre ni explication. Retour d'usage : les visiteurs ne savent pas ce que ces mots distinguent, ni ce que « les deux » veut dire | Une légende qui **dit** : titre, hiérarchie, une phrase par niveau, effectifs. Cf. section 3 |

### Filtres

| # | Aujourd'hui | Standard |
|---|---|---|
| I1 | Bouton « Filtres » → tiroir de 8 facettes en nuages de pilules ; il faut l'ouvrir pour tout | Rangée de puces sous la recherche (`Statut ▾ Époque ▾ Type ▾ Lieu ▾ Architecte ▾`), chacune ouvre un petit menu ; « Tous les filtres » ouvre le panneau complet |
| I2 | Bande de puces actives **dans le flux** : elle change la hauteur de la scène et force un `map.resize()` | Les puces actives **sont** la rangée de filtres, flottante : plus de redimensionnement |
| I3 | « Limiter à la zone visible » = case en tête du tiroir | Puce « Zone visible » |
| I4 | Choisir une région ou un département ne cadre pas la carte | Cadrage sur la sélection |
| I5 | Tiroir fermé encore dans l'ordre de tabulation au large (ANO-57) ; valeur cochée à compte nul invisible (ANO-59) | — |
| I6 | Frises : bandeau « Afficher les frises » en pied de page | Entrée par les puces `Époque` / `Protection`, panneau bas conservé |

### Téléphone (le « scroll, navigation » de `To-do.txt`)

| # | Défaut | Source |
|---|---|---|
| M1 | Ouvrir une fiche au doigt fait défiler `.scene` de 354 px : la feuille couvre tout, la carte sort du champ | ANO-56, `focus()` sans `preventScroll` |
| M2 | Double-tap ou pincement dans un panneau zoome la page entière | ANO-34 |
| M3 | Barre du navigateur hors thème | ANO-48, pas de `theme-color` |
| M4 | Gabarit téléphone appliqué à 768 px (iPad mini) ; paysage 844 px à vérifier | ANO-50, ANO-51 |
| M5 | Lien copié après géolocalisation révèle la position (`c=`) | ANO-58 |

## 2. Décisions prises (2026-10-01)

| | Décision |
|---|---|
| D1 | Fiche dans un **panneau gauche unique** (résultats ↔ fiche, modèle Maps). `--marge-droite` disparaît, la colonne de commandes reste stable à droite |
| D2 | Téléphone : **plus d'onglets**, une feuille à trois crans. La feuille de fiche existante est étendue à la liste |
| D3 | **Photo aérienne IGN** ajoutée aux fonds (`ORTHOIMAGERY.ORTHOPHOTOS`, sans clé), l'actuelle seulement. Même mécanique que Cassini ; poids par tuile à mesurer avant de l'écrire dans `fonds.ts` |
| D4 | **Colonne `has_photo`** dans `monuments.parquet` : « Au hasard » tire parmi les notices illustrées. Un booléen, hors oracle ; poids du Parquet à relever avant/après |
| D5 | **Frises conservées** en panneau bas. Seule l'entrée change |
| D6 | **Pas de globe ni de relief.** Exigerait MapLibre ≥ 5, montée majeure notée comme risquée dans `CLAUDE.md` |

## 3. Légende : dire ce que les couleurs veulent dire

**Le défaut.** Trois mots de métier posés sans titre. Rien ne dit que ce sont des
niveaux de protection, que l'un est plus fort que l'autre, ni que « les deux » désigne
un édifice dont certaines parties sont classées et d'autres inscrites.

**Les couleurs ne changent pas.** `--classe` (terracotta), `--inscrit` (ocre),
`--mixte` (prune) restent tels quels dans les deux thèmes : la teinte la plus dense
porte déjà le niveau le plus fort. Seuls le texte et la structure bougent.

**Le propos, une seule source.** Un module `lib/statuts.ts` porte pour chaque statut
son libellé, sa glose courte, sa définition et le nom de son jeton de couleur. La
légende, la puce de filtre `Statut`, le badge de la fiche et les tuiles de calques le
lisent tous : un mot corrigé l'est partout.

| Valeur stockée | Libellé | Glose (légende repliée) | Définition (légende dépliée) |
|---|---|---|---|
| `classé` | Classé | protection la plus forte | Édifice dont la conservation présente un intérêt public pour l'histoire ou l'art. Décision du ministre de la Culture ; tous travaux soumis à autorisation de l'État |
| `inscrit` | Inscrit | premier niveau de protection | Édifice d'un intérêt suffisant pour en rendre la préservation désirable. Décision du préfet de région ; travaux déclarés et suivis |
| `classé+inscrit` | Classé et inscrit | selon les parties de l'édifice | Certaines parties sont classées, d'autres inscrites — une façade classée, le reste du bâtiment inscrit, par exemple |
| autres (448) | Non précisé | — | Statut absent ou illisible dans la notice |

Les définitions reprennent les termes du code du patrimoine (art. L621-1 et L621-25),
à relire contre le texte au moment de l'écriture.

**La forme.**

- **Un titre** : « Niveau de protection » en mode statut, « Époque de construction »
  en mode époque, « Densité de monuments » sous la carte de chaleur.
- **Repliée** (état courant) : pastille, libellé, glose en gris. Trois lignes
  empilées, du plus fort au plus faible — plus une rangée de mots à plat.
- **Dépliée** par un bouton « comprendre » : la définition sous chaque ligne,
  l'effectif courant à droite (il suit les filtres), et un lien vers la page du
  ministère. `totaux()` reçoit un compte `mixtes` de plus, sans requête
  supplémentaire. Le texte rappelle qu'un édifice « classé et inscrit » compte dans
  les deux : classés et inscrits ne s'additionnent pas.
- **Première visite** : dépliée une fois, puis repliée ; le drapeau vit dans
  `localStorage`, comme le thème, jamais dans l'URL.
- **Cliquable** : une ligne pose ou retire le filtre de statut correspondant. La
  légende sert alors à lire **et** à trier.
- **« Non précisé »** n'apparaît que si la sélection courante en contient.
- **Téléphone** : la bande repliée tient sur une ligne (pastilles + libellés), un
  toucher ouvre les définitions en feuille basse.
- **Fiche** : le badge de statut porte la même glose en sous-titre.

## 4. Phases

Chaque phase se termine sur `npm run check` à 0/0, `test:unit` vert, `npm run build &&
npm run test` vert, et la mise à jour des pages `docs/` concernées. Une phase = une
branche = un ou deux commits.

### Phase 0 — Assainir (aucun changement de dessin)

1. `focaliser()` : `focus({ preventScroll: true })` + vérification de position dans
   `09-mobile.spec.ts` (M1).
2. Historique : `pushState` à l'ouverture seulement, `replaceState` à la fermeture (F6).
3. `touch-action` étendu aux panneaux (M2) ; `<meta name="theme-color">` suivi par le
   thème (M3).
4. Tiroir fermé `inert` à toutes les largeurs (I5).
5. Vue de départ par `fitBounds` métropole (S7). Bornes dans un module pur
   `lib/carte/camera.ts`, testé en Vitest.
6. « Au hasard » sans résultat : message en surface (H2).
7. `c=` omis du lien copié quand la carte suit la géolocalisation (M5).
8. Légende, premier pas (C5) : `lib/statuts.ts`, titre « Niveau de protection »,
   trois lignes avec glose, « les deux » devient « classé et inscrit ». Texte seul,
   dans la boîte actuelle ; `.cle` reste la classe comptée par `04` et `05`.

### Phase 1 — Supprimer la matrice

`Matrice.svelte`, `queries.matrice()`, l'effet et `choisirCellule` de la page, le
bouton de vue, l'onglet, les jetons `--matrice-*` **sauf** ceux que relit la rampe de
densité en clair, les vérifications de `03-frises-et-matrice.spec.ts`, les captures de
l'audit. `vue=matrice` dans une URL retombe sur la carte, sans erreur. `CLAUDE.md` :
index, comptes de tests, deux lignes de « Reste à faire ».

### Phase 2 — Caméra et « Au hasard »

1. `camera.ts` (pur) : marges visibles selon les panneaux ouverts, décision
   « voler / glisser / ne rien faire », bornes d'un jeu de points.
2. `MonumentMap` expose `volerVers(lon, lat, options)` et `cadrer(bornes)`. Le
   recentrage `reserveBas` actuel passe par la même marge.
3. Sélection par liste, recherche ou permalien `ref=` sans `c=` : la carte vient au
   point s'il est hors champ ou si le zoom est sous 11 (F1).
4. ETL : colonne `has_photo` dans `build.py` (vraie si l'instantané Wikidata ou
   Commons donne au moins un fichier), un test pytest, poids du Parquet relevé
   avant/après, ETL relancé.
5. « Au hasard » : tirage `lat IS NOT NULL AND has_historique AND has_photo`, repli
   sans `has_photo` si le filtre courant n'en garde aucune,
   `flyTo({ center, zoom: 14.5, minZoom: 4.7, maxDuration: 4500 })` — `minZoom` donne
   le recul national, MapLibre calcule la descente. Fiche ouverte à `moveend`. Un geste
   interrompt le vol, la fiche s'ouvre quand même. **Jamais `essential: true`** :
   mouvement réduit = saut direct.
6. Épingle de sélection (F2) et infobulle de survol par `setText` (F3) — pas `setHTML`,
   cf. l'avis GHSA sur `maplibre-gl` 4.x.
7. À mesurer : images par seconde pendant le vol avec 44 484 points sur téléphone, et
   le coût en tuiles d'un vol sous Cassini (170 Ko la tuile). Si trop lourd : fond
   historique suspendu pendant le vol.

### Phase 3 — Calques

1. Extraire de `MonumentMap` un composant `Calques.svelte` : fonds, opacité, mode de
   couleur, densité, ACR. L'état reste où il est (page pour `fond` et `acr`).
2. Vignette fixe en bas à gauche (72 px bureau, 52 px téléphone) montrant le calque
   **proposé** — Cassini par défaut. Filet ocre quand un fond est actif.
3. Dépliée : trois rangées de tuiles illustrées — *Fond* (Plan · Photo aérienne ·
   Cassini · État-major), *Points* (Statut · Époque · Densité), *En plus*
   (Architecture contemporaine, avec son compte). Curseur d'opacité sous la rangée
   Fond. Sur téléphone : feuille basse.
4. Vignettes = images statiques dans `static/calques/`, produites par un script
   `web/scripts/`. Aucun octet IGN avant activation : la règle tient.
5. Photo aérienne : une entrée de plus dans `HISTORIQUES` (`fonds.ts`), type
   `FondHistorique` et permalien `fond=` étendus. Le liseré bascule au sombre comme
   sous Cassini ? À vérifier à la capture — une photo aérienne est sombre, pas beige.
6. Légende complète (section 3) : composant `Legende.svelte` accolé à la vignette —
   repliée / dépliée, effectifs, lignes cliquables, première visite, feuille sur
   téléphone. Les réglages (colorer par, densité, ACR) la quittent pour le panneau
   Calques : elle ne fait plus que dire.
7. Exclusion densité ↔ fond historique et effet `liseret()` séparé : inchangés.

### Phase 4 — Coque : la carte prend tout l'écran

Préalable : éclater `+page.svelte` (2 265 lignes) — `Liste.svelte`, `Feuille.svelte`
(poignée et crans), `Recherche.svelte`. Sans cela aucun travail parallèle n'est
possible sur ce fichier.

1. **4a, bureau.** L'en-tête disparaît. Carte de recherche flottante en haut à gauche
   (marque dedans, `<h1>` masqué, menu thème / à propos). Panneau gauche unique
   : résultats avec compte en tête, fiche avec retour, « tous les filtres ».
   Zoom, géoloc, accueil et échelle en bas à droite.
2. **4b, puces de filtres.** Rangée flottante sous la recherche, défilable. Une puce
   = un menu qui réemploie une section de `FacetPanel` ; la requête `facette()` ne
   part qu'à l'ouverture. Puce active = valeur + `×`. `Jetons.svelte` fusionne dedans.
   « Zone visible » devient une puce. Région ou département choisi → `cadrer()`.
3. **4c, téléphone.** Feuille à trois crans : repli (compte + poignée), demi (liste),
   plein. La fiche y vit avec retour vers la liste. Onglets supprimés, boutons de
   zoom masqués au doigt, géoloc en pastille au-dessus de la feuille.
4. `vue=liste` dans une URL ouvre le panneau de résultats. `liste()` ne part plus
   qu'à l'ouverture : deux requêtes au démarrage au lieu de trois.

### Phase 5 — Recherche

1. `db/suggestions.ts` : une requête `UNION ALL`, débattue à 150 ms, jeton monotone —
   *Lieux* (commune, département, région, avec compte et bornes
   `min/max(lon, lat)`), *Édifices* (titre, 6 premiers), *Catégories* (dénomination,
   domaine, auteur). Aucun géocodeur, aucun appel réseau.
2. `Recherche.svelte` : combobox ARIA, flèches / Entrée / Échap, `/` pour y aller,
   `×` pour vider, portion trouvée surlignée.
3. Actions : lieu → `cadrer()` + filtre ; édifice → `volerVers()` + fiche ;
   catégorie → puce ; dernière ligne → recherche dans les historiques (remplace le
   bouton, l'index de 3,8 Mo part toujours au premier usage) ; Entrée → filtre texte,
   panneau de résultats, cadrage sur leur emprise si elle tient en métropole.
4. Champ vide : raccourcis d'exploration (Vauban, Guimard, Le Corbusier, mégalithes,
   phares) — de simples permaliens, déjà au « Reste à faire ».
5. `replier()` : ligatures et apostrophes (R5), aligné sur la normalisation de l'ETL.

### Phase 6 — Fiche et liste

Rangée d'actions (Partager par `navigator.share` avec repli copie, Itinéraire par lien
profond, POP, Centrer) ; `×` à la place du chevron ; carrousel au doigt ; « À
proximité » ; lignes de liste avec pastille de statut et siècle ; survol d'une ligne
→ point mis en avant sur la carte ; tri (pertinence, proximité, mobilier, A–Z) ;
pagination au-delà de 200.

### Phase 7 — Clôture

`npm run audit` (captures refaites), anomalies d'accessibilité restantes touchées par
la refonte (ANO-21 à 27), `README.md`, vignette sociale (`npm run apercu`).

## 5. Invariants à tenir pendant toute la refonte

- Les panneaux restent des **calques** : rien ne redimensionne le canevas WebGL. Pas
  de `backdrop-filter` au-dessus de la carte.
- `setStyle` / `diff: false` / `pret` lu en premier ; `liseret()` reste un effet seul.
- La couche ACR n'entre jamais dans le prédicat. Les 2 276 notices sans coordonnées
  restent atteignables par la liste.
- Démarrage : pas de requête de facette tant qu'aucun menu n'est ouvert ;
  `points.json` peint toujours le premier écran.
- Toute couleur dans `app.css`, tout `:hover` sous `@media (hover: hover)`, cibles à
  44 px par `::after` (`11-sources.spec.ts` le vérifie).
- Le focus suit un geste, jamais un permalien ; `inert` posé depuis la page.
- Position et tri par proximité hors de l'URL ; comparaison de permaliens sur la
  forme normalisée.
- Les liens déjà partagés continuent de s'ouvrir (`vue=`, `notice=`, `fond=`).

## 6. Organisation et agents

Le diagnostic a été fait sans agent : six fichiers à lire, un seul fil suffit.

Pour l'exécution, un agent Sonnet n'est pertinent que sur du travail **mécanique et
borné**, avec une table de correspondance fournie :

| Tâche | Agent |
|---|---|
| Phase 1, suppression de la matrice (code, tests, docs, comptes) | Sonnet |
| Migration des sélecteurs e2e après 4a / 4b / 4c (13 fichiers, table ancien → nouveau) | Sonnet, un par lot de fichiers |
| Script des vignettes de calques (phase 3) | Sonnet |
| Mise à jour de `docs/` et des comptes de `CLAUDE.md` en fin de phase | Sonnet |
| `MonumentMap` (caméra, effets, `setStyle`), coque, feuille à crans, combobox | fil principal — les pièges mesurés de `docs/contraintes.md` ne se délèguent pas |

Pas de parallélisme sur `+page.svelte` avant son éclatement (préalable de la phase 4).
Après, les phases 3 et 5 peuvent tourner en `worktree` séparés.

## 7. Ordre et taille

| Phase | Taille | Touche les e2e |
|---|---|---|
| 0 Assainir, légende (texte) | petite | `04`, `07`, `09` |
| 1 Matrice | petite | `03`, audit |
| 2 Caméra, hasard, `has_photo` (ETL) | moyenne | `04`, `06`, nouveau `14-camera` |
| 3 Calques, photo aérienne, légende complète | moyenne | `04`, `05`, `13` |
| 4 Coque | **grande** | presque tous |
| 5 Recherche | moyenne | `02`, nouveau `15-recherche` |
| 6 Fiche, liste | moyenne | `06`, `09` |
| 7 Clôture | petite | audit |

Les phases 0 à 3 livrent chacune un gain visible sans toucher à la structure. La
légende, qui gêne les visiteurs aujourd'hui, reçoit son texte dès la phase 0 et sa
forme complète en phase 3.
