# Règles de conception — données et requêtes

Déplacé de `CLAUDE.md`. Couvre le modèle de données (`monuments`, `protections`,
`details`), la construction des prédicats SQL (`filters.svelte.ts`), le plein
texte (`texte.ts`) et l'état d'exploration dans l'URL (`permalien.ts`). Lire
cette page avant de toucher à `web/src/lib/db/`, `web/src/lib/state/filters.svelte.ts`
ou `web/src/lib/state/permalien.ts`.

**Colonnes `LIST` plutôt que tables de liaison.** Domaines, siècles, dénominations,
auteurs, propriétaires sont des listes dans `monuments`. Filtrage par
`list_has_any`, facettage par `UNNEST`. Seuls les actes de protection ont leur
table — **4 215 notices** en portent plusieurs, une granularité que la colonne
`LIST` ne représenterait pas correctement (pas de date propre par valeur).

**Les colonnes jamais lues côté navigateur ont été retirées des schémas Parquet**
(`MONUMENTS_SCHEMA`/`PROTECTIONS_SCHEMA`, `build.py`) : `cog` (106 Ko),
`annee_premiere_protection` et `annee_derniere_protection` (71 Ko), `siecle_min`
(25 Ko), `techniques_decor` (21 Ko), `zones_protection`, `nb_protections`,
`departement`, `typologie_dossier` sur `monuments` (**−239 Ko au total, soit 10 % de
`monuments.parquet`**), plus `statut`/`partiel` sur `protections` (9 Ko — la
fiche les lit déjà sur `monuments`, cf. `queries.ts::detail`) et `cadre_etude` dans les
fragments `details`. Vérifié par grep avant retrait, `SELECT *` compris : le fichier
étant la seule granularité de chargement (`docs/contraintes.md`), ces octets étaient
payés à chaque premier écran pour rien. `departement_nom` reste : c'est lui que la
facette affiche, pas le code numérique.

**Une facette annonce ce qu'elle cache.** `cardinalites()` compte les valeurs
distinctes de chaque facette **sous les filtres courants et sans le sien**, comme
`facette()` — sinon cocher une valeur ferait tomber le nombre à 1. Les huit comptes
partent en une seule requête (`UNION ALL`), donc un seul aller-retour. C'est ce qui
transforme « 40 valeurs » en « 40 sur 714 » : la liste n'avait plus l'air complète.

**Une facette ne montre que ses 40 valeurs les plus fréquentes ; sa recherche,
elle, fouille tout.** Filtrer en JavaScript la liste déjà rapatriée laissait
7 000 des 7 040 auteurs inatteignables, dont Baltard et Le Corbusier — et
**5 607 d'entre eux n'ont qu'une seule notice**, précisément la longue traîne
qu'on vient chercher par ce champ. `facette(f, cle, limite, terme)` descend
le `LIKE` dans DuckDB via `strip_accents(lower(...))`, et **épingle les valeurs
cochées** : sans cela, saisir un terme rendrait impossible de les décocher.

**La recherche a deux cibles, et un bouton dit laquelle.** `search_key` — titre,
commune, département — répond instantanément par un `LIKE` sur une colonne
pré-normalisée. Les **historiques** demandent un index de 3,8 Mo, chargé au premier
usage du mode et jamais au démarrage. Les deux s'excluent : les réunir coûterait une
union de deux prédicats de coûts incomparables, pour un gain nul — il n'existe pas de
titre qui contienne « jubé » (34 notices dans les historiques), ni « machicoulis »
(550) ni « mascaron » (118) : ces trois termes n'existent que dans le texte libre.
Le bouton **annonce le poids** qu'il engage, comme ceux des fonds historiques
annoncent celui de leurs tuiles.

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

**Le prédicat plein texte est résolu une fois par cycle, pas réinjecté à chaque
requête.** `clauseTexte()` inlinait jusqu'ici le scan `postings` + jointure `docs`
+ `GROUP BY/HAVING` dans **chaque** requête du cycle (`totaux`, `points`, les huit
facettes de `cardinalites`, les deux histogrammes, `matrice`), en mono-thread, sur
la connexion unique qui les sérialise. `preparerClauseTexte()` (`db/texte.ts`)
matérialise désormais ce résultat dans une table temporaire, une par jeu de termes
(`texte_sel_<termes>`), avant que `termesResolus` ne soit publié — `clauseTexte()`
redevient une simple fonction synchrone qui nomme la table. Mesuré en duckdb Python
sur les Parquet de `texte/` (`SET threads=1`) : un cycle (points, totaux,
cardinalités, deux histogrammes) à 1, 2 ou 3 termes passe de **48-62 ms** (clause
inlinée) à **29-45 ms** (table déjà posée) — 22 à 44 % de moins — et reste **17 à
35 % moins cher** même en comptant la création de la table dans le premier cycle.
Quatre points à ne pas défaire :

- **les noms de table sont écrits en clair** (`texte_sel_12_387`), pas hachés : avec
  `CREATE TEMP TABLE IF NOT EXISTS`, une collision de hachage rendrait en silence
  les notices d'un autre jeu de termes ;
- **un cache LRU de 8 tables** (`Map`, ordre d'insertion) borne la mémoire ; l'entrée
  évincée est la plus ancienne, jamais celle qu'on vient de poser ;
- **`preparerClauseTexte()` doit être attendue avant `poserTermes()`** : la table doit
  exister avant que le prédicat qui la vise ne parte dans le cycle de requêtes ;
- **un compteur de génération dans `preparer()`** (`state/texte.svelte.ts`) empêche
  une résolution périmée (frappe, puis frappe suivante avant que la table précédente
  soit posée) d'écraser `termesResolus` avec des termes que la puce n'affiche déjà
  plus.

**Le plein texte a un plafond structurel : 24 819 notices sur 46 760 portent un
historique.** La vue liste le dit quand le mode est actif, et nomme les mots que le
lexique ne connaît pas. Sans ces deux phrases, un résultat vide ressemble à un bug.

**Les facettes s'évaluent sans leur propre filtre.** `buildWhere(filtres, except)` —
retirer ce mécanisme fait tomber à zéro toutes les options non cochées et tue le
filtrage croisé. `queries.facette()` passe systématiquement la clé en `except`.

**`echapperLike()` est partagé entre la recherche par titre et la recherche de
facette** (`db/duckdb.ts`), plutôt que dupliqué : les deux neutralisent `%`, `_` et
l'antislash de la même façon avant un `LIKE ... ESCAPE '\\'`. Un `%` ou un `_` saisi
par l'utilisateur est sinon un joker : une recherche de commune sur « saint_denis »
retomberait sur toute commune dont le neuvième caractère est quelconque.

**Les clauses numériques de `CLAUSES` (`filters.svelte.ts`) se gardent contre une
valeur invalide plutôt que de lever.** `filters` est muté par du code de confiance
(`toggle`, `permalien.decoder`, déjà borné), mais une valeur numérique corrompue
(`NaN`, `Infinity`, un flottant là où un entier est attendu) interpolée telle quelle
dans le SQL casserait la requête entière : `entierValide`/`reelValide` l'écartent
silencieusement plutôt que de faire planter tout le cycle pour un seul filtre
corrompu — siècles, plage d'années, seuil Palissy, bbox.

**`enregistrer()` (`db/duckdb.ts`) mémoïse la promesse d'enregistrement, pas
seulement son résultat.** Peupler un `Set` après coup laissait une fenêtre ouverte
tant que l'`await` de `registerFileURL` durait : deux appels partis avant qu'elle se
referme enregistraient deux fois le même fichier. La `Map<string, Promise<void>>`
fait qu'un second appel concurrent sur le même nom trouve l'enregistrement déjà en
vol et l'attend, sans en relancer un second ; un échec retire l'entrée pour qu'un
prochain appel puisse retenter, plutôt que de rester coincé sur une promesse rejetée
à vie.

**`USING SAMPLE 1 ROWS` passe sous le filtre.** `auHasard()` tirait une ligne de la
table entière puis lui appliquait le prédicat : `has_historique` ne couvrant que 24 819
notices sur 46 760, le bouton « Au hasard » restait muet une fois sur deux — mesuré,
trois clics sans effet sur cinq. `ORDER BY random() LIMIT 1` corrige, et
`07-permalien.spec.ts` le verrouille (`au hasard ouvre une fiche`). Le tri de
46 760 lignes ne coûte rien à côté d'un bouton qui ne répond pas.

**Deux filtres ont un état miroir hors de `filters`.** `retirer()` ne suffit donc pas,
et c'est la page qui complète : `recherche` a le champ de la barre, qui l'alimente par
un effet retardé et garderait son texte ; `bbox` a `suivreVue`, qui la reposerait au
prochain `moveend`. Même chose pour `reset()`. `suivreVue` **vit dans la page** depuis
que sa case est dans le tiroir des filtres : `MonumentMap` le reçoit en `$bindable` et
un seul effet y répond — lier pose la zone courante, délier la retire. C'est ce qui a
remplacé l'ancien `delierVue()` exporté, que la page devait penser à appeler.

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

**Le cycle de requêtes est éclaté en effets, et le découpage suit ce que l'œil
regarde.** (La liste en a reçu un cinquième depuis, cf. « Tri par proximité » plus bas.) Les quatorze requêtes partaient dans un seul `Promise.all`, dont un seul
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

**La matrice retire un filtre par axe.** `buildWhere` accepte une liste de clés
à exclure ; `matrice()` en passe deux (`siecles`, `anneeProtection`), sinon
choisir une cellule réduirait la matrice à cette seule cellule. Les couples
(notice, siècle, décennie) sont dédoublonnés : une notice à deux actes dans la
même décennie compterait deux fois. Les siècles antérieurs au 10e sortent des
axes mais leur nombre est affiché sous le graphique. Elle tient désormais en **une
seule requête** plutôt que deux : les deux anciennes partageaient la même CTE
`couples` mais se sérialisaient sur la connexion unique (`Promise.all` ne les
parallélise pas). `couples` est `MATERIALIZED` pour n'être calculée qu'une fois
malgré les deux lectures qui suivent ; la ligne des écartées porte un `siecle`
sentinelle (`-1`, hors du domaine des siècles) pour voyager dans le même résultset
sans que `NULL` n'ait à se distinguer d'un siècle authentique. Vérifié ligne à ligne
contre l'ancienne forme en duckdb Python sur 5 prédicats (aucun filtre, un domaine,
un statut, une région, deux filtres combinés) : mêmes cellules, même compte
d'écartées à chaque fois.

**`Detail.auteurs`** (`queries.ts`) porte la liste consolidée des auteurs — celle
qu'utilise déjà la facette — distincte d'`auteurs_detail`, qui garde la forme brute
du champ source. Elle alimente les pastilles de filtrage rapide de la fiche
(cf. `docs/conception-interface.md`).

**Tri par proximité : la liste a son propre effet.** `liste(f, limite, proche)`
(`queries.ts`) calcule une distance **haversine** en SQL et trie dessus ; `lib/geo.ts`
porte la même formule pour la distance affichée dans la fiche, afin qu'une notice
annonce la même valeur aux deux endroits. Haversine plutôt qu'une approximation plane :
le corpus couvre l'outre-mer. Quatre points à ne pas défaire :

- **la liste a quitté l'effet principal.** Elle dépend aussi de la position, qui n'a rien
  à relancer des points ni des totaux ;
- **la position entre dans la clé arrondie à 3 décimales** (`cleProche`, une centaine de
  mètres). En suivi, le navigateur renvoie une position toutes les quelques secondes, et
  chacune relancerait la requête pour un ordre inchangé ;
- **ce tri, et lui seul, écarte les 2 276 notices sans coordonnées** — une distance ne se
  calcule pas sans elles. La liste par pertinence les garde toutes, et l'en-tête le dit
  (« absentes de la carte et de ce tri ») ;
- **ni la position ni le tri n'entrent dans l'URL ou dans `localStorage`**
  (`state/position.svelte.ts`) : un lien partagé ne dit pas où se tenait celui qui l'a
  copié. À la **première** position obtenue la liste passe d'elle-même en proximité ;
  ensuite le choix appartient à l'utilisateur.

**Le nuage du premier écran est précalculé (`points.json`), et DuckDB le remplace.**
Cf. `docs/contraintes.md` pour la mesure. Côté page : il ne part que si l'URL ne porte
**aucun** filtre, et ne se pose que si le moteur n'a pas encore répondu et que le jeton
vaut encore 1. `lib/db/points.ts::entite()` est le **seul** constructeur d'entité des
deux chemins — si le nuage instantané et celui de `queries.points()` divergeaient d'une
propriété, la carte se repeindrait au remplacement. Le compte provisoire ne porte que
`total` et `geolocalises` ; classés, inscrits et objets attendent le moteur.

**Les rejets sont signalés, pas supprimés.** Un segment de date illisible produit
quand même un événement (année nulle) et une ligne dans `etl/out/rejets.csv`.
