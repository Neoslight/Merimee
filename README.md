# Mérimée — tableau de bord des monuments historiques

Exploration cartographique et chronologique des **46 760 immeubles protégés au titre
des Monuments historiques** (base Mérimée, plateforme POP du ministère de la Culture).

Carte WebGL des 44 484 notices géolocalisées, filtrage croisé instantané sur une
douzaine de facettes, et double frise temporelle : époque de construction d'un côté,
année de l'arrêté de protection de l'autre — de la première liste Mérimée de 1840
jusqu'aux arrêtés de 2026.

Une troisième vue croise les deux axes en une matrice : **ce qui a été protégé, et
quand**. Les années 1920 classent le 16e siècle, les années 1980-90 se tournent vers
le 18e et le 19e — le déplacement du regard patrimonial se lit d'un coup d'œil.

Les filtres posés s'affichent en puces sous la barre : on voit lesquels sont actifs et
on en retire un seul d'un clic. Les deux panneaux — facettes à gauche, fiche à droite —
sont des tiroirs qui flottent au-dessus de la carte au lieu de la compresser. Le bouton
qui ouvre les facettes se pose au coin de la carte, là où le tiroir apparaît, et
s'efface tant qu'il est ouvert.

Les commandes de la carte sont rangées par question : la légende, en bas à gauche, dit
ce que les couleurs signifient puis propose de les changer ; les cartes anciennes —
Cassini, l'état-major — prolongent la colonne d'outils du zoom et s'y replient en une
pastille, parce qu'un calque posé sous les points n'est pas une clé de lecture et qu'on
ne s'en sert pas en continu ; et « limiter à la zone visible », qui restreint le corpus,
est passé parmi les filtres, avec les autres critères.

Les deux frises répondent aux mêmes gestes : un clic pose une valeur, un glissement une
plage, un second clic au même endroit l'efface. Elles se replient d'un geste, comme le
tiroir des facettes, et rendent alors le tiers bas de l'écran à la carte.

Tout état d'exploration vit dans l'URL : un croisement trouvé se partage par simple
copie du lien, et le retour arrière referme la fiche ouverte. Sombre ou clair, au
choix — le thème reste hors de l'URL, un lien s'ouvre dans celui de son destinataire.

Blanc calcaire, ardoise, terracotta pour le classé et ocre doré pour l'inscrit ;
Newsreader pour les titres d'édifices et le texte d'archive, Plus Jakarta Sans pour
l'interface. Le thème ne pilote que l'interface : la carte reste sombre dans les deux
cas, les panneaux calcaire se posant sur une carte ardoise et non l'inverse. Les frises,
elles, suivent le thème : elles appartiennent à l'interface, pas à la carte.

Aucun serveur applicatif : un pipeline Python produit des fichiers Parquet, que le
navigateur interroge en SQL via DuckDB-Wasm.

```
data/raw/merimee.csv  ──ETL Python──▶  web/static/data/*.parquet  ──▶  DuckDB-Wasm
    100 Mo, 78 colonnes                     2,7 Mo + 32 fragments        (navigateur)
```

## Mise en route

### 1. Les données

Le CSV source (`merimee.csv`, 100 Mo) n'est pas versionné. Le placer dans
`data/raw/merimee.csv`. Il provient de l'export « liste générale des immeubles
protégés » de [POP](https://www.pop.culture.gouv.fr/).

### 2. Le pipeline

```bash
cd etl
pip install -r requirements.txt
python -m merimee_etl          # ~10 s, écrit dans web/static/data/
pytest                         # 55 tests
```

Le rapport affiché doit annoncer 46 760 notices, 44 484 géolocalisées,
51 640 actes de protection et 126 597 liens Palissy. Les segments hors-format
rencontrés sont listés dans `etl/out/rejets.csv`.

### 3. L'application

```bash
cd web
npm install
npm run dev                    # http://localhost:5173
npm run build && npm run test  # build statique + 77 vérifications en navigateur
```

`npm run test` lance Chromium sur le build : **77 vérifications** couvrant le
démarrage de DuckDB-Wasm, le filtrage croisé, la recherche dans une facette au-delà
des 40 valeurs affichées, la matrice, les permaliens, le gabarit téléphone, les deux
thèmes — contraste calculé dans chacun, polices réellement servies, aucune couleur en
dur hors d'`app.css` —, les puces de filtres actifs, le brossage des siècles, et le
fait qu'ouvrir une fiche ne télécharge qu'un fragment de ~320 Ko. Une mesure en pixels
vérifie que le tiroir ne prend **aucune** largeur à la carte : c'est la régression que
le passage en calques risque le plus. Nécessite `npx playwright install chromium` une
fois.

`npm run apercu` régénère `static/apercu-social.png`, la vignette des cartes de
lien, capturée sur l'application elle-même : une image dessinée à la main cesserait
d'être vraie au premier changement d'interface.

### 4. Déploiement (GitHub Pages)

```bash
cd web && npm run deploy
```

Le site est publié sur <https://neoslight.github.io/Merimee/>.

Poids du premier chargement, mesuré en ligne : **≈ 10,5 Mo**, dont 7,5 Mo pour le
seul binaire `duckdb-eh.wasm` (32,7 Mo bruts, servis gzip par Pages). Les Parquet
sont la moitié la moins chère. Amorçage : 3,9 s.

Pages plafonne le cache à `Cache-Control: max-age=600`, non configurable : passé
dix minutes, le hachage des noms de fichiers ne sert plus à rien et une visite
espacée repaie tout. Un service worker prend donc le relais et met en cache les
seuls actifs hachés — vérifié par le test : au troisième chargement, **0 octet**
de wasm retéléchargé.

Les artefacts Parquet n'étant pas versionnés, la CI ne peut pas les régénérer :
le déploiement compile **en local** puis pousse `web/build` sur la branche
`gh-pages`. Refaire tourner l'ETL avant, si les données ont changé.

Trois détails que GitHub Pages impose :

- **`static/.nojekyll`** — sans ce fichier, Jekyll ignore les dossiers commençant
  par un tiret bas et tout `_app/` (JS et CSS) renvoie 404.
- **`BASE_PATH=Merimee`** — le site est servi sous `/<dépôt>/`, chemin qui doit être
  connu à la compilation. `npm run build` sans cette variable reste destiné au local.
- **`--no-history`** sur `gh-pages` — la branche est recréée à chaque déploiement,
  sinon les 13 Mo de Parquet s'empilent dans l'historique.

## Artefacts produits

| Fichier | Contenu | Taille |
|---|---|---|
| `monuments.parquet` | 46 760 notices × 29 colonnes, dont les champs multivalués en colonnes `LIST` | 2,3 Mo |
| `protections.parquet` | 51 640 actes de protection datés | 0,4 Mo |
| `details/0-31.parquet` | textes longs, liens, mobilier, photographies — 32 fragments | 11,2 Mo au total |
| `texte/*.parquet` | index plein texte des historiques : postings, lexique, longueurs | 3,8 Mo au total |

Les deux premiers sont matérialisés en table au démarrage. Les fragments de
`details` sont chargés à la demande, un seul par fiche consultée ; l'index plein texte
l'est au premier usage du mode « historiques », et jamais sinon.

## Décisions structurantes

**Colonnes `LIST` plutôt que tables de liaison.** Domaines, siècles, dénominations,
auteurs et propriétaires restent des listes dans une seule table. DuckDB filtre avec
`list_has_any` et facette par `UNNEST` : pas de jointure, un seul fichier. Seuls les
actes de protection, qui ont leur propre granularité (4 215 notices en portent
plusieurs), justifient une table distincte.

**Bundle DuckDB `eh`, pas `coi`.** Le bundle multi-thread exige les en-têtes
COOP/COEP, impossibles à poser sur un hébergement statique. Le mono-thread répond
en quelques millisecondes sur 46 760 lignes.

**`details` éclaté en 32 fragments.** Le plan initial visait un fichier unique dont
DuckDB n'aurait lu que le row group utile, par requête HTTP Range. Vérification faite
en navigateur : duckdb-wasm 1.32 télécharge tout fichier Parquet **en entier**, que
`registerFileURL` soit appelé avec `directIO` ou qu'une URL absolue soit passée
directement à `read_parquet` — aucune requête Range n'est émise. Le fichier est donc
la seule granularité de chargement disponible. Le fragment d'une notice se déduit
d'un hachage FNV-1a de sa référence, implémenté à l'identique dans
[etl/merimee_etl/build.py](etl/merimee_etl/build.py) et
[web/src/lib/db/shards.ts](web/src/lib/db/shards.ts), donc sans index à télécharger.

**L'état d'exploration est dans l'URL.** Les valeurs multiples passent par un
paramètre répété (`?domaine=architecture+militaire&siecle=16`) plutôt que jointes
par un séparateur : 63 libellés du corpus contiennent déjà une virgule. L'emprise
de la carte en est volontairement absente — la réécrire à chaque déplacement
noierait l'URL, et le destinataire d'un lien recalcule la sienne. Les filtres
s'écrivent par remplacement d'entrée d'historique ; seule l'ouverture d'une fiche
en empile une, pour que le retour arrière la referme.

**Une facette affiche 40 valeurs, sa recherche en fouille 7 040.** Le champ
« filtrer… » triait au départ la liste déjà rapatriée : sur 7 040 auteurs,
7 000 étaient inatteignables, dont Baltard et Le Corbusier, et 5 607 n'ont qu'une
seule notice — la longue traîne est précisément ce qu'on vient chercher. La
recherche descend maintenant dans DuckDB, avec `strip_accents` pour ignorer les
accents sans stocker de colonne repliée. Une valeur cochée reste listée même hors
résultat : sans cela on ne pourrait plus la décocher.

**La recherche plein texte est indexée à l'ETL, scorée dans le navigateur.** Le champ
de la barre vise par défaut `search_key` — titre, commune, département — et répond en
quelques millisecondes. Un bouton le fait viser les **historiques** : 15,1 Mo de texte
libre où vivent les termes qu'on ne trouvait nulle part, machicoulis (550 notices),
mascaron (118), jubé (34). L'indexation, elle, ne se fait pas côté client : elle
supposerait d'y rapatrier les 12 Mo de fragments, et coûte 2,2 s en natif multi-thread
quand le bundle wasm retenu est mono-thread. `merimee_etl/texte.py` produit donc
l'index — postings triés par terme, plus un lexique des 45 826 formes du corpus qui
dispense d'embarquer un stemmer : `mascaron` et `mascarons` désignent le même terme.
Le navigateur ne fait que compter et scorer, BM25 en SQL, quelques dizaines de
millisecondes. Le plafond est dit à l'écran : **24 819 notices sur 46 760 portent un
historique**, et un mot que le lexique ignore est nommé plutôt que rendu par un
résultat vide.

**Deux palettes, un seul endroit.** MapLibre et Observable Plot reçoivent des chaînes,
pas des `var()` : leurs couleurs sont donc déclarées en CSS comme les autres et relues
par `getComputedStyle` à chaque bascule de thème, une fois par changement et non par
image. Écrire une couleur en dur dans un composant la rendrait muette au passage en
clair. La rampe de la matrice s'inverse entre les deux thèmes : en sombre l'effectif
fort est clair, en clair il est sombre, sinon la matrice disparaît dans son fond.

**La vue de carte voyage dans le lien, pas dans l'URL.** `c=lon,lat,zoom` n'est ajouté
que par le « Copier le lien » de la fiche : réécrire l'URL à chaque déplacement la
noierait et empilerait l'historique. Elle est consommée au chargement et disparaît au
premier changement de filtre — ce n'est pas un filtre, elle ne restreint aucun corpus.

**Les photographies tiennent dans les fragments déjà téléchargés.** La base Mérimée ne
porte aucun lien vers une image. Wikidata en porte un — `P380` identifiant Mérimée vers
`P18` image — et il couvre **84,6 % du corpus, 39 556 notices**. Ce pont n'est pas
étroit : 46 618 items portent déjà un `P380`, si bien que les fiches sans photographie
n'ont pas d'item manquant — la photographie n'existe pas. Un second instantané
(`python -m merimee_etl.commons`) rattrape ce que Commons héberge sans l'avoir relié à
Wikidata, par les fichiers dont la page cite la référence : **512 notices de plus,
85,7 %**. Le geosearch géolocalisé, mesuré aussi, a été écarté — 44 % de réponses mais
un sujet non vérifié, la préfecture de Nanterre y récoltant le portrait d'un ministre.

Les deux instantanés sont pris à part, versionnés séparément, puis reportés dans la
colonne `commons` de `details` : ouvrir une fiche ne coûte donc aucune requête de plus,
seule l'image part sur le réseau. Le pipeline ne va jamais en ligne de lui-même, et la
colonne vaut la liste vide si les instantanés manquent.

Le crédit auteur et la licence sont lus à la volée sur l'API Commons, parce que Wikidata
ne les porte pas : ces images sont pour la plupart sous CC-BY-SA, le crédit est une
obligation. Il n'est jamais bloquant.

**Les panneaux flottent, ils ne compressent pas.** La grille d'origine réservait
`246px | 1fr | 340px` en permanence — dont 340 px pour afficher « Sélectionnez un
point ». Les deux panneaux sont devenus des calques : la carte garde sa pleine largeur,
et les ouvrir ne provoque aucun redimensionnement du canevas WebGL. En contrepartie,
les commandes MapLibre doivent s'écarter d'eux : l'attribution CARTO est posée à la
main, en bas à droite, derrière la même marge que le zoom — une mention de licence que
la fiche recouvre, ou qui chevauche la légende, n'est pas une mention.

**Les puces disent l'état, et deux d'entre elles ont un miroir.** Retirer la puce de
recherche doit aussi vider le champ de la barre, qui alimente le filtre ; retirer celle
de la zone visible doit délier la vue de la carte, sinon le prochain déplacement la
repose aussitôt.

**Facettes évaluées sans leur propre filtre.** `buildWhere(filtres, except)` retire
la clause de la facette qu'on est en train de compter. Sans cela, dès la première
sélection toutes les options non cochées tomberaient à zéro et le filtrage croisé
serait inutilisable.

## Nettoyage appliqué aux données

Le détail des anomalies du fichier source est dans [ANALYSE_MERIMEE.md](ANALYSE_MERIMEE.md).
Le pipeline traite :

- **Pipe littéral** dans un champ quoté (notice `PA31000132`) — parseur CSV obligatoire.
- **Dates de protection hors-format** : `2006//09/15`, `201909/13`, `2018/08/6`,
  espaces insécables, deux-points manquant. 14 des 16 segments cassés sont récupérés ;
  les 2 restants n'ont pas de date du tout et sont signalés, pas supprimés.
- **Fragments d'auteurs** : le `;` coupait au milieu des mentions composées et
  produisait des auteurs fantômes (`ou` 85 fois, `dit` 59, `(architecte)` 22). Ils
  sont recollés à l'entrée précédente.
- **Identités éclatées** : le rôle est séparé du nom et les patronymes en capitales
  sont ramenés en casse normale, ce qui réunit `GUIMARD Hector (maître de l'oeuvre)`
  et `Guimard Hector (architecte)`. 8 023 → 7 040 identités distinctes.
- **Casse et apostrophes** des vocabulaires contrôlés, pilotées par
  [data/ref/vocabulaires.csv](data/ref/vocabulaires.csv).
- **Colonnes écartées** : `Producteur` (vide), `Copyright` (29 % du volume, texte
  juridique répété à l'identique), et les 28 colonnes remplies à moins de 1 %.

Deux consolidations restent **volontairement non faites**, faute de certitude
éditoriale : la dynastie des Gabriel (`Gabriel Jacques`, `Gabriel Ange-Jacques`,
`Gabriel Jacques-Ange` — père, fils et probable transposition) et la réconciliation
des codes INSEE historisés avec le COG actuel. Ajouter une ligne à
[data/ref/auteurs_alias.csv](data/ref/auteurs_alias.csv) suffit pour la première.

## Pièges à ne pas rouvrir

- **Ne jamais additionner classés et inscrits** : 2 562 notices cumulent les deux
  statuts, le total (48 874) dépasse le nombre de notices.
- **`Date_de_creation_de_la_notice` n'est pas une date métier** : 79 % des notices
  portent le 1993-03-29, date d'informatisation de la base.
- **4,9 % du corpus n'est pas géolocalisé** (2 276 notices). Elles restent
  accessibles par la vue liste, jamais silencieusement écartées.
- **`plot.value` d'Observable Plot reste nul** sur une marque non interactive : le
  clic sur un siècle retrouve sa bande via l'échelle `x`, pas via la cible du clic.

## Hors périmètre

Export CSV de la sélection, liste paginée au-delà de 200 lignes, filtres « figures »
préréglés, réconciliation du COG historisé, exploitation NLP des 23,6 Mo de texte
libre. Le modèle de données les accueille sans refonte.
