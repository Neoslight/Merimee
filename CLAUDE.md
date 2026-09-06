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
| `etl/merimee_etl/texte.py` | index plein texte des historiques, **dégrade en silence** sans `fts` |
| `etl/merimee_etl/commons.py` | second instantané photo, séparé de `wikidata.py` — lancé à part |
| `etl/tests/test_pipeline.py` | 60 tests : unitaires sur les cas tordus + intégration sur les artefacts |
| `etl/out/rejets.csv` | segments hors-format rencontrés, jamais supprimés silencieusement |
| `web/src/lib/db/` | `duckdb.ts` (bootstrap, fragments), `queries.ts` (requêtes), `shards.ts` (hachage), `texte.ts` (BM25) |
| `web/src/lib/state/filters.svelte.ts` | état des filtres + construction du prédicat SQL |
| `web/src/lib/state/permalien.ts` | sérialisation de l'état dans l'URL (`encoder` / `decoder`) |
| `web/src/lib/state/amorcage.svelte.ts` | phase et octets du démarrage, lus par l'écran d'attente |
| `web/src/lib/state/theme.svelte.ts` | thème sombre/clair, et la palette résolue que lisent MapLibre et Plot |
| `web/src/lib/format.ts` | `romain`, formats de nombres — étaient recopiés dans trois composants |
| `web/src/service-worker.ts` | cache des actifs hachés uniquement |
| `web/src/lib/components/` | `MonumentMap`, `FacetPanel`, `Jetons`, `Timeline`, `Matrice`, `DetailPanel` |
| `web/tests/smoke.mjs` | 114 vérifications en Chromium réel, avec `serveur.mjs` instrumenté |
| `web/tests/apercu-social.mjs` | régénère la vignette Open Graph depuis l'application |

## Commandes

```bash
cd etl  && python -m merimee_etl        # ~11 s, écrit web/static/data/
cd etl  && python -m merimee_etl.wikidata  # rafraîchit l'instantané des photos
cd etl  && python -m merimee_etl.commons   # complète par les fichiers citant la notice
cd etl  && python -m pytest tests -q    # 60 tests
cd web  && npm run dev                  # http://localhost:5173
cd web  && npm run check                # svelte-check, doit rester à 0/0
cd web  && npm run build && npm run test # build statique + 114 vérifications navigateur
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

**`map.setStyle()` détruit toutes les sources et couches ajoutées.** D'où
`poserCouches()` dans `MonumentMap.svelte`, branchée sur `style.load` — le seul
événement qui couvre le montage **et** chaque changement de style — et non sur `load`,
qui ne se déclenche qu'une fois. Le fond ne suivant plus le thème, `setStyle` n'est
plus appelé aujourd'hui ; la fonction reste, et le test `les couches survivent au
changement de fond` vérifie désormais que la bascule de thème repeint les couches sans
écrire dans le vide — un `setPaintProperty` sur une couche disparue lève, donc c'est le
compteur d'erreurs console qui fait foi.

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
- **c'est une surface posée, pas un aplat plein.** Le fond de carte reste sombre dans
  les deux thèmes, mais le bouton appartient à l'interface et suit le thème comme la
  légende : calcaire en clair, ardoise en sombre, détaché de la carte par son filet
  (`--bord-appuye`) et son ombre. En aplat inversé (`--plein-fond`), il était noir sur
  une carte noire dès que le thème passait au sombre.

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

**Le thème ne pilote que l'interface : le fond de carte reste sombre dans les deux
cas** — la carte seule, la frise ayant rejoint l'interface (cf. plus haut).
`FOND` est une constante unique. Les points portent un liseré clair
(`--carte-liseret` vaut `#fdfcfa` en thème clair) et la rampe de densité monte vers le
blanc : les deux supposent une carte sombre. L'identité pose des panneaux calcaire sur
une carte ardoise, pas l'inverse. `setStyle` n'est donc plus appelé — mais
`poserCouches()` **reste** branchée sur `style.load`, qui couvre le montage et
désamorçait le piège si un fond historique s'ajoutait un jour. Ce jour est venu :
les fonds historiques s'y posent, cf. plus bas.

**Sauf sous un fond historique : le liseré des points bascule au sombre.** Cassini
et l'État-major sont des aplats beiges clairs — le liseré `#fdfcfa` y disparaît, au
moment précis où l'on cherche à situer les points sur la carte ancienne. D'où
`--carte-liseret-sur-clair`, substitué dès que la superposition atteint **50 %
d'opacité** (`liseret()` dans `MonumentMap.svelte`). C'est la seule entorse à la règle
ci-dessus, et elle ne concerne que la carte, jamais l'interface. La rampe de densité,
elle, n'est pas corrigée : **densité et fond historique s'excluent mutuellement**,
parce qu'ils répondent à deux questions incompatibles — l'une agrège, l'autre situe.

**Le liseré des points ne s'ouvre qu'au zoom** (`6 → 0`, `9 → 0,5`, `13 → 1,8`). La
maquette le donnait épais dès le départ, ce qui vaut pour dix pastilles : sur 44 484
points à z4,7, les anneaux se touchent et la France devient un aplat clair. Vérifié à
la capture, pas au raisonnement.

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
- une notice sur six n'a pas d'image : la section montre alors une **plaque nommée** —
  dénomination, domaine, et la mention « aucune photographie sur Wikimedia Commons » —
  au même rapport 4/3 que la photo qu'elle remplace. Ce qu'elle ne fait pas, c'est
  ressembler à un chargement : ni animation, ni icône brisée, ni dégradé. La règle
  antérieure (« la section disparaît ») a été **inversée volontairement** ; le cadre
  gris muet qu'elle interdisait, lui, reste interdit.

Le magasin de certificats par défaut de Python sous Windows a rendu un
`CERTIFICATE_VERIFY_FAILED: certificate has expired` sur ce point d'entrée ; le module
passe par `certifi` quand il est installé.

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
photographie, et la plaque nommée vaut mieux qu'une image fausse. **Le geosearch est
écarté**, comme PMTiles : décision close, chiffres à l'appui.

`commons.py` filtre en plus par la forme du nom (`.jpg/.png/.tif`, rejet de
`location_map`, `blason`, `logo`, `MH_disparu`…) — le piège mesuré sur les images de
tête frwiki, où 172 « images » cachaient 13 photographies.

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
