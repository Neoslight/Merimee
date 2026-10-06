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

**La recherche propose avant de filtrer** (phase 5). Taper ne filtre plus : le
corpus tombait à « Rou » avant qu'on ait fini « Rouen ». La saisie ouvre une liste de
suggestions (`Recherche.svelte`, motif « combobox » de l'ARIA), et c'est un geste qui
applique :

- **`suggestions()`** (`db/suggestions.ts`) répond en **une** requête `UNION ALL` sur
  `monuments` : communes (avec leur département), départements, régions, édifices (tous
  les mots dans `search_key`, comme le filtre de titre), dénominations, domaines,
  auteurs. Ce qui **commence** par la saisie passe devant, puis l'effectif. Aucun
  géocodeur, aucun appel réseau ; débattue à 150 ms, un jeton écarte les réponses
  périmées. Les suggestions **ignorent les filtres posés** : on cherche un nom, pas une
  intersection ;
- **chaque famille a son geste** : une commune, une région ou un département **pose**
  son filtre, et l'effet des lieux cadre ce qui reste ; un édifice **ouvre** sa fiche ;
  une catégorie pose sa facette. Le champ se vide quand une puce porte désormais le
  filtre. La commune n'est pas une facette du panneau mais un filtre à part entière
  (`communes`, `commune=` dans l'URL) : chercher « Baden » cadrait la commune en
  laissant tout le pays à l'écran, la carte ne répondait pas à la question. Sa valeur
  est `Baden (Morbihan)` — commune et département, comparés en SQL sous la même forme
  (`SQL_COMMUNE`, `libelleCommune`) : 514 des 16 374 noms de commune du corpus existent
  dans plusieurs départements ;
- **Entrée** — ou la première ligne, « Toutes les notices contenant… » — applique le
  filtre de titre (`recherche`, `q=`), ouvre la liste, et cadre l'emprise des résultats
  **si elle tient en métropole** (`dansMetropole`) : « Saint-Pierre » trouve aussi la
  Réunion, et cadrer les deux montrerait l'océan ;
- **la recherche dans les historiques est la dernière ligne** (« Chercher dans les
  historiques… »), plus un bouton à côté du champ. Le mode se dit dans le champ par une
  pastille « Historiques », qui le quitte ; vider le champ le quitte aussi. L'index
  (3,8 Mo) part toujours au premier usage. Un lien `texte=` résout ses termes au
  chargement, et un retour arrière aussi (ANO-12) ;
- **le champ vide propose des raccourcis** (`RACCOURCIS`, `lib/recherche.ts`) : Vauban,
  Guimard, Le Corbusier, Viollet-le-Duc, mégalithes, phares, cathédrales, moulins. Ils
  remplacent les filtres courants ; leurs valeurs sont celles du corpus, à la lettre, et
  `17-recherche.spec.ts` vérifie que chacun trouve des notices ;
- **`replier()` plie les ligatures et les apostrophes typographiques** (`plier`) : « œ »
  devient « oe », comme dans la quasi-totalité du corpus, « ’ » devient « ' » comme dans
  `search_key` et le lexique (ANO-04). `surligner()` repère la saisie dans un libellé
  malgré un repliage qui change la longueur.

La liste ne se rouvre qu'à la **frappe**, au focus ou au clic — pas à tout changement du
champ : après un choix la page le vide, et les raccourcis se rouvraient par-dessus la
rangée de puces. `/` amène au champ depuis n'importe où, sauf depuis un autre champ.

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
facettes de `cardinalites`, les deux histogrammes), en mono-thread, sur
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
46 760 lignes ne coûte rien à côté d'un bouton qui ne répond pas. Même raison pour
`has_historique`, devenu un **ordre** (`ORDER BY has_historique DESC, random()`) et non
plus un filtre : sous une sélection qui ne garde que des notices sans historique, le
bouton restait muet. Il préfère toujours une notice qui a quelque chose à lire, et
retombe sur les autres plutôt que sur rien ; sous un filtre vide, la page le dit
(`avis`). `has_photo` s'y ajoute de la même façon, et sur la carte les notices situées
passent en tête (`situee`) : le tirage s'y termine par un vol, il lui faut une
destination. En vue liste, le tirage reste ouvert aux 2 276 notices sans coordonnées.

**`has_photo` est un booléen de `monuments`, miroir de `details.commons` non vide.**
Les noms de fichiers restent dans les fragments ; « Au hasard » peut préférer une notice
illustrée sans en télécharger un seul. +4,2 Ko sur `monuments.parquet` (2 150 102 →
2 154 310 octets). Hors oracle : il suit l'instantané tiers, pas le fichier source.
`test_has_photo_suit_les_fragments` vérifie l'égalité notice par notice.

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
« Copier le lien », et consommée au chargement — et **tue quand elle montrerait où se
tient l'utilisateur** (`devoilePosition`, `lib/carte/camera.ts`) : après « Me
localiser » la carte est centrée sur lui, et le lien copié le disait à cent mètres
près. Conséquence à ne pas rouvrir : la lecture URL → état compare des chaînes
**normalisées** (`encoder(decoder(search))`) et non la chaîne brute, sinon `c=` paraît
toujours différent de l'état ; l'écriture se fait par `replaceState`, sauf
l'**ouverture** d'une fiche qui empile (`pushState`) pour que le retour arrière la
referme. La fermeture, elle, remplace : elle empilait aussi, et le retour arrière
rouvrait la fiche qu'on venait de quitter. `decoder` valide toute valeur : l'URL est
éditable à la main et ses chaînes finissent dans `lit()`.

**Le retour arrière lit `location`, pas `page.url`.** Sous le routage superficiel
(`pushState` / `replaceState` de `$app/navigation`), SvelteKit conserve dans `page.url`
l'adresse du **chargement** et la restitue à chaque `popstate`. L'effet qui la relisait
rejouait donc l'état d'arrivée : ouvrir une fiche depuis la liste puis revenir ramenait
la vue carte sous une barre d'adresse qui disait `vue=liste`, et un filtre retiré
depuis le chargement serait revenu. La page écoute `popstate` et décode
`location.search` (`relireUrl`). `07-permalien.spec.ts` vérifie que la vue liste
survit au retour, et qu'un retour après fermeture à la croix ne rouvre rien.

**La liste dit le siècle, se trie et se pagine** (phase 6). Chaque ligne porte le
dernier siècle indexé (`siecle_max`) et la pastille de son statut. Trois ordres :
mobilier (ou pertinence BM25 en plein texte), **A–Z** (`strip_accents(lower(titre))` —
« église » ne tombe pas après « Zénith »), proximité une position connue. « Afficher 200
de plus » relève le plafond ; tout changement de filtre ou d'ordre le ramène à 200. Le
survol d'une ligne (pointeur fin) cercle son point sur la carte (`monuments-survol`).

**La liste ne part qu'ouverte** (phase 4), comme les facettes et la frise : elle vit
dans le volet, fermé au démarrage. Le premier écran n'émet plus que deux requêtes, le
nuage et les totaux.

**Choisir une région, un département ou une commune cadre la carte dessus**, une fois les points
arrivés : `emprise()` (`lib/carte/camera.ts`, pure) calcule les bornes du nuage
filtré, `cadrer()` les ajuste, plafonné à z12. Aucune table de contours à embarquer :
la sélection dit elle-même où regarder. Seulement quand on **ajoute** un lieu — en
retirer ne doit pas faire sauter la vue.

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
- **`vue` ne déclenche plus rien.** Il était lu dans le corps de l'effet principal,
  ce qui en faisait une dépendance de l'effet **entier** : basculer carte → liste
  relançait les quatorze requêtes sans qu'aucun filtre ait bougé. Aucun effet de
  requête ne le lit plus depuis la suppression de la matrice, qui en était le dernier
  lecteur ;
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

**La matrice siècle × décennie a été supprimée.** Vue entière, sans chemin clavier ni
légende, elle répétait en plus dense ce que les deux frises disent côte à côte.
`buildWhere` garde sa liste de clés à exclure (`except`), qui lui servait à retirer un
filtre par axe : c'est un mécanisme général, éprouvé en Vitest. Un lien `?vue=matrice`
déjà partagé retombe sur la carte, comme toute valeur de `vue` inconnue.

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

## Couche « Architecture contemporaine remarquable » (ACR)

**Un second corpus, jamais dans le prédicat.** `data/raw/merimee_acr.csv` (5,8 Mo, non
versionné, export POP du 2026-09-15) : 1 822 notices `ACR…`, 44 colonnes dont les noms
ne recoupent qu'en partie ceux de `merimee.csv` — `Reference_de_la_notice`,
`Coordonnees` (« lat,lon » comme le champ WGS84, lu par le même `parse_coords`),
`Titre_courant`, `Description_historique`, `Description_de_l_edifice`, `Date_de_Label`.
Aucune facette, aucun compteur, ni la liste, ni les frises ne la voient :
c'est un calque de carte et une fiche, rien d'autre.

- **Mesures qui justifient de ne pas dédoublonner** : le label se perd à la protection MH,
  et le recouvrement tient à 5 renvois `PA` dans `Ancienne_reference_de_la_notice_RENV` ;
  23 points MH tombent à moins de 30 m d'un point ACR, ce sont des voisins et non des
  doublons (aucun ne porte `label XXe` dans `Cadre_de_l_etude`).
- **1 743 situées sur 1 822** : 1 744 coordonnées non vides, une hors des bornes de
  `parse_coords`. Figé dans `test_couche_acr_volumes`.
- **Remplissage** : label 99,7 %, auteurs 96,2 %, description 78 %, historique 64 %,
  intérêt 17,8 % ; les descripteurs techniques (matériaux, couverture…) sont sous 2 % et
  ne sont pas repris. 13 notices portent deux années de label (`2000 ; 2026`) :
  `annee_label` retient la première, `annees_label` les garde toutes.
- **Titres** : 336 `Titre_courant` commencent en minuscule, `titre_acr()` pose la
  majuscule initiale — seule retouche éditoriale.
- **Artefacts** (`etl/merimee_etl/acr.py`, lancé par `cli` si la source existe, sinon
  sauté sans erreur) : `acr/points.json` (61 Ko, 18 Ko gzip) et `acr/fiches/{0..7}.parquet`
  (2,2 Mo au total). Huit fragments et non un fichier : 1,8 Mo d'un bloc au premier clic
  était trop sur téléphone. Même FNV-1a que `details`, modulo 8 (`shards.ts::fragmentAcr`).
- **Rien ne part au démarrage.** Le nuage est demandé à la première activation
  (`db/acr.ts::pointsAcr`, promesse mémoïsée, libérée sur échec), un fragment au premier
  clic (`enregistrer`, hors `boot()`). Vérifié en e2e par le compteur d'octets serveur.
- **Fiche au format `Detail`** : `ficheAcr()` rend les champs de protection vides et
  ajoute `acr: { annees, datation, interet, description }`. `DetailPanel` aiguille sur
  le préfixe (`lib/acr.ts::estAcr`) et ne branche que le badge et les sections.
- **Permalien** : `acr=1`, absent par défaut — aucun lien antérieur ne change. `ref=ACR…`
  sans `acr=1` rallume la couche au décodage, pour qu'une fiche partagée ait son point ;
  masquer la couche referme une fiche ACR ouverte.
- **Photographies** : même pont que Mérimée, instantanés séparés
  `wikidata_images_acr.csv` (`python -m merimee_etl.wikidata --acr` : les identifiants
  ACR sont sous **la même propriété `P380`**, 364 notices illustrées soit 20 %) et
  `commons_images_acr.csv` (`commons --acr`, modèle `{{Mérimée|ACR…}}` sur Commons).
