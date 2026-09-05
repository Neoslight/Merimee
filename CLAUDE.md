# CLAUDE.md

Repère de travail pour ce dépôt. Le détail fonctionnel est dans [README.md](README.md),
l'audit du fichier source dans [ANALYSE_MERIMEE.md](ANALYSE_MERIMEE.md).

## Ce qu'est le projet

Tableau de bord d'exploration des 46 760 immeubles protégés au titre des Monuments
historiques (base Mérimée / POP). Carte WebGL, filtrage croisé instantané, double
frise chronologique (époque de construction × année d'arrêté de protection).

**Site statique, sans backend.** Un pipeline Python produit des Parquet, le
navigateur les interroge en SQL via DuckDB-Wasm.

```
data/raw/merimee.csv  ──ETL Python──▶  web/static/data/  ──▶  DuckDB-Wasm (navigateur)
    100 Mo, 78 colonnes                2,7 Mo + 32 fragments
```

## Disposition

| Chemin | Rôle |
|---|---|
| `data/raw/merimee.csv` | source, **non versionnée** (100 Mo) |
| `data/ref/*.csv` | décisions éditoriales, **versionnées** : alias d'auteurs, corrections de vocabulaire |
| `data/ref/wikidata_images.csv` | instantané tiers, 2,4 Mo — pas une décision éditoriale, cf. plus bas |
| `etl/merimee_etl/wikidata.py` | récupère cet instantané, **jamais appelé par le pipeline** |
| `etl/merimee_etl/` | pipeline : `load` → `normalize` → `parse` → `build`, piloté par `cli` |
| `etl/tests/test_pipeline.py` | 55 tests : unitaires sur les cas tordus + intégration sur les artefacts |
| `etl/out/rejets.csv` | segments hors-format rencontrés, jamais supprimés silencieusement |
| `web/src/lib/db/` | `duckdb.ts` (bootstrap, fragments), `queries.ts` (requêtes), `shards.ts` (hachage) |
| `web/src/lib/state/filters.svelte.ts` | état des filtres + construction du prédicat SQL |
| `web/src/lib/state/permalien.ts` | sérialisation de l'état dans l'URL (`encoder` / `decoder`) |
| `web/src/lib/state/amorcage.svelte.ts` | phase et octets du démarrage, lus par l'écran d'attente |
| `web/src/lib/state/theme.svelte.ts` | thème sombre/clair, et la palette résolue que lisent MapLibre et Plot |
| `web/src/lib/format.ts` | `romain`, formats de nombres — étaient recopiés dans trois composants |
| `web/src/service-worker.ts` | cache des actifs hachés uniquement |
| `web/src/lib/components/` | `MonumentMap`, `FacetPanel`, `Jetons`, `Timeline`, `Matrice`, `DetailPanel` |
| `web/tests/smoke.mjs` | 70 vérifications en Chromium réel, avec `serveur.mjs` instrumenté |
| `web/tests/apercu-social.mjs` | régénère la vignette Open Graph depuis l'application |

## Commandes

```bash
cd etl  && python -m merimee_etl        # ~11 s, écrit web/static/data/
cd etl  && python -m merimee_etl.wikidata  # rafraîchit l'instantané des photos
cd etl  && python -m pytest tests -q    # 55 tests
cd web  && npm run dev                  # http://localhost:5173
cd web  && npm run check                # svelte-check, doit rester à 0/0
cd web  && npm run build && npm run test # build statique + 70 vérifications navigateur
cd web  && npm run apercu               # régénère static/apercu-social.png
cd web  && npm run deploy               # build /Merimee + push sur gh-pages
```

Le smoke test démarre son propre serveur statique et écrit `web/tests/apercu.png`.
Il exige `npx playwright install chromium` une fois.

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

**`Date_de_creation_de_la_notice` n'est pas une date métier** (79 % au 1993-03-29,
date d'informatisation), `Date_de_la_derniere_mise_a_jour` non plus (reprise
technique 2025-2026).

## Contraintes techniques découvertes à l'exécution

Ces trois points ont coûté du temps ; ne pas les redécouvrir.

**duckdb-wasm 1.32 télécharge tout fichier Parquet en entier.** Aucune requête HTTP
Range n'est émise, ni avec `registerFileURL(..., directIO: true)`, ni avec une URL
absolue passée directement à `read_parquet`. Vérifié en navigateur, comptage côté
serveur. Conséquence : **le fichier est la seule granularité de chargement**, d'où
l'éclatement de `details` en 32 fragments. Si une version future corrige cela, le
fragment redevient inutile — mais le vérifier par la mesure, pas par la doc.

**Le hachage FNV-1a est dupliqué** dans `etl/merimee_etl/build.py` (`fnv1a`) et
`web/src/lib/db/shards.ts`. Toute modification doit toucher les deux ;
`test_hachage_stable` verrouille trois valeurs de référence.

**Bundle DuckDB `eh`, jamais `coi`.** Le multi-thread exige COOP/COEP, impossibles
sur un hébergement statique.

**`web/static/.nojekyll` conditionne le déploiement.** Sans lui, GitHub Pages passe
le site à Jekyll, qui ignore les dossiers commençant par un tiret bas : tout `_app/`
renvoie 404. Ne pas le supprimer en croyant à un fichier vide oublié.

**GitHub Pages compresse bien le `.wasm` mais ne le met presque pas en cache.**
Mesuré en ligne : `duckdb-eh.*.wasm` sort à 7,5 Mo gzip (32,7 Mo bruts), mais avec
`Cache-Control: max-age=600` — dix minutes, non configurable sur Pages. Le hash du
nom de fichier ne sert donc à rien au-delà : une visite espacée repaie les 7,5 Mo.
Si cela devient gênant, la seule sortie est un service worker qui met le wasm en
cache lui-même. Amorçage mesuré en ligne : 3,9 s.

**Le service worker ne met en cache que `build`.** Ces actifs portent un hachage :
un contenu différent porte un nom différent, ils ne peuvent pas devenir périmés.
Les Parquet de `data/` en sont volontairement exclus — leurs noms sont stables
d'un déploiement à l'autre, les mettre en cache exposerait à servir d'anciennes
données après une passe d'ETL. Le shell HTML n'est pas mis en cache non plus,
et c'est ce qui évite qu'un déploiement reste collé : la page revient toujours
du réseau, donc pointe toujours vers les derniers actifs hachés. Le cache porte
un **nom stable**, purgé par différence à l'activation : le nommer par version
ferait retélécharger le wasm à chaque déploiement, alors que son hachage ne
bouge qu'à une montée de version de DuckDB. **Pour repartir de zéro chez un
visiteur** : DevTools → Application → Service Workers → Unregister, puis vider
le stockage.

**Le rappel de progression de duckdb-wasm ne remonte pas jusqu'à la page.**
`instantiate()` accepte bien un gestionnaire `{ bytesLoaded, bytesTotal }`, et le
worker poste des messages `INSTANTIATE_PROGRESS` — mais aucun n'a été observé,
ni en local ni sur le site publié : le binaire est téléchargé par le web worker,
qui a sa propre chronologie (il n'apparaît pas non plus dans
`performance.getEntriesByType('resource')` de la page). Une barre de progression
a été écrite puis retirée. Ne pas la réécrire sans mesurer d'abord que le rappel
se déclenche. Les libellés de phase, eux, sont exacts.

**Mesurer le cache du service worker : ni `page.on('response')` ni
`performance` ne servent.** Le premier voit une paire cache/réseau indiscernable,
le second ignore les requêtes du worker. Les deux mesures qui font foi sont le
compteur d'octets côté serveur de `tests/serveur.mjs` (0 Ko au troisième
chargement) et le contenu de `caches.open('merimee-actifs')` lu depuis la page.

**Sous Git Bash, MSYS réécrit toute variable d'environnement commençant par `/`**
en chemin Windows. `BASE_PATH` est donc normalisée dans `svelte.config.js` et se
passe sans slash initial.

**`plot.value` d'Observable Plot reste nul** sur une marque non interactive. Pour
rendre une barre cliquable, retrouver la bande via `graphe.scale('x')`, pas via la
cible du clic. **L'axe des siècles est une échelle à bandes : `invert` n'existe pas.**
Le pixel se retraduit en balayant les bandes, et il se rattache à la **plus proche**,
pas à celle qu'il touche : `barY` laisse un intervalle entre les barres, et un
brossage qui démarre dans un intervalle serait perdu. Hors de la zone des barres —
la marge de l'axe — rien n'est visé.

**`map.setStyle()` détruit toutes les sources et couches ajoutées.** Changer de fond
avec le thème veut dire les reposer entièrement : d'où `poserCouches()` dans
`MonumentMap.svelte`, branchée sur `style.load` — le seul événement qui couvre le
montage **et** chaque changement de style — et non sur `load`, qui ne se déclenche
qu'une fois. `pret` retombe pendant la bascule pour que les effets qui repeuplent la
carte n'écrivent pas dans le vide. Le test `les couches survivent au changement de
fond` verrouille ce point : un `setPaintProperty` sur une couche disparue lève, donc
c'est le compteur d'erreurs console qui fait foi.

**Chromium sans tête annonce `prefers-color-scheme: light`.** Les deux scripts
Playwright forcent donc `colorScheme` : `smoke.mjs` démarre en sombre pour avoir
quelque chose à basculer, `apercu-social.mjs` aussi pour que la vignette soit la même
d'une machine à l'autre.

## Règles de conception

**Colonnes `LIST` plutôt que tables de liaison.** Domaines, siècles, dénominations,
auteurs, propriétaires sont des listes dans `monuments`. Filtrage par
`list_has_any`, facettage par `UNNEST`. Seuls les actes de protection ont leur table.

**Une facette ne montre que ses 40 valeurs les plus fréquentes ; sa recherche,
elle, fouille tout.** Filtrer en JavaScript la liste déjà rapatriée laissait
7 000 des 7 040 auteurs inatteignables. `facette(f, cle, limite, terme)` descend
le `LIKE` dans DuckDB via `strip_accents(lower(...))`, et **épingle les valeurs
cochées** : sans cela, saisir un terme rendrait impossible de les décocher.

**Les facettes s'évaluent sans leur propre filtre.** `buildWhere(filtres, except)` —
retirer ce mécanisme fait tomber à zéro toutes les options non cochées et tue le
filtrage croisé. `queries.facette()` passe systématiquement la clé en `except`.

**Les deux panneaux sont des calques, pas des colonnes.** Le tiroir des facettes et la
fiche flottent au-dessus de la carte (`position: absolute` dans `.scene`), et non plus
dans une grille `246px | 1fr | 340px` qui compressait le canevas en permanence — 340 px
étaient réservés pour afficher « Sélectionnez un point ». Trois conséquences à ne pas
défaire :

- **les ouvrir ne redimensionne pas le canevas WebGL.** C'est la raison d'être du choix.
  `le tiroir ne prend pas de largeur à la carte` le mesure, avant/après, en pixels ;
- **MapLibre ne redimensionne pas son canevas tout seul.** La bande de puces qui
  apparaît au premier filtre change la hauteur de la scène : `MonumentMap` porte donc un
  `ResizeObserver` → `map.resize()`. Sans lui la carte reste dessinée à l'ancienne taille
  et décalée du pointeur ;
- **les commandes MapLibre doivent s'écarter des calques.** L'attribution CARTO est
  passée en **bas à gauche** (`attributionControl: false` puis `addControl(...)`) parce
  qu'à droite la fiche la recouvrait : une mention de licence masquée n'est pas une
  mention. Elle et le zoom suivent `--marge-gauche` / `--marge-droite`, posées par la
  page. Le composant carte n'a pas à connaître l'existence d'un panneau de facettes.

Pas de `backdrop-filter` sur ces calques : un flou plein écran au-dessus d'un canevas
WebGL se paie à chaque image.

**Deux filtres ont un état miroir hors de `filters`.** `retirer()` ne suffit donc pas,
et c'est la page qui complète : `recherche` a le champ de la barre, qui l'alimente par
un effet retardé et garderait son texte ; `bbox` a `suivreVue` dans `MonumentMap`, qui
la reposerait au prochain `moveend` — d'où `delierVue()`. Même chose pour `reset()`.

**Le nom accessible d'une puce porte l'action, pas la valeur** (`aria-label="Retirer le
filtre architecture militaire"`). Sinon la puce et l'option de même libellé dans le
panneau de facettes deviennent deux boutons indiscernables, pour un lecteur d'écran
comme pour Playwright en mode strict. Même règle pour « Copier le lien » de la fiche,
homonyme de celui de la barre.

**Le thème n'est pas dans l'URL.** C'est une préférence de lecture, pas un état
d'exploration : elle vit dans `localStorage` et un lien partagé s'ouvre dans le thème
de celui qui le reçoit. Même règle que les tiroirs du gabarit téléphone. Un script
inline en tête d'`app.html` pose `data-theme` avant le premier paint — sans lui le
site est prérendu en sombre puis bascule à l'hydratation.

**Toute couleur vit dans `app.css`.** MapLibre et Plot ne savent pas lire une `var()` :
`theme.svelte.ts` relit les jetons par `getComputedStyle` à chaque bascule et les
expose dans `palette`. Une couleur écrite en dur dans un composant resterait muette
au passage en clair — il n'en reste aucune, c'est vérifiable d'un `grep '#[0-9a-f]\{6\}' src`.

**L'URL porte l'état d'exploration.** `permalien.ts` encode filtres, vue et notice
sélectionnée. Trois points non négociables : les valeurs multiples passent par un
**paramètre répété** (`?domaine=x&domaine=y`) — 63 libellés du corpus contiennent
déjà une virgule, tout séparateur imprimable serait ambigu ; `bbox` est **exclue**,
sinon chaque pan de carte réécrirait l'URL ; la **vue** (`c=lon,lat,zoom`) suit une
règle à part — jamais écrite dans l'URL vivante, ajoutée seulement au lien produit par
« Copier le lien », et consommée au chargement. Conséquence à ne pas rouvrir :
l'effet URL → état compare des chaînes **normalisées** (`encoder(decoder(search))`) et
non la chaîne brute, sinon `c=` paraît toujours différent de l'état, les deux effets se
renvoient la balle et le `replaceState` part avant que SvelteKit ait monté sa racine
(`Cannot read properties of undefined (reading '$set')`) ; l'écriture se fait par `replaceState`,
sauf l'ouverture d'une fiche qui empile (`pushState`) pour que le retour arrière la
referme. `decoder` valide toute valeur : l'URL est éditable à la main et ses chaînes
finissent dans `lit()`.

**Un jeton monotone annule les résultats obsolètes** dans `+page.svelte` : une
requête lente ne doit jamais écraser une plus récente.

**La matrice retire un filtre par axe.** `buildWhere` accepte une liste de clés
à exclure ; `matrice()` en passe deux (`siecles`, `anneeProtection`), sinon
choisir une cellule réduirait la matrice à cette seule cellule. Les couples
(notice, siècle, décennie) sont dédoublonnés : une notice à deux actes dans la
même décennie compterait deux fois. Les siècles antérieurs au 10e sortent des
axes mais leur nombre est affiché sous le graphique.

**Les photographies viennent d'un instantané, pas d'une requête vivante.** La base
Mérimée ne porte **aucun lien vers une image** : ni colonne Mémoire, ni Wikidata, ni
fichier. Le seul pont est Wikidata (`P380` identifiant Mérimée → `P18` image), et il
couvre **39 556 notices sur 46 760, soit 84,6 %**. `python -m merimee_etl.wikidata`
écrit `data/ref/wikidata_images.csv` ; `python -m merimee_etl` **ne l'appelle jamais**,
il se contente de la colonne `commons` des fragments — vide si l'instantané est absent.
C'est ce qui garde le pipeline hors-ligne et les tests sans réseau. Trois conséquences :

- le fichier est versionné dans `data/ref/` mais **ce n'est pas une décision
  éditoriale** : c'est une base tierce datée, qui vieillit ;
- le crédit auteur / licence est lu à la volée sur l'API Commons parce que Wikidata ne
  le porte pas. La plupart de ces images sont sous CC-BY-SA : **le crédit est une
  obligation**. Il n'est jamais bloquant, et son échec laisse le lien vers la page du
  fichier, qui porte l'information complète ;
- une notice sur six n'a pas d'image : la section montre alors une **plaque nommée** —
  dénomination, domaine, et la mention « aucune photographie sur Wikimedia Commons » —
  au même rapport 4/3 que la photo qu'elle remplace. Ce qu'elle ne fait pas, c'est
  ressembler à un chargement : ni animation, ni icône brisée, ni dégradé. La règle
  antérieure (« la section disparaît ») a été **inversée volontairement** ; le cadre
  gris muet qu'elle interdisait, lui, reste interdit.

Le magasin de certificats par défaut de Python sous Windows a rendu un
`CERTIFICATE_VERIFY_FAILED: certificate has expired` sur ce point d'entrée ; le module
passe par `certifi` quand il est installé.

**Les rejets sont signalés, pas supprimés.** Un segment de date illisible produit
quand même un événement (année nulle) et une ligne dans `etl/out/rejets.csv`.

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

- Export CSV de la sélection courante, et liste paginée au-delà des 200 lignes.
- Filtres « figures » préréglés (Vauban, Guimard, Le Corbusier) en un clic, au-dessus
  de la facette auteurs existante. Devenus de simples liens depuis les permaliens.
- Exploitation NLP des 23,6 Mo de texte libre (`historique`, `precision_protection`).
- **Fonds de carte historiques en superposition**, mesuré et prêt à poser. Géoplateforme
  IGN, **sans clé d'API**, `access-control-allow-origin: *`, `cache-control` 21 jours :
  - Cassini = `BNF-IGNF_GEOGRAPHICALGRIDSYSTEMS.CASSINI` (le préfixe `BNF-IGNF_` est
    obligatoire, l'identifiant nu renvoie 400), PNG, **z ≤ 14, ~160 Ko la tuile** —
    ~2 Mo par écran, donc superposition explicite et jamais par défaut ;
  - État-Major = `GEOGRAPHICALGRIDSYSTEMS.ETATMAJOR40`, JPEG, **z ≤ 15, ~18 Ko**.
  `poserCouches()` est déjà le bon point d'accroche, avec un `beforeId` sous
  `monuments-densite`.
- **Repères d'histoire sur les frises.** Attention, ils ne vont pas sur la même piste :
  Guerre de Cent Ans et Révolution sur l'axe *construction*, 1840 (première liste
  Mérimée), 1913 (loi) et 1962 (Malraux) sur l'axe *protection*. Les mélanger sur une
  seule frise serait faux.
- **Matrice typologie × siècle**, variante de la matrice existante : `domaines` compte
  **20 valeurs distinctes** (architecture domestique 19 154, religieuse 15 567,
  militaire 1 688…), soit 20 × 12 cellules, comparable aux 205 actuelles.
  `denominations` en compte 714 et ne fait pas un axe.
- **`etat_de_conservation` (colonne 29 du CSV) reste hors de l'ETL.** Renseignée pour
  **2 515 notices seulement (5,4 %)** : vestiges 1 250 · fragment 448 · désaffecté 321 ·
  détruit 88, et le vocabulaire est mêlé de texte libre (`restauré en 2020`, `Etat
  préoccupant`). Utilisable en facette, **jamais** pour dessiner « ce qui est intact » :
  l'absence de valeur ne dit pas bon état, elle dit champ non rempli sur 94,6 % du corpus.
- Auteur cliquable dans la fiche, ouvrant ses autres réalisations — `filters.auteurs`
  existe déjà, c'est une poignée de lignes.
- `deck.gl` reste l'échappatoire si le rendu GeoJSON de 44 k points devient limitant ;
  l'interface de la couche est isolée dans `MonumentMap.svelte`. La couche `heatmap`
  native ajoutée depuis répond déjà à la saturation aux vues larges — mesurer avant
  d'y toucher.
- **Doublons d'auteurs rendus visibles par la recherche de facette** : le corpus
  contient `Baltard Louis-Pierre` et `Baltard, Louis-Pierre`. La virgule sépare une
  poignée d'identités qui devraient être fusionnées ; invisible tant que seules les
  40 valeurs les plus fréquentes s'affichaient. Une ligne dans
  `data/ref/auteurs_alias.csv` par cas, comme pour la dynastie Gabriel.
