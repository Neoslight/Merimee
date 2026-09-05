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

Tout état d'exploration vit dans l'URL : un croisement trouvé se partage par simple
copie du lien, et le retour arrière referme la fiche ouverte.

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
pytest                         # 52 tests
```

Le rapport affiché doit annoncer 46 760 notices, 44 484 géolocalisées,
51 640 actes de protection et 126 597 liens Palissy. Les segments hors-format
rencontrés sont listés dans `etl/out/rejets.csv`.

### 3. L'application

```bash
cd web
npm install
npm run dev                    # http://localhost:5173
npm run build && npm run test  # build statique + 14 vérifications en navigateur
```

`npm run test` lance Chromium sur le build : **43 vérifications** couvrant le
démarrage de DuckDB-Wasm, le filtrage croisé, la recherche dans une facette au-delà
des 40 valeurs affichées, la matrice, les permaliens, le gabarit téléphone, et le
fait qu'ouvrir une fiche ne télécharge qu'un fragment de ~320 Ko. Nécessite
`npx playwright install chromium` une fois.

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
| `details/0-31.parquet` | textes longs, liens, mobilier — 32 fragments | 10,3 Mo au total |

Les deux premiers sont matérialisés en table au démarrage. Les fragments de
`details` sont chargés à la demande, un seul par fiche consultée.

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
