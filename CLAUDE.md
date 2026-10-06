# CLAUDE.md

Repère de travail pour ce dépôt. Le détail fonctionnel est dans [README.md](README.md),
l'audit du fichier source dans [ANALYSE_MERIMEE.md](ANALYSE_MERIMEE.md), les
contraintes techniques mesurées et les règles de conception détaillées — trop
nombreuses pour tenir ici sans noyer les invariants — dans [docs/](docs/).

## Ce qu'est le projet

Tableau de bord d'exploration des 46 760 immeubles protégés au titre des Monuments
historiques (base Mérimée / POP). Carte WebGL, filtrage croisé instantané, double
frise chronologique (époque de construction × année d'arrêté de protection).

**Site statique, sans backend.** Un pipeline Python produit des Parquet, le
navigateur les interroge en SQL via DuckDB-Wasm.

```
data/raw/merimee.csv  ──ETL Python──▶  web/static/data/  ──▶  DuckDB-Wasm (navigateur)
    100 Mo, 78 colonnes                2,5 Mo + 32 fragments
```

## Disposition

| Chemin | Rôle |
|---|---|
| `data/raw/merimee.csv` | source, **non versionnée** (100 Mo) |
| `data/raw/merimee_acr.csv` | label Architecture contemporaine remarquable, **non versionné**, facultatif (5,8 Mo) |
| `etl/merimee_etl/acr.py` | couche ACR : `acr/points.json` + 8 fragments `acr/fiches/`, **sautée sans source**, hors oracle |
| `data/ref/*_acr.csv` | instantanés photo ACR, produits par `wikidata --acr` et `commons --acr` |
| `web/src/lib/acr.ts` / `web/src/lib/db/acr.ts` | couche ACR : logique pure / nuage et `ficheAcr()` au format `Detail`, chargés à la demande |
| `data/ref/*.csv` | décisions éditoriales, **versionnées** : alias d'auteurs, corrections de vocabulaire |
| `data/ref/wikidata_images.csv` | instantané tiers, 2,4 Mo — pas une décision éditoriale, cf. `docs/conception-photographies.md` |
| `data/ref/memoire_illustrations.csv` | instantané tiers, 554 Ko : un nombre par notice, **jamais une image** |
| `.python-version` / `etl/requirements.lock` | version Python et dépendances figées lues par la CI ; `etl/requirements.txt` reste la déclaration de bornes |
| `etl/merimee_etl/wikidata.py` | récupère cet instantané, **jamais appelé par le pipeline** |
| `etl/merimee_etl/` | pipeline : `load` → `normalize` → `parse` → `build`, piloté par `cli` |
| `etl/merimee_etl/texte.py` | index plein texte des historiques, **dégrade en silence** sans `fts` |
| `etl/merimee_etl/commons.py` | second instantané photo, séparé de `wikidata.py` — lancé à part |
| `etl/merimee_etl/memoire.py` | compte les illustrations POP **sans les reprendre** — lancé à part |
| `web/static/data/points.json` | nuage du premier écran (446 Ko gzip), écrit par `build.py::points_colonnaires`, remplacé par DuckDB dès sa première réponse |
| `etl/tests/test_pipeline.py` | 79 tests : unitaires sur les cas tordus + intégration sur les artefacts (sautée d'elle-même sans eux) |
| `etl/tests/test_annexes.py` | 24 tests : fonctions pures des scripts annexes (`wikidata.py`, `commons.py`) et des alias, sans réseau |
| `etl/out/rejets.csv` | segments hors-format rencontrés, jamais supprimés silencieusement |
| `.nvmrc` / `.github/workflows/ci.yml` | version Node lue par la CI ; workflow GitHub Actions (jobs `etl` et `web`), jamais l'ETL complet ni `tests/e2e/` |
| `docs/` | contraintes techniques et règles de conception, déplacées de ce fichier et classées par domaine |
| `web/src/lib/db/` | `duckdb.ts` (bootstrap, fragments, `echapperLike`), `queries.ts` (requêtes), `shards.ts` (hachage), `texte.ts` (BM25, table temporaire du prédicat plein texte) |
| `web/src/lib/state/filters.svelte.ts` | état des filtres + construction du prédicat SQL |
| `web/src/lib/state/position.svelte.ts` | position de l'utilisateur, écrite par la carte — **jamais dans l'URL ni `localStorage`** |
| `web/src/lib/db/points.ts` | nuage précalculé → GeoJSON, et `entite()`, seul constructeur partagé avec `queries.points()` |
| `web/src/lib/geo.ts` | distance haversine, même formule que le tri SQL par proximité |
| `web/src/lib/state/permalien.ts` | sérialisation de l'état dans l'URL (`encoder` / `decoder`) |
| `web/src/lib/state/amorcage.svelte.ts` | phase et octets du démarrage, lus par l'écran d'attente |
| `web/src/lib/state/theme.svelte.ts` | thème sombre/clair, les deux feuilles de fond, et la palette résolue que lisent MapLibre et Plot |
| `web/src/lib/teinte.ts` | repeint le fond clair par **nature de couche**, jamais par identifiant |
| `web/src/lib/state/carte.svelte.ts` | ce que la carte a réellement peint — le seul témoin d'un repeint muet |
| `web/src/lib/carte/fonds.ts` | `SUPERPOSITIONS` : photo aérienne et cartes anciennes IGN, dosage, place sous ou sur les libellés, tuiles |
| `web/src/lib/carte/libelles.ts` | libellés du fond CARTO en français (`name:fr`, repli sur le nom local) |
| `web/src/lib/carte/semiologie.ts` | `Mode` et `TRANCHES` d'époque, partagés par la carte, la légende et les calques |
| `web/scripts/vignettes-calques.mjs` | produit `static/calques/*.jpg`, aperçus figés des fonds — aucun octet IGN avant choix |
| `web/src/lib/carte/camera.ts` | cadrage, calculs purs : emprise de départ, part visible sous les panneaux, décalage de visée, et quand taire la vue dans un lien copié |
| `web/src/lib/recherche.ts` / `web/src/lib/db/suggestions.ts` | raccourcis d'exploration, surlignage, emprise métropolitaine / suggestions en une requête `UNION ALL` |
| `web/src/lib/statuts.ts` | libellé, glose et définition de chaque niveau de protection — source unique de la légende |
| `web/src/lib/photo.ts` | cadrage des photographies de fiche, calculs purs — extrait de `DetailPanel.svelte` |
| `web/src/lib/format.ts` | `romain`, `nf`, formats de nombres — étaient recopiés dans plusieurs composants |
| `web/src/service-worker.ts` | cache des actifs hachés uniquement |
| `web/scripts/precharger.mjs` | injecte le préchargement du wasm dans le shell HTML après build, chaîné à `build` et `build:pages` |
| `web/src/lib/components/` | `MonumentMap` (rendu seul), `Recherche`, `Calques`, `Legende`, `ListeResultats`, `PucesFiltres`, `FacetPanel` (aussi par section : `seules`), `Jetons`, `Timeline`, `DetailPanel` |
| `web/tests/e2e/` | 417 vérifications en Chromium réel : 18 fichiers `NN-domaine.spec.ts` + `_soutien.ts` (`verifier()` adossé à `expect.soft`), `playwright.config.ts` en `workers: 1` / `retries: 0` |
| `web/tests/unit/` | 100 tests Vitest sur la logique pure : `buildWhere`, `permalien`, `shards`, `teinte`, `points`, `acr`, `camera`, `recherche`, `libelles`, distances |
| `web/tests/apercu-social.mjs` | régénère la vignette Open Graph depuis l'application |
| `web/tests/audit-visuel.mjs` | 120 captures + relevés WCAG chiffrés, **hors** `npm run test` |

## Commandes

```bash
cd etl  && python -m merimee_etl        # ~12 s, écrit web/static/data/
cd etl  && python -m merimee_etl.wikidata  # rafraîchit l'instantané des photos
cd etl  && python -m merimee_etl.commons   # complète par les fichiers citant la notice
cd etl  && python -m merimee_etl.wikidata --acr  # idem pour la couche ACR (après l'ETL)
cd etl  && python -m merimee_etl.commons --acr
cd etl  && python -m merimee_etl.memoire   # compte les illustrations POP, 1,36 Go lus en flux
cd etl  && python -m pytest tests -q    # 103 tests (79 + 24 dans test_annexes.py)
cd web  && npm run dev                  # http://localhost:5173
cd web  && npm run check                # svelte-check, doit rester à 0/0
cd web  && npm run test:unit            # Vitest, 100 tests, logique pure
cd web  && npm run build && npm run test # build statique + 417 vérifications en Chromium (tests/e2e/)
cd web  && npm run apercu               # régénère static/apercu-social.png
cd web  && npm run audit                # 120 captures + relevés dans .audit-screenshots/
cd web  && npm run deploy               # predeploy (check + test:unit) puis build /Merimee + push sur gh-pages
```

Chaque fichier de `tests/e2e/` démarre son propre serveur statique (`tests/serveur.mjs`
instrumenté) et journalise ses propres erreurs console en différentiel ;
`12-performance.spec.ts` écrit `web/tests/apercu.png`. La suite exige
`npx playwright install chromium` une fois, et le build complet avec ses vraies
données — `npm run build` seul fonctionne sans elles, `npm run test` non.

**CI (`.github/workflows/ci.yml`), sur push et pull request vers `main`.** Job `etl` :
Python lu depuis `.python-version`, `pip install -r requirements.txt`,
`python -m pytest tests -q` — les tests d'intégration se sautent d'eux-mêmes
(`pytest.mark.skipif` sur l'absence de `web/static/data/`) et la commande sort en
code 0. Job `web` : Node lu depuis `.nvmrc`, `npm ci`, `npm run check`,
`npm run test:unit`, `npm run build` — ce dernier réussit sans `web/static/data/`,
`web/scripts/precharger.mjs` ne dépendant que de `build/_app`. **Ni l'ETL complet ni
`tests/e2e/` n'y tournent** : le premier exige `data/raw/merimee.csv` (100 Mo, non
versionné) ; le second exige les données produites par l'ETL et appelle CARTO en
réseau, un service tiers dont la disponibilité rendrait la CI intermittente.

`npm run deploy` lance désormais `predeploy` (`npm run check && npm run test:unit`)
avant de construire et publier : un déploiement ne part plus sans ces deux gardes,
que npm enchaîne automatiquement devant tout script `deploy`.

## Invariants à ne pas casser

**Les chiffres d'`ANALYSE_MERIMEE.md` sont l'oracle.** 46 760 notices, 44 484
géolocalisées, 51 640 actes, 126 597 liens Palissy, 14 990 classées, pic 1926 = 2 093.
Ils sont figés en assertions pytest : si le parsing change, ces tests doivent être
la première chose consultée, et tout écart doit être justifié dans le test lui-même
(deux le sont déjà : `inscrits == 33 884` et les comptes de siècles par notice).

**Ne jamais additionner classés et inscrits** : 2 562 notices cumulent les deux.

**Ne jamais parser le CSV à la main.** La notice `PA31000132` contient un pipe
littéral dans un champ quoté.

**Les 2 276 notices sans coordonnées restent accessibles** par la vue liste. Ne pas
les filtrer hors du corpus sous prétexte qu'elles n'apparaissent pas sur la carte.

**La couche ACR n'entre jamais dans le prédicat.** 1 822 notices (1 743 situées), masquées
par défaut, sans effet sur filtres, compteurs, liste ni frises ; ses chiffres ne
sont pas ceux de l'oracle. Cf. `docs/conception-donnees.md`, section ACR.

**`Date_de_creation_de_la_notice` n'est pas une date métier** (79 % au 1993-03-29,
date d'informatisation), `Date_de_la_derniere_mise_a_jour` non plus (reprise
technique 2025-2026).

## Index des pièges

Chaque ligne résume un piège en une phrase et nomme le fichier `docs/` où il est
détaillé — mesures, contre-exemples, code impliqué. **Lire la section correspondante
avant de toucher à ce domaine** : cet index oriente, il ne remplace pas la lecture.

### Contraintes techniques mesurées — [docs/contraintes.md](docs/contraintes.md)

- DuckDB-Wasm télécharge tout fichier Parquet en entier, aucune requête Range → `details` éclaté en 32 fragments, hachage FNV-1a dupliqué build.py/shards.ts
- bundle DuckDB `eh`, jamais `coi` (multi-thread exige COOP/COEP, impossible en statique)
- `.nojekyll` obligatoire sur Pages, sinon tout `_app/` renvoie 404
- cache navigateur du `.wasm` quasi nul sur Pages (`max-age=600`) → service worker dédié, actifs hachés seulement, jamais `data/` ni le shell HTML
- rappel de progression de duckdb-wasm invisible côté page — ne pas réécrire une barre sans le mesurer d'abord
- mesurer le cache SW : compteur d'octets serveur + `caches.open`, jamais `performance`
- MSYS (Git Bash) réécrit toute variable d'environnement commençant par `/`
- `plot.value` d'Observable Plot reste nul sur une marque non interactive ; l'axe des siècles est une échelle à bandes, `invert` n'existe pas
- fonds IGN : préfixe `BNF-IGNF_` obligatoire sur Cassini, `maxzoom` sur la source est le piège — sans lui la couche disparaît au zoom
- `map.setStyle()` détruit tout ; `diff: false` est la condition de `style.load` ; `pret` retombe avant l'appel et réarme les effets qui le lisent en premier
- Chromium sans tête annonce `prefers-color-scheme: light` et un `pixelRatio` de 1 — chaque fichier e2e force `colorScheme`
- la chaîne des points lit les colonnes Arrow directement (156 → 55 ms) ; `mesures.sql` inclut la file d'attente de la connexion unique, pas seulement le moteur
- le `setData` qui suit un `setStyle` est redondant en apparence, nécessaire contre l'`AbortError` d'un chargement de style annulé en vol
- `liseret()` reste un effet séparé — le fusionner avec la palette ou les fonds réintroduit l'`AbortError` ou une saccade
- `pixelRatio` plafonné à 2
- le wasm est préchargé (`precharger.mjs`) puis refetché en `blob:` par le document, jamais laissé au worker — sinon deux copies, 68,5 Mo
- un conteneur défilant opaque sous un parent translaté masque le canevas ailleurs ; le défaut ne se voit pas dans une capture `clip`
- `flyTo` : `maxDuration` dépassé = saut, pas vol ; écouter `moveend` **après** l'appel
- `points.json` peint le premier écran avant le moteur : JSON (gzippé par Pages) et non binaire, même passe que `monuments.parquet`, jamais en cache SW, jamais demandé avec un filtre dans l'URL

### Données et requêtes — [docs/conception-donnees.md](docs/conception-donnees.md)

- colonnes `LIST` plutôt que tables de liaison (sauf `protections`, 4 215 notices à plusieurs actes)
- colonnes mortes retirées des Parquet, jamais lues côté navigateur : **−10 % sur `monuments.parquet`**
- une facette annonce ce qu'elle cache, sans son propre filtre ; sa recherche descend en SQL (40 valeurs affichées, tout le reste cherchable)
- la saisie propose (suggestions), un geste applique : commune → filtre `communes` (« Baden (Morbihan) », homonymes départagés), région/département/catégorie → facette, édifice → fiche, Entrée → filtre de titre + liste ; historiques = dernière ligne ; `replier` plie « œ » et « ’ »
- plein texte précalculé par l'ETL, résolu **une fois par cycle** dans une table temporaire (LRU 8), pas réinjecté à chaque requête
- `USING SAMPLE` ignore le filtre — « Au hasard » veut `ORDER BY random()` ; `has_historique` et `has_photo` y sont des ordres, pas des filtres
- le retour arrière lit `location` sur `popstate`, jamais `page.url` — SvelteKit y garde l'adresse du chargement sous `pushState`/`replaceState`
- deux filtres ont un miroir hors de `filters` (recherche, bbox) qu'un simple `retirer()` ne suffit pas à effacer
- permalien : paramètre répété pour les valeurs multiples, `bbox` exclue, vue à part (tue si elle montre la position de l'utilisateur), comparaison de chaînes normalisées ; seule l'ouverture d'une fiche empile, la fermeture remplace
- un jeton monotone écarte les réponses périmées, jamais n'annule le travail déjà payé
- le cycle de requêtes est éclaté en quatre effets, conditionnés à l'ouverture des panneaux
- le curseur Palissy est débattu à 180 ms, comme la recherche et la recherche de facette
- la matrice a été supprimée ; `buildWhere` garde sa liste `except`, et `?vue=matrice` retombe sur la carte
- choisir une région, un département ou une commune cadre la carte sur l'emprise du nuage filtré (`emprise()`), seulement à l'ajout
- le tri par proximité a son propre effet, clé de position arrondie à ~100 m, et n'écarte les notices sans coordonnées que de ce tri ; position et tri hors URL
- couche ACR : second corpus hors prédicat, 8 fragments FNV-1a modulo 8, rien téléchargé avant activation, `ref=ACR…` rallume `acr=1`

### Carte — [docs/conception-carte.md](docs/conception-carte.md)

- pied gauche en colonne (`.pied`) : vignette des calques au-dessus de la légende, qui tient le coin (aperçu figé, panneau à tuiles) ; l'état vit dans la page, `MonumentMap` peint ; attribution repliée en « i » dès le départ
- photo aérienne sous les libellés du plan, cartes anciennes dessus ; chaque fond arrive à son dosage (100 / 65 %)
- la vue de départ est une emprise (`METROPOLE`) cadrée avec marges, plus un centre et un zoom fixes
- la légende est repliée au départ (trois clés et un « ? », titre pour les lecteurs d'écran) ; dépliée : glose, définition et effectif par niveau (`lib/statuts.ts`, effectifs sans le filtre de statut, chargés seulement dépliée) ; toucher une clé filtre ; les couleurs ne bougent pas
- caméra : toucher ne bouge rien sauf sous un panneau, la liste rapproche, `?ref=` sans `c=` centre, « Au hasard » vole ; vols en deux temps (traversée puis descente pure), durées par niveau de zoom, courbe sinusoïdale ; `offset`, jamais `padding`
- libellés du fond en français : `franciser` réécrit chaque `text-field` de nom en `coalesce(name:fr, name)`, à chaque `setStyle`
- épingle de sélection en `Marker` DOM, infobulle de survol par `setDOMContent`, jamais `setHTML`
- le fond clair est repeint couche par couche **par nature**, jamais par identifiant CARTO
- le thème sombre n'est pas repeint : `teinter()` sort immédiatement
- le liseré des points vaut le sol, et bascule au sombre sous un fond historique ≥ 50 % d'opacité
- la rampe de densité s'inverse avec le thème, sur ses propres jetons
- liseré, opacité et rayon des points sont interpolés par zoom, jamais un littéral fixe
- pas de fusion « produit » sur une couche `circle` : la heatmap donne la quantité, l'alpha donne le grain
- un toucher interroge une boîte (±16 px au doigt, ±6 à la souris) et retient le plus proche à l'écran ; sous z9 un amas rapproche la vue
- géolocalisation : contrôle natif, icône en masque peinte par jeton, sous le zoom (disjonction vérifiée)
- l'intermittence `AbortError` de la suite s'est réduite avec l'isolation par fichier et le passage au sondage
- couche ACR posée masquée dans `poserCouches`, au-dessus des monuments, teinte `--acr` ; `couchesTouchables()` ne la nomme que visible

### Interface — [docs/conception-interface.md](docs/conception-interface.md)

- plus de barre d'en-tête : bloc du haut flottant (recherche, compteur, Carte/Liste, Filtres, Frises), thème au coin haut droit
- un seul volet (liste ↔ fiche ↔ filtres, par priorité), colonne au large, feuille à trois crans sur téléphone ; ce qu'il ne montre pas porte `hidden`
- volet et frise fermés au chargement à toutes les largeurs ; la liste ne part qu'ouverte (2 requêtes au démarrage plutôt que 14)
- rangée de puces sous la recherche (Frises, six facettes, Zone visible, filtres posés), sur plusieurs lignes au large, défilante avec fondu au doigt ; un menu par facette en `position: fixed`, exclusif avec le tiroir ; « effacer » collé au bouton Filtres
- la frise suit le thème, se replie partout, et les deux axes ont désormais un chemin clavier complet
- `Timeline` est chargée en `import()` dynamique, hors du chunk de page
- le volet est un calque (`position: absolute`), jamais une colonne de grille qui comprime la carte ; son fond, jamais celui de ce qui défile dedans
- le focus suit les calques ouverts par un geste, jamais ceux posés par un permalien, toujours en `preventScroll` ; `inert` est posé depuis la page, tiroir fermé compris
- `Échap` global ferme le calque le plus haut ; les composants qui le gèrent localement appellent `preventDefault`
- deux états vides (`.vide-liste`, `.vide-carte`) évitent qu'un filtre trop serré laisse un écran blanc
- la fiche se ferme à la frappe dans la recherche et à tout changement de critère, sans reprendre le focus ; pas quand le changement arrive avec la notice (permalien, retour)
- fiche : rangée d'actions (voir sur la carte, itinéraire OSM, partager au doigt, copier le lien), statut glosé, flèches entre photos, « À proximité » sans les filtres, fermer = retour à la liste quand elle est dessous
- liste : siècle et pastille de statut, ordres mobilier/pertinence, A–Z, proximité ; pagination par 200 ; survol d'une ligne = anneau sur la carte
- les cibles touchent 44 px par un `::after` transparent, jamais par un agrandissement de la pilule
- tout `:hover` vit sous `@media (hover: hover)`, toute couleur vit dans `app.css` — vérifiés par lecture de source (`11-sources.spec.ts`)
- trois défauts mobiles partagés : `100dvh`, `overscroll-behavior: contain`, un seul redessin de graphique par image
- les jetons `--sa-*` (+ `viewport-fit=cover`) tiennent la mise en page hors des zones physiques iOS
- `.scene` en `overflow: clip` ; le fond de la fiche sur `.fiche-hote`, jamais sur `.fiche` qui défile
- la feuille doit avoir une **hauteur définie** (flex, pas grille + `max-height`) sinon elle ne défile pas ; crans par `transform` (`REPLIEE` / `PART_CACHEE` égaux au style), aperçu non modal
- sous 768 px plus d'onglets : la feuille porte la liste, `.bascule` masquée ; champs à 16 px au doigt contre le zoom iOS

### Photographies — [docs/conception-photographies.md](docs/conception-photographies.md)

- trois ponts mesurés : Wikidata (84,6 %), Commons (+1,1 pt, fichiers citant la notice), Mémoire (renvoi seul, jamais repris — droits non libres)
- le cadre de la fiche épouse le rapport réel du fichier, borné à 0,68–1,9, glissement en `cover` au-delà
- geosearch et PMTiles sont écartés, décisions closes, chiffres à l'appui

## Convention

**La langue du code est le français** : identifiants, commentaires, libellés. Les
commentaires expliquent le *pourquoi* (une anomalie du corpus, une contrainte
mesurée), pas le *quoi*.

## Décisions volontairement laissées ouvertes

- **Dynastie Gabriel** : `Gabriel Jacques`, `Gabriel Ange-Jacques`, `Gabriel
  Jacques-Ange` — père, fils, et probable transposition. Fusionner demande une
  certitude éditoriale ; une ligne dans `data/ref/auteurs_alias.csv` suffira.
- **COG historisé** : `COG_Insee_lors_de_la_protection` conserve le code au moment
  de la protection. Toute jointure avec un COG actuel exige une table de
  correspondance des fusions de communes.

## Reste à faire

- **`etat_de_conservation` (colonne 29 du CSV) reste hors de l'ETL.** Renseignée pour
  **2 515 notices seulement (5,4 %)** : vestiges 1 250 · fragment 448 · désaffecté 321 ·
  détruit 88, et le vocabulaire est mêlé de texte libre (`restauré en 2020`, `Etat
  préoccupant`). Utilisable en facette, **jamais** pour dessiner « ce qui est intact » :
  l'absence de valeur ne dit pas bon état, elle dit champ non rempli sur 94,6 % du corpus.
- **Une feuille de style qui ne charge pas laisse la carte muette.** `style.load` n'est
  alors jamais émis, `pret` reste faux et les points ne reviennent pas — sans message.
  Cela valait déjà pour le montage ; depuis que `setStyle` suit le thème, cela vaut
  aussi pour une bascule. Ce qu'il faut : un `map.on('error')` qui, sur une erreur de
  style, remette `fondPose` à sa valeur précédente pour qu'une seconde tentative soit
  possible, et un mot à l'écran.
- **`maplibre-gl` 4.x traîne un avis critique.** `npm audit` : XSS via `DOM.sanitize()`
  (GHSA-jrc7-96c5-q579, CVSS 10, versions ≤ 6.4.0) sur la version installée (4.7.1,
  `^4.7.1` dans `package.json`) ; `npm audit` propose 6.9.0, une montée **majeure**
  (4 → 6). À évaluer avant de monter — tous les pièges MapLibre documentés
  (`docs/contraintes.md`, `docs/conception-carte.md` : `setStyle`/`diff: false`/`pret`,
  `maxzoom` des fonds IGN, `pixelRatio`) sont à revérifier après une montée majeure,
  pas seulement les API dépréciées.
- **Deux anomalies relevées par l'audit ETL, non corrigées.** `propriété de la
  communauté de commune` au singulier (1 notice) — la forme plurielle correcte est déjà
  redressée dans `data/ref/vocabulaires.csv`, celle-ci lui a échappé ; et une ligne
  `Statut_juridique_de_l_edifice` où deux valeurs sont séparées par une virgule au lieu
  du `;` attendu (1 notice : `Propriété de la commune, propriété de la communauté de
  communes`, lue aujourd'hui comme une seule valeur composite).
- **Repères d'histoire sur les frises.** Attention, ils ne vont pas sur la même piste :
  Guerre de Cent Ans et Révolution sur l'axe *construction*, 1840 (première liste
  Mérimée), 1913 (loi) et 1962 (Malraux) sur l'axe *protection*. Les mélanger sur une
  seule frise serait faux.
- Export CSV de la sélection courante (la liste, elle, se pagine désormais au-delà de
  200 lignes ; les filtres « figures » sont devenus les raccourcis du champ vide).
- Exploitation NLP des 23,6 Mo de texte libre. **L'indexation lexicale est faite**
  (`texte.py`, BM25) sur les 15,1 Mo d'`historique` ; ce qui reste est l'extraction
  d'entités, et `precision_protection` — 6,7 Mo de langue d'arrêtés — n'est pas indexé.
- **PMTiles est incompatible avec le filtrage croisé**, définitivement : une tuile
  précalculée ne peut pas porter un prédicat dynamique à 13 clés. Figer les points en
  tuiles reviendrait à supprimer la fonction centrale du site. Ne pas rouvrir.
- Une agrégation en grille aux zooms lointains ne demanderait **pas** l'extension
  `spatial` de DuckDB ni H3 : `floor(lon / pas)` suffit. Elle ne se justifie que si
  `sql` devient le poste dominant, ce qu'il n'est pas (12 ms de moteur).
- **Doublons d'auteurs rendus visibles par la recherche de facette** : le corpus
  contient `Baltard Louis-Pierre` et `Baltard, Louis-Pierre`. La virgule sépare une
  poignée d'identités qui devraient être fusionnées ; invisible tant que seules les
  40 valeurs les plus fréquentes s'affichaient. Une ligne dans
  `data/ref/auteurs_alias.csv` par cas, comme pour la dynastie Gabriel.
