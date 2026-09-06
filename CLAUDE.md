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
| `data/ref/memoire_illustrations.csv` | instantané tiers, 554 Ko : un nombre par notice, **jamais une image** |
| `etl/merimee_etl/wikidata.py` | récupère cet instantané, **jamais appelé par le pipeline** |
| `etl/merimee_etl/` | pipeline : `load` → `normalize` → `parse` → `build`, piloté par `cli` |
| `etl/merimee_etl/texte.py` | index plein texte des historiques, **dégrade en silence** sans `fts` |
| `etl/merimee_etl/commons.py` | second instantané photo, séparé de `wikidata.py` — lancé à part |
| `etl/merimee_etl/memoire.py` | compte les illustrations POP **sans les reprendre** — lancé à part |
| `etl/tests/test_pipeline.py` | 64 tests : unitaires sur les cas tordus + intégration sur les artefacts |
| `etl/out/rejets.csv` | segments hors-format rencontrés, jamais supprimés silencieusement |
| `web/src/lib/db/` | `duckdb.ts` (bootstrap, fragments), `queries.ts` (requêtes), `shards.ts` (hachage), `texte.ts` (BM25) |
| `web/src/lib/state/filters.svelte.ts` | état des filtres + construction du prédicat SQL |
| `web/src/lib/state/permalien.ts` | sérialisation de l'état dans l'URL (`encoder` / `decoder`) |
| `web/src/lib/state/amorcage.svelte.ts` | phase et octets du démarrage, lus par l'écran d'attente |
| `web/src/lib/state/theme.svelte.ts` | thème sombre/clair, les deux feuilles de fond, et la palette résolue que lisent MapLibre et Plot |
| `web/src/lib/teinte.ts` | repeint le fond clair par **nature de couche**, jamais par identifiant |
| `web/src/lib/state/carte.svelte.ts` | ce que la carte a réellement peint — le seul témoin d'un repeint muet |
| `web/src/lib/format.ts` | `romain`, formats de nombres — étaient recopiés dans trois composants |
| `web/src/service-worker.ts` | cache des actifs hachés uniquement |
| `web/src/lib/components/` | `MonumentMap`, `FacetPanel`, `Jetons`, `Timeline`, `Matrice`, `DetailPanel` |
| `web/tests/smoke.mjs` | 124 vérifications en Chromium réel, avec `serveur.mjs` instrumenté |
| `web/tests/apercu-social.mjs` | régénère la vignette Open Graph depuis l'application |

## Commandes

```bash
cd etl  && python -m merimee_etl        # ~11 s, écrit web/static/data/
cd etl  && python -m merimee_etl.wikidata  # rafraîchit l'instantané des photos
cd etl  && python -m merimee_etl.commons   # complète par les fichiers citant la notice
cd etl  && python -m merimee_etl.memoire   # compte les illustrations POP, 1,36 Go lus en flux
cd etl  && python -m pytest tests -q    # 64 tests
cd web  && npm run dev                  # http://localhost:5173
cd web  && npm run check                # svelte-check, doit rester à 0/0
cd web  && npm run build && npm run test # build statique + 124 vérifications navigateur
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

**Les fonds historiques IGN sont posés, et `maxzoom` est le piège du dispositif.**
Géoplateforme, **sans clé d'API**, `access-control-allow-origin: *`, `cache-control`
21 jours. Remesuré à l'intégration : Cassini =
`BNF-IGNF_GEOGRAPHICALGRIDSYSTEMS.CASSINI` — le préfixe `BNF-IGNF_` est **obligatoire**,
l'identifiant nu renvoie 400 — PNG, **z ≤ 14, 172 Ko la tuile**, soit ~2 Mo par écran ;
État-major = `GEOGRAPHICALGRIDSYSTEMS.ETATMAJOR40`, JPEG, **z ≤ 15, 20 Ko**.

Trois points à ne pas défaire :

- **`maxzoom` sur la source n'est pas une précaution.** Sans lui, MapLibre réclame des
  tuiles au-delà de la résolution réelle et **la couche disparaît au moment précis où
  l'on zoome sur l'édifice**. Avec, il étire la dernière tuile disponible. Le smoke test
  cadre à z16 et vérifie que le niveau demandé plafonne à 14 ;
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

**Le smoke test n'appelle jamais la Géoplateforme.** Les tuiles sont interceptées par
`page.route` et la **forme des URL** est vérifiée, pas le contenu. Ce dépôt tient ses
tests hors réseau — l'ETL est conçu ainsi délibérément — et une suite qui dépend de la
disponibilité d'un service tiers devient intermittente.

**En revanche, il appelle bien CARTO.** Il le faisait déjà en silence — `page.route` n'a
jamais couvert `basemaps.cartocdn.com` — mais seules des formes d'URL étaient vérifiées,
si bien que la suite passait avec un fond absent. `le fond clair est reteinte` lit
désormais le **résultat** : la suite échoue si la feuille ne charge pas. C'est un choix
assumé — sans CARTO le site est inutilisable, et boucher la feuille par une maquette
locale rendrait le décompte constant par construction, donc muet sur la seule chose qui
puisse casser.

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

**Chromium sans tête annonce `prefers-color-scheme: light`.** Les deux scripts
Playwright forcent donc `colorScheme` : `smoke.mjs` démarre en sombre pour avoir
quelque chose à basculer, `apercu-social.mjs` aussi pour que la vignette soit la même
d'une machine à l'autre.

**La chaîne des points va des vecteurs Arrow au GeoJSON, sans objets intermédiaires.**
Mesuré d'abord (`mesures.svelte.ts`, relevé imprimé par le smoke test), sur 44 484 points :
**SQL 13 ms · Arrow→JS 52 ms · GeoJSON 75 ms · `setData` 15 ms, total 156 ms**. Deux
enseignements : la saturation qu'on redoute d'ordinaire n'existe pas ici — MapLibre dessine
en WebGL, pas dans le DOM, et le rendu ne pesait que 10 % — mais **81 % du temps partait en
fabrication d'objets JavaScript**, deux jeux de 44 484, un par `row.toJSON()`, un par la
`FeatureCollection`. `points()` lit désormais les colonnes et ne construit plus qu'un jeu :
**SQL 12 ms · GeoJSON 27 ms · `setData` 16 ms, total 55 ms**, sans dépendance nouvelle.
Quatre points à ne pas défaire :

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

**`mesures.sql` est un temps de bout en bout, pas un temps moteur.** Les huit requêtes d'un
cycle partagent **une seule connexion** DuckDB et s'y sérialisent : la requête des points
attend derrière les balayages du cycle précédent. Mesuré : le même filtre « Corse » coûte
**91 ms** de `sql` quand il succède au corpus entier, **14 ms** quand il succède à un autre
filtre serré. Conséquence pour le smoke test — le total d'un petit résultat peut dépasser
celui du gros, et la comparaison des deux régimes porte donc sur `collection`, seul poste
qui suive le volume.

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

## Règles de conception

**Colonnes `LIST` plutôt que tables de liaison.** Domaines, siècles, dénominations,
auteurs, propriétaires sont des listes dans `monuments`. Filtrage par
`list_has_any`, facettage par `UNNEST`. Seuls les actes de protection ont leur table.

**Une facette annonce ce qu'elle cache.** `cardinalites()` compte les valeurs
distinctes de chaque facette **sous les filtres courants et sans le sien**, comme
`facette()` — sinon cocher une valeur ferait tomber le nombre à 1. Les huit comptes
partent en une seule requête (`UNION ALL`), donc un seul aller-retour. C'est ce qui
transforme « 40 valeurs » en « 40 sur 714 » : la liste n'avait plus l'air complète.

**Une facette ne montre que ses 40 valeurs les plus fréquentes ; sa recherche,
elle, fouille tout.** Filtrer en JavaScript la liste déjà rapatriée laissait
7 000 des 7 040 auteurs inatteignables. `facette(f, cle, limite, terme)` descend
le `LIKE` dans DuckDB via `strip_accents(lower(...))`, et **épingle les valeurs
cochées** : sans cela, saisir un terme rendrait impossible de les décocher.

**La recherche a deux cibles, et un bouton dit laquelle.** `search_key` — titre,
commune, département — répond instantanément par un `LIKE` sur une colonne
pré-normalisée. Les **historiques** demandent un index de 3,8 Mo, chargé au premier
usage du mode et jamais au démarrage. Les deux s'excluent : les réunir coûterait une
union de deux prédicats de coûts incomparables, pour un gain nul — il n'existe pas de
titre qui contienne « jubé ». Le bouton **annonce le poids** qu'il engage, comme ceux
des fonds historiques annoncent celui de leurs tuiles.

**L'index plein texte est précalculé par l'ETL, jamais par le navigateur.** Mesuré
avant d'écrire quoi que ce soit : l'extension `fts` existe bien pour la cible wasm
(`extensions.duckdb.org/v1.4.x/wasm_eh/fts.duckdb_extension.wasm`, 200, 480 Ko), mais
`create_fts_index` côté client suppose d'avoir **tout le texte**, donc de rapatrier les
**32 fragments `details`, 12 Mo**, et coûte **2,2 s en natif multi-thread** quand le
bundle retenu est `eh`, **mono-thread** par contrainte d'hébergement. La charger à
l'exécution ferait en plus dépendre le site d'un CDN tiers, ce que `duckdb.ts` évite
délibérément. Ne pas rouvrir.

`etl/merimee_etl/texte.py` écrit donc trois Parquet dans `web/static/data/texte/` —
postings 3,3 Mo, lexique 0,3 Mo, longueurs 0,2 Mo — et le navigateur ne fait que
scorer. Quatre points à ne pas défaire :

- **le lexique remplace un stemmer côté client.** L'index porte des radicaux Snowball
  (`jub`, `machicoul`) ; `lexique.parquet` y rattache les 45 826 formes rencontrées dans
  le corpus, si bien que `mascaron` et `mascarons` désignent le même terme sans une
  ligne de linguistique dans le bundle ;
- **aucun seuil de fréquence** sur l'index. Couper les mots courants ferait gagner
  0,6 Mo et casserait les requêtes à plusieurs mots : la sémantique est **ET**, donc
  « église romane » échouerait sur son premier mot ;
- **les postings sont triés par terme**, en groupes de 100 000 lignes. C'est ce tri qui
  permet aux statistiques Parquet d'écarter le reste : sans lui, chaque recherche
  balaierait 1,6 M de lignes ;
- **`null` et `[]` ne disent pas la même chose** dans `termesResolus`
  (`filters.svelte.ts`) : `null`, c'est « pas encore résolu », et le filtre s'efface le
  temps d'un aller-retour ; `[]`, c'est « résolu, aucun mot connu », et la réponse est
  alors zéro notice. Confondre les deux ferait clignoter le corpus entier à chaque
  frappe, ou rendrait un mot introuvable indiscernable d'un filtre trop serré.

**Le plein texte a un plafond structurel : 24 819 notices sur 46 760 portent un
historique.** La vue liste le dit quand le mode est actif, et nomme les mots que le
lexique ne connaît pas. Sans ces deux phrases, un résultat vide ressemble à un bug.

**Les facettes s'évaluent sans leur propre filtre.** `buildWhere(filtres, except)` —
retirer ce mécanisme fait tomber à zéro toutes les options non cochées et tue le
filtrage croisé. `queries.facette()` passe systématiquement la clé en `except`.

**La barre porte trois blocs, et le groupe médian est centré par ses flancs.**
`marque` et `chiffres` portent `flex: 1 1 0` : ils se partagent à parts égales ce que
le groupe médian laisse, donc celui-ci tombe au milieu sans qu'aucune largeur ne soit
écrite. Quatre points à ne pas défaire :

- **`.centre-barre` déclare une base (`flex: 0 1 700px`), pas `auto`.** La contribution
  max-content d'un conteneur flex imbriqué ne reprend pas la base de ses enfants : avec
  `auto`, le champ retombait à 197 px, une vingtaine de caractères entre ses deux
  boutons. Mesuré, pas déduit ;
- **la marque tient sur deux lignes** — le titre, puis sa signature. Sous 1320 px les
  dates cèdent avant le sous-titre : la part de chaque flanc passe alors sous la largeur
  de la signature complète, et les dates se relisent dans la frise ;
- **un seul compteur.** Le total suit les filtres et répond à « combien en reste-t-il ».
  Classés, inscrits et objets se lisent dans la facette « statut », qui les donne déjà
  croisés — les répéter dans la barre était une triple lecture du même état ;
- **le thème est une pastille sans libellé** (soleil / lune), et son nom accessible
  reste `Clair` / `Sombre` : l'icône dit la destination, l'`aria-label` la nomme. Le
  trait des deux SVG est `currentColor`, sinon la règle « toute couleur vit dans
  `app.css` » tomberait avec eux.

**Le bouton « Filtres » vit au coin de la carte, pas dans la barre.** Il se pose là où
le tiroir s'ouvre et **s'efface tant qu'il est ouvert** : la croix de l'en-tête du
tiroir est alors le seul geste de fermeture, et le bouton revient avec elle. Deux
conséquences :

- **z-index 4**, au-dessus de la liste et de la matrice (3), qui recouvrent la scène et
  pour lesquelles les filtres comptent autant, mais sous le voile (5) et le tiroir (6) ;
- **son empreinte est une variable héritée**, `--reserve-filtres`, posée par la scène et
  lue par le titre de la liste et par celui de la matrice. Même procédé que
  `--marge-gauche` pour les commandes MapLibre : ni la liste ni la matrice n'ont à
  connaître l'existence de ce bouton. Elle tombe à zéro quand le tiroir est ouvert, et
  sur gabarit étroit, où le bouton passe **au-dessus** du titre et non à côté ;
- **c'est une surface posée, pas un aplat plein.** Le fond de carte suit désormais le
  thème, mais cela ne change rien ici : le bouton appartient à l'interface et suit le
  thème comme la légende, calcaire en clair, ardoise en sombre, détaché de la carte par
  son filet (`--bord-flottant`) et son ombre. En aplat inversé (`--plein-fond`), il
  était noir sur une carte noire en sombre, et il serait ardoise sur du grège en clair :
  dans les deux cas un trou, jamais une commande.

**Les commandes de la carte sont rangées par question.** La légende avait fini en tiroir
fourre-tout : clés de couleur, choix de sémiologie, densité, cartes anciennes, dosage
d'opacité et contrainte de zone dans une seule bande de pilules indifférenciées. Elles
sont désormais séparées par ce qu'elles font :

- **la légende, en bas à gauche**, dit d'abord ce qu'on voit — les clés de couleur, ou
  la rampe quand la densité est active — puis, sous un filet, propose de le changer :
  un rail à deux options (`statut` / `époque`) précédé de son libellé, et la bascule de
  densité. Le rail remplace un bouton unique dont le libellé alternait, et dont on ne
  savait pas s'il annonçait l'état courant ou sa destination ;
- **les cartes anciennes prolongent la colonne d'outils du zoom**, et s'y **replient**
  en une pastille de 31 px, au même bord droit et au même langage graphique que lui.
  C'est un calque posé sous les points, pas une clé de lecture, et on ne s'en sert pas
  en continu. Trois points à ne pas défaire : la pastille **dit qu'un fond est actif**
  (filet ocre), sinon une carte ancienne resterait à l'écran sans commande visible pour
  l'éteindre ; le module **se déplie de lui-même si `fond=` est dans l'URL**, lu une
  seule fois au montage (`untrack`) — le suivre rouvrirait le panneau sous le doigt de
  qui vient de le fermer ; le nom du fond porte sa période en seconde ligne, un `title`
  ne se lisant pas au tactile. Le style commun aux deux fonds passe par `.fonds >
  button` et non `.fonds button`, qui coiffait aussi la croix de l'en-tête ;
- **le zoom de MapLibre suit désormais le thème.** Il restait blanc dans les deux, ce
  qui était sa valeur par défaut ; une pastille blanche au-dessus d'une pastille ardoise
  ne tenait pas. Ses icônes sont des SVG noirs posés en **image de fond** — on ne peut
  pas leur donner un jeton, d'où l'inversion en thème sombre, seul levier disponible ;
- **« limiter à la zone visible » a rejoint le tiroir des filtres.** C'en est un : il
  restreint le corpus, comme une facette, et n'avait rien à faire parmi des commandes
  d'affichage. Conséquence sur l'état, cf. plus bas : `suivreVue` a quitté
  `MonumentMap` pour la page.

Les clés de lecture portent `.cle` et non un `span` nu : la légende contient d'autres
`span` depuis qu'elle nomme ses commandes, et le test qui vérifie qu'elle suit le mode
de coloration compte ces clés — trois par statut, cinq par époque.

**La frise est un panneau, pas un socle.** Trois décisions tenues ensemble :

- **elle suit le thème.** Le bandeau ardoise dans les deux thèmes a été abandonné : il
  posait une bande sombre sous une page claire, alors que seul le **fond de carte** a
  une raison de rester sombre — le liseré des points et la rampe de densité le
  supposent, une frise ne suppose rien. En clair, `--barre-sourde` (les siècles non
  retenus) doit rester un gris **chaud** et non un gris de texte : sur le calcaire, un
  gris neutre passe pour une barre désactivée ;
- **elle se replie à toutes les largeurs**, plus seulement sur téléphone. Même
  dispositif que le tiroir des facettes : la croix est dans le panneau, et le bandeau
  qui le rouvre prend sa place — il ne coûte sa hauteur que lorsque la frise est partie ;
- **les deux axes répondent aux mêmes gestes** : clic pour une valeur, glissement pour
  une plage, et recliquer la même valeur l'efface. Les deux bornes saisissables de l'axe
  des protections ont disparu avec le vide qu'elles occupaient. **Conséquence assumée :
  il n'y a plus de chemin clavier vers la plage d'années** — il n'y en avait déjà aucun
  vers les siècles, et la puce reste retirable au clavier. Le rendre aux deux axes est
  dans « reste à faire », pas dans un seul.

**Chaque frise mesure sa propre colonne.** Les deux graphiques partageaient la largeur
observée sur la première piste : celle des années, qui occupe 1,6 fois la colonne de
gauche, était donc **dessinée à la largeur de sa voisine** et laissait un tiers de sa
place vide à droite — l'espace où logeaient justement les bornes. Un `ResizeObserver`
observe désormais les deux boîtes, et `.piste` porte `min-width: 0` : sans lui un
élément de grille prend la largeur de son contenu, et un graphique dimensionné sur la
mesure entretiendrait sa propre croissance. Le test compare boîte et SVG, à 4 px près.

**`replaceChildren` efface tout, y compris ce que Svelte a rendu.** Le voile de
brossage vivait dans le même `<div>` que le graphique : chaque rafraîchissement des
données le supprimait avec l'ancre où Svelte le réinsère, si bien qu'un lien portant
`annees=` arrivait sans voile et qu'il ne revenait plus. La toile est désormais un
nœud à part (`.toile`), enfant du même conteneur positionné : Plot y règne, Svelte rend
le voile à côté.

**`echelleX` est réactif, `inverseX` non.** Le premier est lu par l'aperçu de brossage,
qui doit se redessiner dès que le graphique est reconstruit : en simple `let`, un lien
portant `annees=` arrivait **sans son voile**, l'échelle étant encore nulle au premier
calcul de `$derived`. Le second n'est lu que dans un gestionnaire d'événement, donc
toujours après. Invisible tant que les bornes affichaient la plage en chiffres.

**`USING SAMPLE 1 ROWS` passe sous le filtre.** `auHasard()` tirait une ligne de la
table entière puis lui appliquait le prédicat : `has_historique` ne couvrant que 24 819
notices sur 46 760, le bouton « Au hasard » restait muet une fois sur deux — mesuré,
trois clics sans effet sur cinq. `ORDER BY random() LIMIT 1` corrige, et le smoke test
le verrouille (`au hasard ouvre une fiche`). Le tri de 46 760 lignes ne coûte rien à
côté d'un bouton qui ne répond pas.

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
  posée à la main (`attributionControl: false` puis `addControl(...)`) : une mention de
  licence masquée n'est pas une mention. Elle a d'abord fui la droite, que la fiche
  recouvrait, pour le **bas à gauche** — où sa pastille « i » s'est mise à chevaucher la
  légende. Elle est donc **revenue en bas à droite**, cette fois derrière
  `--marge-droite`, la même variable qui écarte le zoom : la fiche ne la recouvre plus.
  Un test le verrouille par la **géométrie** — les boîtes de l'attribution et de la
  légende doivent être disjointes — et non par la lecture d'une règle CSS. Les marges
  sont posées par la page ; le composant carte n'a pas à connaître l'existence d'un
  panneau de facettes.

Pas de `backdrop-filter` sur ces calques : un flou plein écran au-dessus d'un canevas
WebGL se paie à chaque image.

**Deux filtres ont un état miroir hors de `filters`.** `retirer()` ne suffit donc pas,
et c'est la page qui complète : `recherche` a le champ de la barre, qui l'alimente par
un effet retardé et garderait son texte ; `bbox` a `suivreVue`, qui la reposerait au
prochain `moveend`. Même chose pour `reset()`. `suivreVue` **vit dans la page** depuis
que sa case est dans le tiroir des filtres : `MonumentMap` le reçoit en `$bindable` et
un seul effet y répond — lier pose la zone courante, délier la retire. C'est ce qui a
remplacé l'ancien `delierVue()` exporté, que la page devait penser à appeler.

**Le nom accessible d'une puce porte l'action, pas la valeur** (`aria-label="Retirer le
filtre architecture militaire"`). Sinon la puce et l'option de même libellé dans le
panneau de facettes deviennent deux boutons indiscernables, pour un lecteur d'écran
comme pour Playwright en mode strict. « Copier le lien » a suivi la règle inverse :
il n'existe plus qu'au singulier, dans la fiche, parce qu'un permalien sans notice
n'est qu'une copie de la barre d'adresse.

**Le thème n'est pas dans l'URL.** C'est une préférence de lecture, pas un état
d'exploration : elle vit dans `localStorage` et un lien partagé s'ouvre dans le thème
de celui qui le reçoit. Même règle que les tiroirs du gabarit téléphone. Un script
inline en tête d'`app.html` pose `data-theme` avant le premier paint — sans lui le
site est prérendu en sombre puis bascule à l'hydratation.

**Toute couleur vit dans `app.css`.** MapLibre et Plot ne savent pas lire une `var()` :
`theme.svelte.ts` relit les jetons par `getComputedStyle` à chaque bascule et les
expose dans `palette`. Une couleur écrite en dur dans un composant resterait muette
au changement de thème — il n'en reste aucune, et **le smoke test relit les sources
pour le vérifier** (`aucune couleur en dur hors app.css`). Seule exception, assumée et
commentée : la palette de repli de `theme.svelte.ts`, que le rendu préalable exige
puisqu'il n'a pas de document à interroger.

Deux conséquences moins évidentes du même principe :

- **la loupe des champs de recherche est un jeton**, `--icone-recherche`. Un `<input>`
  n'accepte pas de pseudo-élément : l'image de fond est le seul chemin, et le trait du
  SVG est une couleur — laissée dans le composant, elle serait restée gris sombre sur
  fond sombre ;
- **l'aplat plein s'inverse avec le thème** (`--plein-fond` / `--plein-texte`). En clair
  c'est l'ardoise sur calcaire ; en sombre l'ardoise **est** le fond, et un aplat ardoise
  sur fond sombre ne se voit plus. Il ne reste qu'un porteur, `.cible.actif` — le bouton
  qui annonce que la recherche vise les historiques. Le bouton « Filtres », qui l'a
  porté, s'en est détaché : posé sur la carte et non sur l'interface, il lui faut une
  surface, pas une inversion.

**Le fond de carte suit le thème, et le clair est repeint.** `FONDS`
(`theme.svelte.ts`) porte deux feuilles CARTO servies sans clé : dark-matter en sombre,
**Positron en clair**. Positron n'est pas pris tel quel — sa terre est presque blanche,
ses routes sont du blanc pur, ses bois sont verts — mais **repeint couche par couche**
par `teinter()` (`lib/teinte.ts`), appelée **en tête de `poserCouches()`, avant tout
`addLayer`** : posée après, elle repeindrait `monuments-points` en couleur de terre.
Palette : terres `#eceae4`, mers `#dce3e8`, frontières et côtes `#c8c4ba`, routes et
bâtiments `#f3f1eb`, libellés `#827e75`. Quatre points à ne pas défaire :

- **la classification va par nature, jamais par identifiant.** `background` → terre,
  `symbol` → libellé, `source-layer` contenant *water* → mer, *boundar* → trait,
  *transportation* → détail. Les identifiants de Positron (`landcover_wood`,
  `boundary_2`) sont une convention de CARTO ; le `source-layer` vient d'OpenMapTiles et
  le `type` de la spécification MapLibre — ces deux-là sont des contrats ;
- **elle se termine sur le `type`, sans branche « je laisse tel quel ».** C'est ce qui
  transforme un renommage chez CARTO en dégradation bénigne au lieu d'une panne muette :
  une couche non reconnue ressort en terre ou en trait, jamais en vert. Cinq des 93
  couches de Positron y tombent déjà (`landcover`, `landuse`, `park`), et c'est voulu —
  la terre est un aplat ;
- **il n'existe pas de couche « côte » dans OpenMapTiles.** Le trait de côte est le bord
  du polygone d'eau, donc `fill-outline-color` sur les couches d'eau. Ce n'est pas un
  raffinement : terre et mer ne sont séparées que par **1,08:1** de luminance, le
  littoral ne tient qu'à ce trait ;
- **le décompte par nature est publié sur `window.__carte`** et le smoke test l'imprime :
  `terre 6 · mer 3 · trait 4 · libellé 27 · détail 53 · ignorées 0` sur les 93 couches
  de Positron. Aucune vérification hors ligne ne peut prouver que la feuille **réelle**
  de CARTO est encore correctement teintée ; ce relevé, lu à chaque passe, est le seul
  dispositif qui signale le contraire.

**Le thème sombre ne bouge pas.** `teinter()` sort immédiatement : dark-matter est déjà
la carte que le projet veut, l'aplatir à l'identique serait deux cents appels pour rien.
Les jetons `--carte-mer`, `--carte-trait`, `--carte-detail` et `--carte-libelle` ne sont
donc **pas lus** en sombre ; seul `--carte-terre` l'est, par `.scene`, pour que l'attente
du chargement soit de la couleur de la carte qui va s'afficher — au montage comme à
chaque bascule. La dissymétrie est voulue, et un test la garde pour qu'on ne la
« corrige » pas en croyant à un oubli.

**Le liseré des points vaut le sol, dans les deux thèmes.** `#101215` en sombre,
`#eceae4` en clair : ce n'est pas une auréole, c'est une **découpe**, qui sépare deux
points qui se touchent sans ajouter d'encre. Le blanc cassé d'avant supposait une carte
noire. Le cerclage de sélection suit la symétrie inverse — le maximum de contraste
contre son sol, `#f2f0ea` en sombre et `#1a1d20` en clair — et surtout pas `--accent`,
qui vaut `--classe` et rendrait la sélection indiscernable d'un point classé.

**Sauf sous un fond historique : le liseré bascule au sombre.** Cassini et l'État-major
sont des aplats beiges clairs — un liseré couleur du sol y disparaît, que ce sol soit
ardoise ou grège. La règle a survécu au passage au clair, sa **raison** a changé :
`--carte-liseret-sur-clair` est substitué dès que la superposition atteint **50 %
d'opacité** (`liseret()`). En clair l'anneau est déjà faible dès 30 % ; on ne descend pas
le seuil pour autant, parce que ce serait une branche sur le thème dans le code alors
que tout le dispositif fait porter la différence par les jetons. La rampe de densité,
elle, n'est pas concernée : **densité et fond historique s'excluent mutuellement**,
l'une agrège, l'autre situe.

**La rampe de densité s'inverse avec le thème**, comme celle de la matrice : en sombre
elle monte vers le crème, en clair elle descend vers le brun, sur les valeurs de
`--matrice-1..4`, déjà éprouvées sur un fond clair. `--chaleur-0` reste **transparent**
dans les deux cas — `heatmap-density` vaut zéro sur toute la surface sans donnée, et un
zéro opaque laverait la vue entière. Elle est réinjectée par l'effet de palette et non
seulement par `poserCouches()` : elle doit suivre le thème par un chemin qui lui est
propre, sans dépendre du fait que la bascule repose les couches. Ce n'était pas le cas,
et cela ne se voyait pas tant que les deux rampes allaient dans le même sens.

**Le liseré des points ne s'ouvre qu'au zoom, l'opacité aussi.** Rayon
`4 → 1,2 · 7 → 1,5 · 10 → 4,5 · 14 → 8`, opacité `4 → 0,42 · 8 → 0,60 · 11 → 0,85`,
largeur de liseré `6 → 0 · 9 → 0,5 · 13 → 1,8`. La maquette donnait le liseré épais dès
le départ, ce qui vaut pour dix pastilles : sur 44 484 points à z4,7, les anneaux se
touchent et la France devient un aplat clair. Quatre points, tous vérifiés à la capture
et non au raisonnement :

- **`circle-stroke-opacity` vaut 1 par défaut et ne suit pas `circle-opacity`.** Un
  remplissage à 0,42 sous un liseré opaque donne des anneaux creux. Les deux portent
  donc la **même** expression ;
- **l'opacité basse ne vaut qu'à l'échelle nationale.** À z5-7 les 44 484 points se
  superposent et l'accumulation par alpha est la seule densité qu'une couche `circle`
  sache produire. Un point isolé n'y ressort qu'à **1,6:1** sur la terre grège ; à z8,
  0,60 le porte à 2,1:1. Un littéral serait plus court et faux ;
- **l'effet de densité doit reposer l'expression, pas un scalaire.** Il posait `0,82` :
  tel quel, la première bascule de densité écraserait l'interpolation par zoom et les
  points redeviendraient opaques à l'échelle nationale, définitivement ;
- **le halo (`nb > 50`) change d'opacité avec le thème**, 0,14 en sombre et 0,07 en
  clair. Ce n'est pas un réglage de goût : clair sur fond sombre, un aplat à faible
  alpha fait une **lueur** ; sombre sur fond clair, il fait une **salissure**. À 0,14 sur
  le grège, les taches lavande de 26 px autour des villes dominaient la carte. C'est une
  opacité et non une couleur, elle ne peut donc pas vivre dans `app.css` : c'est la seule
  branche sur le thème du composant.

**Le mode de fusion « produit » n'existe pas sur une couche `circle`**, et il n'y a rien
à espérer d'un `mix-blend-mode` CSS : il s'appliquerait au **canevas entier**, fond
compris, et ne ferait rien entre les points, qui sont composités à l'intérieur du canevas
avant que CSS n'entre en jeu. L'accumulation se fait donc par alpha, et elle **sature** :
1 − (1 − 0,42)^N vaut 0,42 · 0,66 · 0,80 · 0,89 · 0,93 · 0,96 — au-delà de six
recouvrements, Paris et un bourg à sept monuments rendent le même aplat. Un produit, lui,
assombrit sans borne. La couche qui fait ce travail existe déjà : `heatmap` accumule dans
une texture et passe le total dans une rampe choisie. **L'accumulation par alpha donne le
grain, la heatmap donne la quantité ; ne pas demander à l'une le travail de l'autre.**

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
requête lente ne doit jamais écraser une plus récente. Il **écarte le résultat, il ne
retire pas le travail** : le moteur a déjà payé la requête quand on jette sa réponse.
C'est pourquoi tout ce qui suit vise à ne pas l'émettre, jamais à l'annuler —
`cancelSent()` existe sur la connexion, mais avec un `Promise.all` en vol il coupe
aussi bien la requête périmée que celle qui vient de partir.

**Le cycle de requêtes est éclaté en quatre effets, et le découpage suit ce que l'œil
regarde.** Les quatorze requêtes partaient dans un seul `Promise.all`, dont un seul
`.then` affectait tout. Quatre conséquences, toutes corrigées ensemble :

- **le nuage de points a son propre aller-retour.** Il répond en 12 ms mais attendait le
  maillon le plus lent du lot, les requêtes partageant une connexion unique et s'y
  sérialisant. C'est le seul résultat que l'œil suit en continu ;
- **les facettes et leurs cardinalités sont conditionnées à `facettesOuvertes`**, les
  deux histogrammes à `friseOuverte`. Sous 900 px les deux panneaux sont fermés au
  premier écran : neuf requêtes sur quatorze partaient pour un DOM que personne ne
  regarde. L'effet **dépend** de l'état d'ouverture, donc ouvrir le panneau le rejoue —
  rien ne s'affiche périmé, et aucun rafraîchissement explicite n'est à écrire ;
- **`vue` ne déclenche plus que la matrice.** Il était lu dans le corps de l'effet
  principal, ce qui en faisait une dépendance de l'effet **entier** : basculer carte →
  liste relançait les quatorze requêtes sans qu'aucun filtre ait bougé. Au passage,
  l'ancien `Promise.resolve(croisement)` faisait de cet effet un lecteur de ce qu'il
  écrivait lui-même ;
- **six états sont passés en `$state.raw`** — `facettes`, `barresSiecles`,
  `barresAnnees`, `cardinaux`, `compteurs`, `resultats` — pour la raison déjà écrite au
  dessus de `pointsCarte` : réaffectés en bloc, jamais mutés en place.

Mesuré de la frappe jusqu'au compteur, six termes, médiane : **téléphone 276 → 218 ms,
bureau 284 → 215 ms**. Les 180 ms de débounce étant constantes des deux côtés, le
travail réel passe de **96 → 38 ms** et de **104 → 35 ms**.

**Le curseur Palissy était le seul filtre lié directement à `filters`.** Un
`<input type="range">` émet `input` à **chaque pas franchi** : un glissement de 0 à 500
par pas de 10 pouvait empiler cinquante cycles complets sur la connexion unique. Il
écrit donc dans un état local — affiché sans délai — qui ne descend dans `filters`
qu'après 180 ms, le même délai que la recherche et la recherche de facette. Le second
effet, qui recopie `filters` vers la poignée, existe pour `reset()` et le retrait de la
puce ; il lit `filters` sous `untrack`, sinon l'écriture différée rejouerait l'effet qui
l'a produite.

**Trois défauts mobiles n'ont rien à voir avec les requêtes.** Ils se tenaient et se
corrigent ensemble :

- **`height: 100dvh`, avec `100vh` en repli.** `vh` compte la bande que la barre
  d'adresse recouvre : à son repli pendant un défilement, la scène changeait de hauteur,
  ce qui redimensionnait le canevas WebGL **et** reconstruisait les graphiques Plot ;
- **`overscroll-behavior: contain`** sur les quatre conteneurs défilants — liste, tiroir
  de facettes, sa liste d'options imbriquée, fiche. Sans lui, tirer vers le bas en haut
  de l'un d'eux remonte au navigateur et déclenche le pull-to-refresh : **rechargement
  complet du wasm et perte de l'exploration en cours** ;
- **le `ResizeObserver` de la frise et celui de la matrice ne retiennent qu'une mesure
  par image.** Chaque mesure retenue reconstruit intégralement le graphique
  (`Plot.plot()` puis `replaceChildren`), pas seulement son échelle.

**La matrice retire un filtre par axe.** `buildWhere` accepte une liste de clés
à exclure ; `matrice()` en passe deux (`siecles`, `anneeProtection`), sinon
choisir une cellule réduirait la matrice à cette seule cellule. Les couples
(notice, siècle, décennie) sont dédoublonnés : une notice à deux actes dans la
même décennie compterait deux fois. Les siècles antérieurs au 10e sortent des
axes mais leur nombre est affiché sous le graphique.

**Les photographies viennent d'instantanés, pas d'une requête vivante.** La base
Mérimée ne porte **aucun lien vers une image** : ni colonne Mémoire, ni Wikidata, ni
fichier. Le premier pont est Wikidata (`P380` identifiant Mérimée → `P18` image), et il
couvre **39 556 notices sur 46 760, soit 84,6 %**. Le second est Commons, par les
fichiers dont la page **cite la référence** : **512 notices de plus, 85,7 % au total**.
`python -m merimee_etl.wikidata` et `python -m merimee_etl.commons` écrivent deux
fichiers **séparés** dans `data/ref/` —
deux bases tierces de fiabilité différente, dont l'une doit pouvoir être régénérée ou
jetée sans toucher l'autre ; `python -m merimee_etl` **ne les appelle jamais**, il se
contente de la colonne `commons` des fragments — vide si les instantanés sont absents.
C'est ce qui garde le pipeline hors-ligne et les tests sans réseau. Trois conséquences :

- le fichier est versionné dans `data/ref/` mais **ce n'est pas une décision
  éditoriale** : c'est une base tierce datée, qui vieillit ;
- le crédit auteur / licence est lu à la volée sur l'API Commons parce que Wikidata ne
  le porte pas. La plupart de ces images sont sous CC-BY-SA : **le crédit est une
  obligation**. Il n'est jamais bloquant, et son échec laisse le lien vers la page du
  fichier, qui porte l'information complète ;
- une notice sur sept n'a pas d'image, et la fiche **s'ouvre alors sur son titre**. La
  plaque nommée qui tenait cette place — dénomination, domaine, « aucune photographie
  sur Wikimedia Commons » — occupait un tiers du panneau pour répéter ce que la fiche
  donne deux lignes plus bas. Ne reste que la bande des deux pastilles, qui se posaient
  sur l'image, et un filet sans lequel elles disparaîtraient sur le fond du panneau. La
  règle antérieure (« la section disparaît ») est donc **rétablie**, et l'absence se dit
  autrement : par le renvoi POP, cf. plus bas. Le cadre gris muet, lui, reste interdit.

Le magasin de certificats par défaut de Python sous Windows a rendu un
`CERTIFICATE_VERIFY_FAILED: certificate has expired` sur ce point d'entrée ; le module
passe par `certifi` quand il est installé.

**Le cadre épouse la photographie, entre deux bornes.** Le rapport 4/3 fixe recadrait
tout : une tour en portrait perdait sa flèche, un phototype en bandeau ses deux bords —
au moment précis où l'image sert à identifier l'édifice. Le cadre suit donc le rapport
réel du fichier, borné à **0,68 et 1,9**. Sans borne, un bandeau se réduirait à un trait
et un tirage vertical repousserait le titre hors de l'écran ; entre les bornes,
`object-fit: contain` sur un cadre au même rapport ne coupe rien ; au-delà, l'image
passe en `cover` et **se fait glisser**. Trois points à ne pas défaire :

- **`object-position` s'exprime en pourcents de la part cachée**, pas de la largeur : le
  pixel se convertit par cette part, recalculée depuis le rapport réel et la boîte
  affichée. Une fraction fixe dériverait avec la largeur de la fiche, qui change d'un
  gabarit à l'autre ;
- **les gestes sont portés par l'image, pas par le cadre.** Un `<div>` qui écoute le
  pointeur réclame un rôle ARIA, et aucun ne décrit honnêtement un cadre de
  photographie ; l'image remplit exactement ce cadre, la boîte mesurée est la même ;
- **`touch-action: none` n'est posé que sur une image hors bornes.** Partout ailleurs le
  doigt doit continuer à faire défiler la fiche.

Les bornes ne sont pas théoriques : sur **240 fichiers de l'instantané mesurés**,
**25 en sortent** — 10 %, du dolmen photographié en bandeau (2,5) au clocher cadré à
0,53. Le test mesure la boîte du cadre contre le rapport naturel du fichier, à 3 % près,
vérifie que le mode de remplissage suit la règle de bornes, et **glisse réellement** sur
un fichier hors bornes pour voir `object-position` bouger.

**Le pont Wikidata n'est pas étroit : les photographies manquantes n'existent pas.**
**46 618 items portent déjà un `P380`** sur 46 760 notices — les 7 204 fiches sans image
n'ont pas d'item manquant, elles n'ont pas de `P18`. Trois routes ont été mesurées sur
échantillon avant d'en retenir une seule :

| route | rendement | ce que ça vaut |
|---|---|---|
| image de tête d'article frwiki | 172/300 « images », **13 vraies photos** | cartes de localisation, blasons, `MH_disparu.svg` |
| `insource:"PA…"` sur Commons | 11/100 en échantillon, **512/7 190 = 7,1 %** en passe complète | le fichier **cite la notice** |
| geosearch 150 m | 44/100 | **sujet non vérifié** |
| items sans P18 mais avec `P373` | 224 | négligeable |

La passe complète coûte **1 h 40** : l'API de recherche répond en ~700 ms, et il y a
7 190 notices à interroger. D'où l'écriture incrémentale et la reprise — les références
déjà trouvées sont sautées, celles cherchées sans succès sont revues au passage suivant,
Commons s'enrichissant.

Le geosearch rend `BENOIT HAMON.jpg` pour la préfecture de Nanterre et
`Église (Salins-les-Bains).jpg` pour une « Demeure ». Corroborer par le titre ne filtre
presque rien (25 → 22) : le nom de commune figure dans la plupart des noms de fichiers,
il atteste **le lieu, pas le sujet**. Or une fiche affirme quelque chose en montrant une
photographie, et ne rien montrer vaut mieux qu'une image fausse. **Le geosearch est
écarté**, comme PMTiles : décision close, chiffres à l'appui.

`commons.py` filtre en plus par la forme du nom (`.jpg/.png/.tif`, rejet de
`location_map`, `blason`, `logo`, `MH_disparu`…) — le piège mesuré sur les images de
tête frwiki, où 172 « images » cachaient 13 photographies.

**Le troisième pont ne rapporte que des nombres.** Les 6 692 notices sans fichier
Commons ne sont pas dépourvues de photographie : la base **Mémoire** — les campagnes du
ministère de la Culture, celles qui illustrent POP — en couvre **4 861, soit 72,6 %,
avec 45 122 clichés**. La couverture de la fiche, photographie ou renvoi, passe donc de
**85,7 % à 96,1 %** ; il reste 1 831 notices sans rien. Sur le corpus entier, Mémoire
illustre 39 377 notices et 779 673 images.

**Et pourtant rien n'est repris.** Ces images ne sont pas libres : sur les 779 673 lignes
illustrées, **90 403 portent une mention** et elle est restrictive — « reproduction
soumise à autorisation du titulaire des droits d'exploitation » 77 495 fois,
« reproduction interdite » 85, « diffusion normale » 89. L'export tait les 88 % restants,
mais POP les affiche : sur 47 notices illustrées relevées à la main, **546 crédits,
aucun libre** — « tous droits réservés », « diffusion GrandPalaisRmn Photo ». Les
afficher serait une reproduction non autorisée sur un site tiers, quel que soit le
crédit affiché — c'est la différence avec Commons, dont les CC-BY-SA n'exigent que
l'attribution. `memoire.py` ne récolte donc qu'un **compte par notice**, et la fiche
n'en fait qu'un renvoi vers POP, qui les montre chez lui. Décision prise sur ces
chiffres ; la rouvrir demanderait des mentions libres en nombre, que la passe imprime à
chaque fois. Trois points de mise en œuvre :

- **la source est lue en flux, jamais écrite.** Le jeu « Mémoire – illustration Mérimée
  et Palissy » (data.gouv.fr, ODbL) pèse **1,36 Go** ; à 30 Mo/s mesurés la passe coûte
  moins d'une minute, contre 6 692 pages POP à interroger une à une. Le disque n'en
  garde que `data/ref/memoire_illustrations.csv`, 554 Ko ;
- **une ligne Mémoire peut citer plusieurs notices** (`PA00099871;IA19000868`), et le
  fichier couvre aussi Palissy : le compte se fait par notice **du corpus**, une seule
  fois par ligne, et les lignes sans `Lien_vers_l_image` ne comptent pas ;
- **l'export tait les droits, POP non.** `Copyright` est vide partout où
  `Droits_de_diffusion` l'est — les deux colonnes ont été comptées tour à tour et
  rendent le même décompte. La mention complète se lit sur la notice POP, jamais dans le
  CSV ; l'absence de mention dans l'export **ne veut pas dire image libre**, et les deux
  colonnes sont comptées pour ne pas dépendre de celle que le ministère remplira demain.

**Les rejets sont signalés, pas supprimés.** Un segment de date illisible produit
quand même un événement (année nulle) et une ligne dans `etl/out/rejets.csv`.

**Le libellé d'une section de facette vit dans `.nom-section`.** Un nœud de plus, pour
une raison de mise en page : `.titre` est un flex à quatre enfants, et deux
`margin-left: auto` concurrents (badge de sélection, cardinalité) se partageraient
l'espace au lieu de tout pousser à droite. Conséquence à connaître : le `:text()` de
Playwright vise le **plus petit** élément contenant le texte, donc les sélecteurs du
smoke test ciblent `.nom-section`, plus `button.titre`.

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

- **Observable Plot en chargement différé.** Mesuré sur le build : le nœud de page est
  un chunk **unique de 1,33 Mo / 378 Ko gzip** qui porte MapLibre, Plot et Arrow
  ensemble, et **aucun `import()` dynamique n'existe dans `web/src`**. Tout part avant
  que `boot()` puisse commencer. Plot pèse 209 Ko minifié (~65 Ko gzip) et n'est utile
  qu'à la frise et à la matrice — or la frise est **fermée par défaut sous 900 px**.
  Le sortir du chemin critique demande de charger `Timeline` et `Matrice` derrière un
  `import()`, avec le clignotement que cela suppose à la première ouverture. Ne pas s'y
  mettre sans mesurer l'amorçage avant/après : le poste dominant reste le wasm.
- **Le wasm n'est découvrable qu'après exécution du JS.** `duckdb.ts` l'importe en
  `?url` : le scanner de préchargement du navigateur ne voit jamais les 7,5 Mo gzip, qui
  font donc la queue derrière le téléchargement **et le parse** du chunk ci-dessus, au
  lieu de se recouvrir avec lui. Un `<link rel="preload" as="fetch" crossorigin>` le
  corrigerait, mais le nom est haché : cela demande un script d'après-build.
- **Colonnes mortes dans les Parquet.** Jamais lues par le navigateur (vérifié par
  grep) : `cog` (106 Ko), `annee_premiere_protection` et `annee_derniere_protection`
  (71 Ko), `siecle_min` (25 Ko), `techniques_decor` (21 Ko), `zones_protection`,
  `nb_protections`, `departement`, `typologie_dossier` — **239 Ko, soit 10 % de
  `monuments.parquet`**, plus `statut` et `partiel` dans `protections.parquet` (9 Ko) et
  `cadre_etude` dans les fragments. Le fichier étant la seule granularité de
  chargement, ces octets sont payés à chaque premier écran. Les retirer se fait dans
  `MONUMENTS_SCHEMA` / `PROTECTIONS_SCHEMA`, pas dans le `SELECT` du navigateur — et
  demande de vérifier qu'aucune assertion de `test_pipeline.py` ne les vise.
- **Le prédicat plein texte est réinjecté dans chaque requête du cycle.**
  `clauseTexte()` est inliné tel quel par `buildWhere()` : le scan `postings` + jointure
  `docs` + `GROUP BY/HAVING` est refait par chaque requête, en mono-thread, sur une
  connexion unique. Le résoudre une fois par cycle dans une table temporaire plafonnée à
  24 819 lignes devrait le rendre négligeable. **À instrumenter avant de corriger** :
  `mesures.svelte.ts` ne couvre aujourd'hui que la chaîne des points.
- **Cibles tactiles sous 44 px** sur les commandes les plus manipulées au doigt :
  pastilles de la fiche et bascule de thème à 34 px, croix du tiroir à 30 px, croix de
  la frise à 26 px. C'est un arbitrage avec la densité voulue du produit, pas un
  oubli — d'où le renvoi ici plutôt qu'une correction silencieuse.
- **Les `:hover` s'appliquent au tactile et y restent collés** jusqu'au tap suivant, sur
  les pilules de facette et les puces de filtres notamment. Les envelopper dans
  `@media (hover: hover) and (pointer: fine)` les rendrait au pointeur seul.
- Export CSV de la sélection courante, et liste paginée au-delà des 200 lignes.
- Filtres « figures » préréglés (Vauban, Guimard, Le Corbusier) en un clic, au-dessus
  de la facette auteurs existante. Devenus de simples liens depuis les permaliens.
- Exploitation NLP des 23,6 Mo de texte libre. **L'indexation lexicale est faite**
  (`texte.py`, BM25) sur les 15,1 Mo d'`historique` ; ce qui reste est l'extraction
  d'entités, et `precision_protection` — 6,7 Mo de langue d'arrêtés — n'est pas indexé.
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
- **Une feuille de style qui ne charge pas laisse la carte muette.** `style.load` n'est
  alors jamais emis, `pret` reste faux et les points ne reviennent pas — sans message.
  Cela valait deja pour le montage ; depuis que `setStyle` suit le theme, cela vaut
  aussi pour une bascule. Ce qu'il faut : un `map.on('error')` qui, sur une erreur de
  style, remette `fondPose` a sa valeur precedente pour qu'une seconde tentative soit
  possible, et un mot a l'ecran.
- **Chemin clavier sur les deux frises.** Aucun des deux axes n'en a : ils sont des
  `role="application"` pilotés au pointeur. Les bornes saisissables de l'axe des
  protections en tenaient lieu pour lui seul ; les retirer a aligné les deux axes sur
  la même lacune plutôt que d'en corriger une. Ce qu'il faut : un `tabindex`, une
  valeur focalisable par axe, les flèches pour déplacer, `Maj`+flèches pour étendre.
- Auteur cliquable dans la fiche, ouvrant ses autres réalisations — `filters.auteurs`
  existe déjà, c'est une poignée de lignes.
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
