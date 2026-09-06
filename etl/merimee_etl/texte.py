"""Index plein texte des historiques, scoré BM25 dans le navigateur.

Pourquoi ici et pas dans le navigateur — c'est la question que ce module doit
fermer, parce que DuckDB sait indexer des deux côtés :

* indexer côté navigateur suppose d'y avoir **tout le texte**, donc de rapatrier
  les 32 fragments `details` (12 Mo), alors qu'une fiche n'en télécharge qu'un ;
* `create_fts_index` sur le seul `historique` coûte 2,2 s en natif
  multi-thread. Le bundle wasm retenu est `eh`, **mono-thread** faute de pouvoir
  poser les en-têtes COOP/COEP sur un hébergement statique ;
* charger l'extension `fts` à l'exécution ferait dépendre le site d'un CDN
  tiers, ce que `duckdb.ts` évite délibérément en servant ses bundles en local.

Trois fichiers sortent, tous sous `web/static/data/texte/` :

    postings.parquet   (terme, doc, tf), trié par terme      ~3,2 Mo
    lexique.parquet    forme de surface -> terme             ~0,3 Mo
    docs.parquet       doc -> référence, longueur            ~0,2 Mo

Le **lexique** est ce qui dispense le navigateur d'un stemmer. L'index porte des
radicaux Snowball (`jub`, `machicoul`) ; le lexique y rattache toutes les formes
rencontrées dans le corpus, si bien que `mascaron` et `mascarons` désignent le
même terme sans qu'une ligne de linguistique parte dans le bundle.

Comme l'instantané Wikidata, ce module **dégrade en silence** : sans `duckdb`
installé ou sans extension `fts` chargeable — machine hors ligne, première
exécution — rien n'est écrit, le pipeline réussit, et le navigateur n'offre
simplement pas la recherche plein texte. C'est ce qui garde l'ETL et ses tests
hors réseau.
"""

from __future__ import annotations

from pathlib import Path

from .config import OUT_DIR, TEXTE_ROW_GROUP

# Un seul champ indexé. `precision_protection` n'ajouterait que la langue des
# arrêtés — les termes les plus fréquents du corpus en sortent (`arret` 44 645,
# `inscript` 36 245, `cad` 27 120) — quand le vocabulaire d'architecture visé
# vit dans `historique` : machicoulis 550 sur 555, jubé 34 sur 35.
CHAMP = "historique"

FICHIERS = ("postings.parquet", "lexique.parquet", "docs.parquet")


def _connexion():
    """Base en mémoire avec `fts` chargée, ou `None` si c'est impossible.

    `INSTALL fts` sort sur le réseau la première fois. L'échec n'est pas une
    erreur du pipeline : il rend juste l'index absent.
    """
    try:
        import duckdb
    except ImportError:
        return None
    try:
        connexion = duckdb.connect()
        connexion.sql("INSTALL fts")
        connexion.sql("LOAD fts")
    except Exception:
        return None
    return connexion


def construire(out_dir: Path = OUT_DIR) -> dict[str, int] | None:
    """Écrit les trois fichiers, ou `None` si l'index n'a pas pu être bâti."""
    fragments = out_dir / "details"
    if not any(fragments.glob("*.parquet")):
        return None

    connexion = _connexion()
    if connexion is None:
        return None

    dossier = out_dir / "texte"
    dossier.mkdir(parents=True, exist_ok=True)
    source = (fragments / "*.parquet").as_posix()

    connexion.sql(
        f"""
        CREATE TABLE docs AS
        SELECT reference, {CHAMP} AS t FROM read_parquet('{source}')
        WHERE {CHAMP} IS NOT NULL AND {CHAMP} <> ''
        """
    )
    # `stopwords='none'` : la sémantique de la recherche est ET, et couper les
    # mots fréquents ferait échouer « église romane » sur son premier mot.
    connexion.sql(
        "PRAGMA create_fts_index('docs', 'reference', 't',"
        " stemmer='french', stopwords='none', overwrite=1)"
    )

    # Le tri par terme et la taille de groupe de lignes ne sont pas cosmétiques :
    # les statistiques Parquet permettent alors au navigateur d'écarter les
    # groupes hors des termes cherchés, sans matérialiser 1,6 M de lignes.
    connexion.sql(
        f"""
        COPY (
          SELECT termid::INT AS terme, docid::INT AS doc, count(*)::UTINYINT AS tf
          FROM fts_main_docs.terms GROUP BY 1, 2 ORDER BY 1, 2
        ) TO '{(dossier / "postings.parquet").as_posix()}'
        (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE {TEXTE_ROW_GROUP})
        """
    )
    # Les formes de surface du corpus, rattachées à leur radical. Le découpage
    # reproduit celui du tokeniseur `fts` : accents retirés, minuscules, tout ce
    # qui n'est pas une lettre sépare.
    connexion.sql(
        f"""
        COPY (
          WITH formes AS (
            SELECT DISTINCT unnest(
              regexp_split_to_array(strip_accents(lower(t)), '[^a-z]+')
            ) AS forme FROM docs
          )
          SELECT f.forme, d.termid::INT AS terme
          FROM formes f JOIN fts_main_docs.dict d ON d.term = stem(f.forme, 'french')
          WHERE length(f.forme) >= 2
          ORDER BY f.forme
        ) TO '{(dossier / "lexique.parquet").as_posix()}'
        (FORMAT parquet, COMPRESSION zstd)
        """
    )
    connexion.sql(
        f"""
        COPY (
          SELECT docid::INT AS doc, name AS reference, len::INT AS longueur
          FROM fts_main_docs.docs ORDER BY docid
        ) TO '{(dossier / "docs.parquet").as_posix()}'
        (FORMAT parquet, COMPRESSION zstd)
        """
    )
    connexion.close()

    return {f"texte/{nom}": (dossier / nom).stat().st_size for nom in FICHIERS}
