# Contraintes techniques découvertes à l'exécution

Déplacé de `CLAUDE.md`, qui n'en garde plus que l'index. Lire cette page avant
de toucher à DuckDB-Wasm, MapLibre, Observable Plot, le service worker ou le
déploiement GitHub Pages — chaque point ici a coûté du temps de mesure une
première fois.

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
Un service worker met désormais le wasm en cache lui-même — cf. le point suivant,
ce n'est plus une sortie hypothétique. Amorçage mesuré en ligne : 3,9 s.

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

**Le premier écran ne dépend plus du moteur : `points.json`.** Sur téléphone, la carte
restait vide le temps de télécharger DuckDB-Wasm (7,5 Mo gzip) **puis de compiler 34 Mo
de wasm** sur un processeur mobile — alors que 44 484 points sans filtre ne demandent
aucun SQL. L'ETL écrit donc `points.json` (`build.py::points_colonnaires`), servi tout
de suite et remplacé par la première réponse du moteur. Mesuré : **1,6 Mo brut, 446 Ko
gzip**. Quatre points à ne pas défaire :

- **JSON et non binaire** : GitHub Pages compresse `application/json`, pas un `.bin` ; des
  flottants bruts se compressent mal et partiraient à ~1 Mo non gzippés. Colonnes et non
  entités GeoJSON (les clés ne se répètent pas), coordonnées à 5 décimales, statut en index
  dans une table portée par le fichier ;
- **il sort de la même passe que `monuments.parquet`** : `test_points_instantanes`
  vérifie mêmes références, même ordre, mêmes comptes. Un nuage divergent changerait de
  points sous les yeux au remplacement ;
- **le service worker ne le met pas en cache**, comme tout `data/` : son nom est stable
  d'un déploiement à l'autre ;
- **il n'est pas demandé quand l'URL porte un filtre** — il peindrait le corpus entier
  avant la restriction. `09-mobile.spec.ts` le vérifie, et vérifie aussi, wasm retenu
  quatre secondes, que la carte est peinte avant que le moteur soit prêt.

`app.html` pose en outre deux `preconnect` : `basemaps.cartocdn.com` (la feuille) et
`tiles.basemaps.cartocdn.com` (sprites, polices, TileJSON), hôtes relevés dans
`style.json`. Sur réseau mobile la poignée de main TLS se paie avant la moindre tuile.

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

**Les fonds historiques IGN sont posés, et `maxzoom` est le piège du dispositif.**
Géoplateforme, **sans clé d'API**, `access-control-allow-origin: *`, `cache-control`
21 jours. Remesuré à l'intégration : Cassini =
`BNF-IGNF_GEOGRAPHICALGRIDSYSTEMS.CASSINI` — le préfixe `BNF-IGNF_` est **obligatoire**,
l'identifiant nu renvoie 400 — PNG, **z ≤ 14, 172 Ko la tuile**, soit ~2 Mo par écran ;
État-major = `GEOGRAPHICALGRIDSYSTEMS.ETATMAJOR40`, JPEG, **z ≤ 15, 20 Ko**.

Trois points à ne pas défaire :

- **`maxzoom` sur la source n'est pas une précaution.** Sans lui, MapLibre réclame des
  tuiles au-delà de la résolution réelle et **la couche disparaît au moment précis où
  l'on zoome sur l'édifice**. Avec, il étire la dernière tuile disponible. `04-carte-et-fonds.spec.ts`
  cadre à z16 (via `c=`, seul chemin fiable pour poser un zoom) et vérifie, **par
  sondage** plutôt que par un délai fixe, que le niveau demandé plafonne à 14 — ce
  passage au sondage a supprimé une intermittence mesurée sur l'ancien délai fixe de
  1500 ms ;
- **les couches naissent en `visibility: 'none'`** et se posent **avant** celles des
  monuments — MapLibre empile dans l'ordre d'ajout, donc pas de `beforeId` ici : les
  couches qu'il viserait n'existent pas encore et le passer lèverait. Aucun octet IGN
  ne part tant qu'un fond n'est pas demandé, ce qui tient l'engagement face aux 2 Mo
  de Cassini ;
- **l'attribution est portée par la source**, donc ajoutée et retirée par MapLibre avec
  la couche. Ce sont des reproductions BnF / IGN : la mention est une obligation, pas
  une politesse.

**Le fond historique est dans l'URL, son opacité non.** Même partage qu'avec le thème :
quelle carte ancienne on regarde est un état d'exploration (`fond=cassini`), à quel
dosage on la lit est un confort de lecture, qui reste dans le composant.

**La suite e2e (`web/tests/e2e/`) n'appelle jamais la Géoplateforme.** Les tuiles sont
interceptées par `page.route` et la **forme des URL** est vérifiée, pas le contenu. Ce
dépôt tient ses tests hors réseau — l'ETL est conçu ainsi délibérément — et une suite
qui dépend de la disponibilité d'un service tiers devient intermittente.

**En revanche, elle appelle bien CARTO.** L'ancien `smoke.mjs` le faisait déjà en
silence — `page.route` n'a jamais couvert `basemaps.cartocdn.com` — mais seules des
formes d'URL étaient vérifiées, si bien que la suite passait avec un fond absent.
`le fond clair est reteinte` (`05-theme.spec.ts`) lit désormais le **résultat** : la
suite échoue si la feuille ne charge pas. C'est un choix assumé — sans CARTO le site
est inutilisable, et boucher la feuille par une maquette locale rendrait le décompte
constant par construction, donc muet sur la seule chose qui puisse casser.

**`map.setStyle()` détruit toutes les sources et couches ajoutées.** D'où
`poserCouches()` dans `MonumentMap.svelte`, branchée sur `style.load` — le seul
événement qui couvre le montage **et** chaque changement de style — et non sur `load`,
qui ne se déclenche qu'une fois. Le fond suivant de nouveau le thème, `setStyle` est
appelé à chaque bascule et ce piège est redevenu vivant. Trois points le tiennent :

- **`diff: false` n'est pas une précaution, c'est la condition pour que `style.load` se
  déclenche.** Par défaut MapLibre **compare** l'ancienne feuille à la nouvelle et
  n'applique que l'écart : la `Style` est conservée, l'événement n'est pas ré-émis,
  `poserCouches()` n'est jamais rappelée et `pret` reste faux pour toujours. Rien ne
  lève — nos couches survivent au diff, les points continuent de s'afficher — et seul
  le repeint du fond manque à l'appel. Mesuré : sans ce drapeau, la teinture reste à
  zéro et la rampe de densité sur l'ancien thème, alors que **tous les tests passaient**
  sauf ceux qui lisent `window.__carte`. C'est exactement la panne muette que ce relevé
  existe pour attraper ;
- **`pret` retombe à faux avant l'appel, pas dans le rappel.** `setStyle` détruit les
  couches de manière synchrone et les effets Svelte sont regroupés en microtâche : rien
  ne s'intercale entre les deux instructions. Un `setPaintProperty` sur une couche
  disparue lève, et c'est le compteur d'erreurs console qui fait foi ;
- **`pret` est aussi le signal de réarmement**, et il doit être lu en **première**
  instruction par tout effet qui touche une couche. C'est cette lecture qui les
  enregistre comme dépendants et les rejoue quand `poserCouches()` le remet à vrai —
  redondant avec ce que `poserCouches()` pose déjà, et volontairement. Déplacer un
  `if (!pret)` après un autre test casserait le réarmement sans qu'aucun test ne bouge.

L'effet ne part pas au montage : `fondPose` est un simple `let`, initialisé par
`untrack` à la feuille que le constructeur vient de poser, si bien que le premier
passage constate qu'il n'a rien à faire. En `$state`, il ferait boucler l'effet qui
l'écrit.

**Chromium sans tête annonce `prefers-color-scheme: light`.** Chaque fichier de la
suite e2e force donc `colorScheme` au montage de son contexte — la plupart démarrent
en sombre pour avoir quelque chose à basculer — et `apercu-social.mjs` aussi, pour que
la vignette soit la même d'une machine à l'autre.

**La chaîne des points va des vecteurs Arrow au GeoJSON, sans objets intermédiaires.**
Mesuré d'abord (`mesures.svelte.ts`, relevé imprimé par `12-performance.spec.ts`), sur
44 484 points : **SQL 13 ms · Arrow→JS 52 ms · GeoJSON 75 ms · `setData` 15 ms, total
156 ms**. Deux enseignements : la saturation qu'on redoute d'ordinaire n'existe pas ici
— MapLibre dessine en WebGL, pas dans le DOM, et le rendu ne pesait que 10 % — mais
**81 % du temps partait en fabrication d'objets JavaScript**, deux jeux de 44 484, un
par `row.toJSON()`, un par la `FeatureCollection`. `points()` lit désormais les colonnes
et ne construit plus qu'un jeu : **SQL 12 ms · GeoJSON 27 ms · `setData` 16 ms, total
55 ms**, sans dépendance nouvelle. Quatre points à ne pas défaire :

- **le parcours va lot par lot** (`table.batches`), et non par `table.getChild()` sur la
  table entière : DuckDB rend une vingtaine de fragments, et `toArray()` sur le vecteur
  d'un lot unique rend une **vue** du tampon, pas une copie ;
- **les types sont fixés en SQL** (`::DOUBLE`, `::INT`) plutôt que devinés à la lecture. Un
  `BIGINT` rendrait un `BigInt64Array`, dont les `bigint` ne se comparent pas dans une
  expression MapLibre ;
- **`pointsCarte` est un `$state.raw`.** Le nuage est remplacé en bloc à chaque filtre,
  jamais modifié en place : un état profond ferait de MapLibre le déclencheur de 44 484
  proxies, pour une réactivité dont personne ne se sert ;
- `deck.gl` ne se justifierait que si `setData` dominait — il pèse 16 ms — et PMTiles reste
  incompatible avec le filtrage croisé. Ni l'un ni l'autre à rouvrir.

**`mesures.sql` est un temps de bout en bout, pas un temps moteur.** Les requêtes d'un
cycle partagent **une seule connexion** DuckDB et s'y sérialisent : la requête des points
attend derrière les balayages du cycle précédent. Mesuré : le même filtre « Corse » coûte
**91 ms** de `sql` quand il succède au corpus entier, **14 ms** quand il succède à un autre
filtre serré. Conséquence pour `12-performance.spec.ts` — le total d'un petit résultat peut
dépasser celui du gros, et la comparaison des deux régimes porte donc sur `collection`,
seul poste qui suive le volume.

**Le `setData` qui suit un `setStyle` a l'air gratuit. Il ne l'est pas.** L'effet qui
pose les points lit `pret`, donc se rejoue après chaque bascule de thème et repose des
points que `poserCouches()` vient de poser — 15 ms en apparence perdues. **Ne pas les
économiser.** Mesuré : avec un garde `points === dernierNuagePosé`, la source GeoJSON
reste sur le chargement pendant ouvert par `addSource` ; deux bascules rapprochées la
retirent en plein vol et MapLibre remonte `AbortError: signal is aborted without reason`
en console. Le `setData` redondant, lui, supersède ce chargement et l'annulation reste
interne. **Trois vérifications tombent sans lui** — dont `deux bascules rapides ne
laissent qu un style`, écrite exactement pour ce cas.

**`liseret()` a son propre effet, et c'est le seul endroit tenable.** Il croise le fond
posé (`fond`, `opaciteFond`) et la palette : le loger dans l'un des deux effets voisins
fait chaque fois du tort. Dans celui de la **palette**, chaque pas du curseur d'opacité
du fond historique devenait déclencheur de deux `circle-color` **data-driven** sur
44 484 points, pour une couleur inchangée — une saccade pendant l'interaction. Dans
celui des **fonds**, la palette devenait dépendance, et une bascule de thème rejouait
`setLayoutProperty` sur les couches raster : les tuiles repartaient, le `setStyle`
suivant les annulait, et l'`AbortError` ci-dessus remontait. Seul, il ne pose qu'une
couleur scalaire.

**`pixelRatio` est plafonné à 2.** Sans l'option, MapLibre suit `devicePixelRatio` : sur
un téléphone à 3x le canevas compose **neuf fois** les pixels CSS à chaque image de
déplacement, pour 44 484 cercles à liseré. L'écart visible est marginal, le fill-rate
économisé ne l'est pas. Invisible en test — Chromium sans tête annonce un ratio de 1,
comme il annonce `prefers-color-scheme: light`.

**Le wasm n'était découvrable qu'après exécution du JS — corrigé, mais pas par le
chemin qui semblait évident.** `duckdb.ts` importe le binaire en `?url` : une simple
chaîne lue à l'exécution, invisible au scanner de préchargement du navigateur tant que
le chunk de page n'a pas fini de se télécharger *et* de s'exécuter. `web/scripts/precharger.mjs`,
chaîné à `build` et `build:pages`, retrouve le fichier haché dans
`build/_app/immutable/assets/` après coup et injecte un `<link rel="preload" as="fetch"
crossorigin>` dans le shell HTML (`index.html` et `404.html`), pour que ses 7,7 Mo gzip
partent en parallèle du chunk de page plutôt qu'à sa suite. Trois points mesurés, à ne
pas redécouvrir :

- **le préchargement n'est repris que par un fetch du document**, pas par celui du
  worker. Laissé au worker (`new Worker()` puis son propre `fetch`), le binaire
  repartait sur le réseau une seconde fois — mesuré au compteur d'octets de
  `tests/serveur.mjs`, **deux copies, 68,5 Mo**. `duckdb.ts` récupère donc lui-même le
  binaire (`fetch` dans le document, là où le préchargement est repris de façon fiable)
  et le convertit en URL `blob:` que le worker fetch localement, sans repartir sur le
  réseau ; un échec (réseau, blob non supporté) retombe sur l'URL directe, exactement
  comme avant ce dispositif ;
- **le `Content-Type` doit être reposé explicitement** sur le `Blob` (`application/wasm`) :
  une URL `blob:` fetchée rend un type tiré du `Blob` lui-même, et `instantiateStreaming`
  exige `application/wasm` pour éviter de retomber sur la voie lente ;
- **le worker JS (773 Ko) n'est volontairement pas préchargé.** Mesuré sur Chromium :
  `as="worker"` y est refusé (« unsupported `as` value », ignoré, avertissement en
  console) ; `as="script"` est accepté mais sa destination ne correspond pas à celle de
  `new Worker()`, et le fichier part deux fois (1,5 Mo servis). Ne pas le rajouter sans
  remesurer.
