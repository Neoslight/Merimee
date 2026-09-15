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
l'interface. Le thème pilote l'interface **et la carte** : en clair, terres grège et mers
gris-bleu, volontairement un cran plus sombres que les panneaux, qui flottent au-dessus ;
en sombre, l'ardoise. La feuille CARTO n'est pas prise telle quelle, elle est repeinte
couche par couche à la palette du projet.

À l'échelle nationale les points tombent à 1,2 px et sous la moitié de l'opacité : ce
sont leurs **superpositions** qui dessinent les régions denses, et le point retrouve sa
présence dès qu'on zoome. Pour compter plutôt que situer, la bascule « densité » agrège
vraiment.

Aucun serveur applicatif : un pipeline Python produit des fichiers Parquet, que le
navigateur interroge en SQL via DuckDB-Wasm.

```
data/raw/merimee.csv  ──ETL Python──▶  web/static/data/*.parquet  ──▶  DuckDB-Wasm
    100 Mo, 78 colonnes                     2,5 Mo + 32 fragments        (navigateur)
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
python -m merimee_etl          # ~12 s, écrit dans web/static/data/
pytest                         # 94 tests
```

Le rapport affiché doit annoncer 46 760 notices, 44 484 géolocalisées,
51 640 actes de protection et 126 597 liens Palissy. Les segments hors-format
rencontrés sont listés dans `etl/out/rejets.csv`.

### 3. L'application

```bash
cd web
npm install
npm run dev                    # http://localhost:5173
npm run test:unit              # Vitest, 52 tests sur la logique pure
npm run build && npm run test  # build statique + 181 vérifications en Chromium
```

`npm run test` lance Chromium sur le build, réparti en 12 fichiers
(`tests/e2e/*.spec.ts`) qui couvrent le démarrage de DuckDB-Wasm, le filtrage croisé,
la recherche dans une facette au-delà des 40 valeurs affichées, la matrice, les
permaliens, le chemin clavier des deux frises, le gabarit téléphone, les deux
thèmes — contraste calculé dans chacun, polices réellement servies, aucune couleur en
dur hors d'`app.css` —, les puces de filtres actifs, le brossage des siècles, et le
fait qu'ouvrir une fiche ne télécharge qu'un fragment de ~320 Ko. Une mesure en pixels
vérifie que le tiroir ne prend **aucune** largeur à la carte : c'est la régression que
le passage en calques risque le plus. Nécessite `npx playwright install chromium` une
fois, et le build servi avec ses **vraies données** — la suite appelle aussi CARTO en
réseau pour vérifier que le fond clair est réellement reteinté, elle ne tourne donc
pas en intégration continue.

`npm run test:unit` (Vitest) couvre la même logique sans navigateur ni données —
construction du prédicat SQL, sérialisation de l'URL, hachage des fragments, teinte
du fond de carte — et tourne dans la CI (`.github/workflows/ci.yml`) à chaque push et
pull request vers `main`, avec `npm run check` et `npm run build`. L'ETL complet et
la suite Playwright, qui exigent respectivement le CSV source (100 Mo, non versionné)
et les données qu'il produit, restent hors CI et se lancent à la main.

`npm run apercu` régénère `static/apercu-social.png`, la vignette des cartes de
lien, capturée sur l'application elle-même : une image dessinée à la main cesserait
d'être vraie au premier changement d'interface.

### 4. Déploiement (GitHub Pages)

```bash
cd web && npm run deploy
```

`deploy` lance d'abord `predeploy` (`npm run check && npm run test:unit`), que npm
enchaîne automatiquement devant tout script `deploy` : un déploiement ne part plus
sans ces deux gardes. Le site est publié sur <https://neoslight.github.io/Merimee/>.

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
| `monuments.parquet` | 46 760 notices × 20 colonnes, dont les champs multivalués en colonnes `LIST` | 2,2 Mo |
| `protections.parquet` | 51 640 actes de protection datés | 0,4 Mo |
| `details/0-31.parquet` | textes longs, liens, mobilier, photographies — 32 fragments | 11,8 Mo au total |
| `texte/*.parquet` | index plein texte des historiques : postings, lexique, longueurs | 3,8 Mo au total |

Les deux premiers sont matérialisés en table au démarrage. Les fragments de
`details` sont chargés à la demande, un seul par fiche consultée ; l'index plein texte
l'est au premier usage du mode « historiques », et jamais sinon.

## Décisions structurantes

Le détail de chaque décision — mesures, contre-exemples, code exact impliqué — vit
dans [CLAUDE.md](CLAUDE.md), le repère de travail du dépôt, et dans
[docs/](docs/), où il est classé par domaine : [conception-donnees.md](docs/conception-donnees.md)
pour le modèle en colonnes `LIST`, les facettes, le plein texte, le permalien et le
cycle de requêtes ; [conception-carte.md](docs/conception-carte.md) pour MapLibre, les
fonds historiques et la teinte du fond clair ; [conception-interface.md](docs/conception-interface.md)
pour la mise en page, le focus et l'accessibilité ; [conception-photographies.md](docs/conception-photographies.md)
pour les trois ponts Wikidata / Commons / Mémoire et le cadrage des images de fiche.
[contraintes.md](docs/contraintes.md) rassemble ce qui a été mesuré plutôt que décidé
— le comportement de DuckDB-Wasm, de MapLibre, du cache GitHub Pages. Cette section
recopiait ces mêmes décisions et avait fini par en diverger ; mieux vaut un seul
endroit à jour que deux qui dérivent.

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
