"""Tests du pipeline.

Les tests unitaires couvrent les cas tordus repérés dans le fichier source.
Les tests d'intégration rejouent les chiffres d'`ANALYSE_MERIMEE.md` sur les
artefacts produits : c'est l'oracle de non-régression du parsing.
"""

from __future__ import annotations

import collections
import json
import sys
from pathlib import Path

import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from merimee_etl.build import fnv1a, points_colonnaires, shard_of  # noqa: E402
from merimee_etl.config import DETAILS_SHARDS, OUT_DIR  # noqa: E402
from merimee_etl.normalize import normalize_text, search_key, split_multi, split_vocab  # noqa: E402
from merimee_etl.parse import (  # noqa: E402
    classify_statut,
    palissy_ids,
    parse_auteurs,
    parse_coords,
    parse_protections,
    parse_siecles,
)

# --------------------------------------------------------------------------
# Unitaires
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("48.3916559789157,4.52479043755344", (48.3916559789157, 4.52479043755344)),
        ("", (None, None)),
        ("0,0", (None, None)),
        ("48.39", (None, None)),
        ("abc,def", (None, None)),
        ("91.0,4.0", (None, None)),  # hors bornes
    ],
)
def test_parse_coords(raw, expected):
    assert parse_coords(raw) == expected


@pytest.mark.parametrize(
    "raw,siecles,periodes",
    [
        ("16e s.", [16], []),
        ("16è s.", [16], []),          # accent grave parasite
        ("20 s.", [20], []),           # suffixe ordinal absent
        ("1er s.", [1], []),
        ("limite 15e s. 16e s.", [15, 16], []),
        ("12e s.. 16e s.", [12, 16], []),
        ("15e s. : 17e s.", [15, 17], []),
        ("Antiquité (?)", [], ["Antiquité"]),
        ("Préhistoire;13e s.", [13], ["Préhistoire"]),
        ("", [], []),
    ],
)
def test_parse_siecles(raw, siecles, periodes):
    assert parse_siecles(raw)[:2] == (siecles, periodes)


def test_parse_siecles_signale_un_segment_non_reconnu():
    # Ni un siècle (`_SIECLE`) ni une période connue (`PERIODES`) : le segment
    # était perdu sans trace, il rejoint désormais le rejet, comme les
    # segments hors-format de `parse_protections`.
    siecles, periodes, rejets = parse_siecles("brouillon")
    assert siecles == [] and periodes == []
    assert rejets == ["brouillon"]


def test_parse_siecles_melange_reconnu_et_rejete():
    siecles, periodes, rejets = parse_siecles("16e s.;brouillon")
    assert siecles == [16]
    assert rejets == ["brouillon"]


@pytest.mark.parametrize(
    "raw,annee,mois,jour,statut",
    [
        ("1930/11/30 : classé MH", 1930, 11, 30, "classé"),
        ("1862 : classé MH", 1862, None, None, "classé"),
        ("2024/11/14 inscrit MH", 2024, 11, 14, "inscrit"),       # deux-points manquant
        ("2019/09/019 : inscrit MH", 2019, 9, 19, "inscrit"),     # jour sur 3 chiffres
        ("2006//09/15 : inscrit MH", 2006, 9, 15, "inscrit"),     # double slash
        ("201909/13 : inscrit MH", 2019, 9, 13, "inscrit"),       # slash manquant
        ("2018/08/6 : inscrit MH", 2018, 8, 6, "inscrit"),        # jour sur 1 chiffre
        ("2024/12/09 / inscrit MH", 2024, 12, 9, "inscrit"),      # séparateur `/`
        ("2021/01 /04 : inscrit MH", 2021, 1, 4, "inscrit"),  # espaces insécables
        ("1990/01/01 : déclassé MH", 1990, 1, 1, "déclassé"),
    ],
)
def test_parse_protections_formats(raw, annee, mois, jour, statut):
    events, _ = parse_protections("PA00000000", raw)
    assert len(events) == 1
    event = events[0]
    assert (event.annee, event.mois, event.jour, event.statut) == (annee, mois, jour, statut)


def test_parse_protections_multi_actes():
    events, rejets = parse_protections(
        "PA00000000", "1926/03/12 : classé MH;1994/07/08 : inscrit MH"
    )
    assert [e.annee for e in events] == [1926, 1994]
    assert rejets == []


def test_parse_protections_signale_les_rejets_sans_les_perdre():
    events, rejets = parse_protections("PA00116859", "inscrit MH")
    assert rejets == ["inscrit MH"]
    assert len(events) == 1 and events[0].annee is None
    assert events[0].statut == "inscrit"


def test_parse_protections_mois_hors_bornes_signale_sans_perdre_l_evenement():
    # Un mois brut de 13 n'est pas un mois : `_coerce` le réduit à `None`
    # silencieusement, mais l'événement doit rester produit (année et statut
    # lisibles) et le segment doit rejoindre les rejets, comme un segment
    # illisible.
    segment = "2019/13/05 : inscrit MH"
    events, rejets = parse_protections("PA00000000", segment)
    assert rejets == [segment]
    assert len(events) == 1
    assert events[0].annee == 2019
    assert events[0].mois is None
    assert events[0].jour == 5
    assert events[0].statut == "inscrit"


def test_parse_protections_jour_hors_bornes_signale_sans_perdre_l_evenement():
    segment = "2019/05/32 : inscrit MH"
    events, rejets = parse_protections("PA00000000", segment)
    assert rejets == [segment]
    assert events[0].mois == 5
    assert events[0].jour is None


def test_parse_protections_annee_hors_plage_devient_nulle_et_signalee():
    # `PROTECTION_YEAR_MIN`/`PROTECTION_YEAR_MAX` étaient définies dans
    # `config.py` mais jamais appliquées : une année hors plage suit
    # maintenant la même règle qu'un segment illisible — l'événement reste
    # produit, l'année devient nulle, le segment part dans les rejets.
    avant = "1500/01/01 : classé MH"
    events, rejets = parse_protections("PA00000000", avant)
    assert rejets == [avant]
    assert events[0].annee is None
    assert events[0].statut == "classé"

    apres = "2099/01/01 : classé MH"
    events, rejets = parse_protections("PA00000000", apres)
    assert rejets == [apres]
    assert events[0].annee is None


def test_parse_protections_annee_en_plage_ne_produit_aucun_rejet():
    events, rejets = parse_protections("PA00000000", "1840/01/01 : classé MH")
    assert rejets == []
    assert events[0].annee == 1840


@pytest.mark.parametrize(
    "raw,statut,partiel",
    [
        ("classé MH", "classé", False),
        ("inscrit MH partiellement", "inscrit", True),
        ("classé MH;inscrit MH partiellement", "classé+inscrit", True),
        ("déclassé MH", "déclassé", False),
        ("", "inconnu", False),
    ],
)
def test_classify_statut(raw, statut, partiel):
    assert classify_statut(raw) == (statut, partiel)


def test_auteurs_fragments_recolles():
    # Le `;` coupe au milieu de la mention : `marquis` n'est pas un auteur.
    assert parse_auteurs(
        "Vauban Sébastien Le Prestre de;marquis (ingénieur militaire)"
    ) == ["Vauban Sébastien Le Prestre de"]
    assert parse_auteurs("Jeanneret Charles-Edouard;dit;Le Corbusier (architecte)") == [
        "Le Corbusier"
    ]


def test_auteurs_casse_et_role_consolides():
    majuscules = parse_auteurs("GUIMARD Hector (maître de l'oeuvre)")
    normal = parse_auteurs("Guimard Hector (architecte)")
    inverse = parse_auteurs("Guimard, Hector (architecte)")
    assert majuscules == normal == inverse == ["Guimard Hector"]


def test_auteurs_attribution_alternative_scindee():
    assert parse_auteurs("GABRIEL Jacques-Ange, ou;GABRIEL Ange-Jacques (architecte)") == [
        "Gabriel Jacques-Ange",
        "Gabriel Ange-Jacques",
    ]


def test_normalisation_texte():
    assert normalize_text("propriété de l’État  ") == "propriété de l'État"
    assert split_multi("a ; b;c") == ["a", "b", "c"]
    assert split_vocab("Typologie_du_dossier", "Dossier de protection;dos") == [
        "dossier de protection"
    ]
    assert search_key("Château fort", "Bordeaux") == "chateau fort bordeaux"


def test_palissy_ids():
    urls = ("https://www.pop.culture.gouv.fr/notice/palissy/IM10005283;"
            "https://www.pop.culture.gouv.fr/notice/palissy/IM10005235")
    assert palissy_ids(urls) == ["IM10005283", "IM10005235"]


def test_points_colonnaires():
    df = pd.DataFrame({
        "reference": ["PA1", "PA2", "PA3"],
        "lat": [48.123456789, None, 43.0],
        "lon": [2.987654321, None, 5.5],
        "statut": ["classé", "inscrit", None],
        "nb_palissy": [3, 0, 250],
        "siecle_max": [12, None, None],
    })
    p = points_colonnaires(df)
    # La notice sans coordonnées compte dans le total, pas dans le nuage.
    assert (p["total"], p["geolocalises"]) == (3, 2)
    assert p["reference"] == ["PA1", "PA3"]
    assert p["lat"] == [48.12346, 43.0]
    assert p["lon"] == [2.98765, 5.5]
    # Le statut nul survit au codage : il ne doit pas devenir « » ni un index faux.
    assert [p["statuts"][i] for i in p["statut"]] == ["classé", None]
    assert p["nb"] == [3, 250]
    assert p["siecle"] == [12, None]
    json.dumps(p)  # sérialisable tel quel


# --------------------------------------------------------------------------
# Intégration : artefacts vs ANALYSE_MERIMEE.md
# --------------------------------------------------------------------------

pytestmark_artifacts = pytest.mark.skipif(
    not (OUT_DIR / "monuments.parquet").exists(),
    reason="artefacts absents : lancer `python -m merimee_etl`",
)


@pytest.fixture(scope="module")
def monuments() -> pd.DataFrame:
    return pd.read_parquet(OUT_DIR / "monuments.parquet")


@pytest.fixture(scope="module")
def protections() -> pd.DataFrame:
    return pd.read_parquet(OUT_DIR / "protections.parquet")


@pytest.fixture(scope="module")
def details() -> pd.DataFrame:
    fragments = sorted((OUT_DIR / "details").glob("*.parquet"))
    return pd.concat([pd.read_parquet(f) for f in fragments], ignore_index=True)


@pytestmark_artifacts
def test_volumetrie(monuments):
    assert len(monuments) == 46_760
    assert monuments.reference.is_unique
    assert (monuments.reference != "").all()


@pytestmark_artifacts
def test_geolocalisation(monuments):
    assert monuments.lat.notna().sum() == 44_484
    assert monuments.lat.isna().sum() == 2_276
    assert not ((monuments.lat == 0) & (monuments.lon == 0)).any()


@pytest.mark.skipif(
    not (OUT_DIR / "points.json").exists() or not (OUT_DIR / "monuments.parquet").exists(),
    reason="points.json absent : relancer `python -m merimee_etl`",
)
def test_points_instantanes(monuments):
    """Le nuage du premier écran doit être celui que DuckDB rendra ensuite :
    sinon la carte change de points sous les yeux au remplacement."""
    p = json.loads((OUT_DIR / "points.json").read_text(encoding="utf-8"))
    geo = monuments[monuments.lat.notna()]
    assert p["total"] == 46_760
    assert p["geolocalises"] == len(p["reference"]) == 44_484
    assert p["reference"] == geo.reference.tolist()
    for cle in ("lon", "lat", "statut", "nb", "siecle"):
        assert len(p[cle]) == 44_484, cle
    assert set(p["statuts"]) >= {"classé", "inscrit", "classé+inscrit"}


@pytestmark_artifacts
def test_statuts(monuments):
    classes = monuments.statut.isin(["classé", "classé+inscrit"]).sum()
    inscrits = monuments.statut.isin(["inscrit", "classé+inscrit"]).sum()
    cumules = (monuments.statut == "classé+inscrit").sum()
    assert classes == 14_990
    assert cumules == 2_562
    # 33 883 dans l'analyse : une notice sans typologie explicite retrouve son
    # statut via ses actes datés.
    assert inscrits == 33_884
    # Le total dépasse le nombre de notices : ne jamais additionner naïvement.
    assert classes + inscrits > len(monuments)


@pytestmark_artifacts
def test_protections(protections):
    assert len(protections) == 51_640
    assert protections.annee.min() == 1840
    assert protections.annee.max() == 2026
    counts = protections.annee.value_counts()
    assert counts.loc[1926] == 2_093      # montée en charge de la loi de 1913
    assert counts.loc[1927] == 1_420
    decennies = (protections.annee // 10 * 10).value_counts()
    assert decennies.loc[1840] == 677     # première liste Mérimée
    assert decennies.loc[1920] == 7_952
    assert decennies.loc[1990] == 6_769


@pytestmark_artifacts
def test_protections_rattachees(monuments, protections):
    assert set(protections.reference) <= set(monuments.reference)
    multi = protections.reference.value_counts()
    assert (multi > 1).sum() == 4_215


@pytestmark_artifacts
def test_siecles(monuments):
    compte = collections.Counter()
    for liste in monuments.siecles:
        for siecle in liste:
            compte[int(siecle)] += 1
    # Comptes par notice, dédoublonnés : 22 notices répètent le même siècle.
    assert compte[16] == 9_023
    assert compte[18] == 8_782
    assert compte[20] == 3_035
    periodes = collections.Counter(p for liste in monuments.periodes for p in liste)
    assert periodes["Préhistoire"] == 1_823
    assert periodes["Moyen Age"] == 857


@pytestmark_artifacts
def test_domaines(monuments):
    compte = collections.Counter(d for liste in monuments.domaines for d in liste)
    assert compte["architecture domestique"] == 19_154
    assert compte["architecture religieuse"] == 15_567
    assert compte["architecture militaire"] == 1_688
    # Les variantes orthographiques ont été fusionnées.
    assert "architecture de commerce" not in compte


@pytestmark_artifacts
def test_auteurs(monuments):
    avec_auteur = (monuments.auteurs.str.len() > 0).sum()
    assert avec_auteur == 6_311
    noms = {a for liste in monuments.auteurs for a in liste}
    fantomes = {"ou", "dit", "et", "architecte", "(architecte)", "marquis"}
    assert not {n.lower() for n in noms} & fantomes
    compte = collections.Counter(a for liste in monuments.auteurs for a in liste)
    assert compte["Guimard Hector"] == 86      # 50 + 34 + 2 variantes de casse
    assert compte["Le Corbusier"] == 58        # 3 graphies + Jeanneret Charles-Edouard


@pytestmark_artifacts
def test_palissy(monuments):
    assert monuments.nb_palissy.sum() == 126_597
    assert monuments.nb_palissy.max() == 2_225
    assert (monuments.nb_palissy > 0).sum() == 9_997


@pytestmark_artifacts
def test_notice_avec_pipe_litteral(monuments, details):
    # Ligne 45639 du CSV : un pipe à l'intérieur d'un champ quoté.
    notice = monuments.loc[monuments.reference == "PA31000132"]
    assert len(notice) == 1
    assert notice.iloc[0].commune == "Toulouse"
    assert notice.iloc[0].departement_nom == "Haute-Garonne"
    assert len(details.loc[details.reference == "PA31000132"]) == 1


@pytestmark_artifacts
def test_details_fragmentes(details, monuments):
    # duckdb-wasm télécharge tout fichier Parquet en entier : la fiche d'une
    # notice ne doit donc dépendre que d'un fragment léger.
    fragments = sorted((OUT_DIR / "details").glob("*.parquet"))
    assert len(fragments) == DETAILS_SHARDS
    assert set(details.reference) == set(monuments.reference)
    assert max(f.stat().st_size for f in fragments) < 600_000


@pytestmark_artifacts
def test_chaque_notice_est_dans_son_fragment():
    # Le client déduit le fragment par hachage, sans index : un décalage entre
    # les deux implémentations rendrait des fiches introuvables.
    for numero in range(DETAILS_SHARDS):
        contenu = pd.read_parquet(OUT_DIR / "details" / f"{numero}.parquet")
        assert (contenu.reference.map(shard_of) == numero).all()


def test_hachage_stable():
    # Valeurs de reference partagees avec `web/src/lib/db/shards.ts`.
    assert fnv1a("PA00078066") % 32 == 19
    assert fnv1a("PA31000132") % 32 == 28
    assert fnv1a("PA00116859") % 32 == 8


@pytestmark_artifacts
def test_geographie(monuments):
    assert monuments.region.nunique() == 20
    # `departement` (le code numérique) est une colonne retirée des artefacts
    # (jamais lue côté navigateur) ; `departement_nom` reste et porte le même
    # dénombrement.
    assert monuments.departement_nom.nunique() == 102
    assert monuments.commune.nunique() >= 16_000
    assert monuments.search_key.str.contains("é").sum() == 0  # accents dépliés


# --------------------------------------------------------------------------
# Photographies Wikimedia : instantané facultatif
# --------------------------------------------------------------------------


@pytestmark_artifacts
def test_colonne_commons_presente(details):
    # La colonne existe dans tous les cas : c'est l'instantané Wikidata qui est
    # facultatif, pas le schéma. Une colonne absente ferait échouer la requête
    # de la fiche côté navigateur.
    assert "commons" in details.columns
    assert details.commons.map(lambda v: v is not None).all()


@pytestmark_artifacts
def test_couverture_photographique(details):
    # Instantané du 2026-09-05 : 39 556 notices illustrées sur 46 760, soit
    # 84,6 %. Le chiffre bouge à chaque rafraîchissement de la base tierce, la
    # borne basse suffit donc à détecter une jointure cassée.
    illustrees = details.commons.map(len).gt(0).sum()
    if illustrees == 0:
        pytest.skip("instantané `data/ref/wikidata_images.csv` absent")
    assert illustrees > 30_000
    # Trois images au maximum par notice, cf. `wikidata.MAX_IMAGES`.
    assert details.commons.map(len).max() <= 3


def test_images_absentes_ne_cassent_pas_le_build(tmp_path, monkeypatch):
    """Sans instantané, la colonne vaut la liste vide et rien ne lève.

    C'est ce qui permet au pipeline de tourner hors-ligne, et aux tests de ne
    dépendre d'aucun réseau.
    """
    from merimee_etl import build

    build._images_commons.cache_clear()
    monkeypatch.setattr(build, "REF_DIR", tmp_path)
    try:
        assert build._images_commons() == {}
    finally:
        build._images_commons.cache_clear()


@pytestmark_artifacts
def test_colonne_memoire_presente(details):
    # Un entier, jamais nul : la fiche l'affiche sans le tester. Comme pour
    # `commons`, c'est l'instantané qui est facultatif, pas la colonne.
    assert "memoire" in details.columns
    assert (details.memoire >= 0).all()


@pytestmark_artifacts
def test_renvoi_memoire_comble_les_fiches_sans_photo(details):
    """Le renvoi POP porte sur les notices que Wikimedia laisse vides.

    Mesuré au 2026-09-06 : 6 692 notices sans fichier Commons, dont **4 861
    illustrées dans Mémoire** — 72,6 %, et 45 122 photographies. C'est ce qui
    fait passer la couverture de la fiche (photographie ou renvoi) de 85,7 %
    à 96,1 %. Les chiffres bougent avec les bases tierces, la borne basse
    suffit à détecter une jointure cassée.
    """
    sans_photo = details[details.commons.map(len) == 0]
    if details.memoire.sum() == 0:
        pytest.skip("instantané `data/ref/memoire_illustrations.csv` absent")
    assert sans_photo.memoire.gt(0).sum() > 4_000


def test_compte_memoire_par_notice_et_non_par_ligne():
    """Une ligne Mémoire peut citer plusieurs notices, ou aucune image.

    Quatre pièges dans le même échantillon : la ligne sans fichier ne compte
    pas, la ligne qui cite deux notices compte pour chacune, la référence
    hors corpus est ignorée — le fichier couvre aussi Palissy — et une
    référence répétée dans la même ligne ne compte qu'une fois.
    """
    from merimee_etl.memoire import compter

    lignes = [
        "References_Palissy_Merimee_lien_notice_en_cours|Lien_vers_l_image|Copyright|Droits_de_diffusion",
        "PA00000001|memoire/A/a.jpg|(c) MPP|",
        "PA00000001;PA00000002|memoire/B/b.jpg|(c) MPP|",
        "PA00000002||(c) MPP|",  # notice documentaire, aucun fichier
        "PM87000711|memoire/C/c.jpg|(c) MPP|",  # Palissy, hors corpus
        "PA00000002;PA00000002|memoire/D/d.jpg||reproduction interdite",
    ]
    par_notice, droits, lues = compter(lignes, {"PA00000001", "PA00000002"})

    assert lues == 5
    assert dict(par_notice) == {"PA00000001": 2, "PA00000002": 2}
    # La mention retenue est `Copyright` ; `Droits_de_diffusion` ne prend le
    # relais que sur les lignes où elle est vide.
    assert droits["(c) MPP"] == 2
    assert droits["reproduction interdite"] == 1


def test_compte_memoire_absent_ne_casse_pas_le_build(tmp_path, monkeypatch):
    """Sans instantané, le compte vaut zéro et la fiche n'affiche rien."""
    from merimee_etl import build

    build._illustrations_memoire.cache_clear()
    monkeypatch.setattr(build, "REF_DIR", tmp_path)
    try:
        assert build._illustrations_memoire() == {}
    finally:
        build._illustrations_memoire.cache_clear()


def test_memoire_coupure_en_plein_flux_meme_message_qu_une_panne_reseau(monkeypatch, capsys):
    """`IncompleteRead` hérite d'`HTTPException`, pas d'`OSError`.

    Un `except OSError` seul laissait filer cette exception-là : une coupure
    en cours de lecture des 1,36 Go plantait avec une trace Python au lieu du
    message `source injoignable` que rendent les autres pannes réseau.
    """
    import http.client

    from merimee_etl import memoire

    class FluxCoupe:
        def __enter__(self):
            raise http.client.IncompleteRead(b"")

        def __exit__(self, *exc):
            return False

    monkeypatch.setattr(memoire, "references_du_corpus", lambda artefacts: {"PA00000000"})
    monkeypatch.setattr(memoire, "_lignes_distantes", lambda: FluxCoupe())

    assert memoire.main([]) == 1
    assert "source injoignable" in capsys.readouterr().err


# --------------------------------------------------------------------------
# Index plein texte
# --------------------------------------------------------------------------

pytestmark_index = pytest.mark.skipif(
    not (OUT_DIR / "texte" / "postings.parquet").exists(),
    reason="index plein texte absent : extension `fts` indisponible",
)


@pytest.fixture(scope="module")
def lexique() -> pd.DataFrame:
    return pd.read_parquet(OUT_DIR / "texte" / "lexique.parquet")


@pytest.fixture(scope="module")
def postings() -> pd.DataFrame:
    return pd.read_parquet(OUT_DIR / "texte" / "postings.parquet")


@pytestmark_index
def test_index_couvre_exactement_les_historiques(details):
    docs = pd.read_parquet(OUT_DIR / "texte" / "docs.parquet")
    attendu = details.historique.fillna("").str.len().gt(0).sum()
    assert len(docs) == attendu
    assert docs.reference.is_unique


@pytestmark_index
def test_lexique_replie_les_flexions(lexique):
    formes = dict(zip(lexique.forme, lexique.terme))
    # C'est ce qui dispense le navigateur d'embarquer un stemmer : singulier et
    # pluriel désignent le même terme.
    assert formes["mascaron"] == formes["mascarons"]
    assert formes["retable"] == formes["retables"]
    assert "jube" in formes


@pytestmark_index
def test_postings_comptent_les_notices_attendues(lexique, postings, details):
    """L'oracle est le corpus lui-même, pas l'index.

    34 notices citent « jubé » dans leur historique — la 35e le cite dans
    `precision_protection`, qui n'est pas indexé.
    """
    terme = dict(zip(lexique.forme, lexique.terme))["jube"]
    indexees = postings.loc[postings.terme == terme, "doc"].nunique()
    reelles = (
        details.historique.fillna("")
        .str.normalize("NFD")
        .str.encode("ascii", "ignore")
        .str.decode("ascii")
        .str.lower()
        .str.contains("jube")
        .sum()
    )
    assert indexees == reelles == 34


@pytestmark_index
def test_postings_tries_par_terme(postings):
    # Le tri conditionne l'élagage par statistiques Parquet côté navigateur :
    # sans lui, chaque recherche balaierait 1,6 M de lignes.
    assert postings.terme.is_monotonic_increasing


def test_index_absent_ne_casse_pas_le_pipeline(tmp_path):
    """Sans fragments `details`, la construction rend `None` sans lever.

    Même contrat que l'instantané Wikidata : une dépendance externe absente
    laisse le pipeline valide, elle ne l'interrompt pas.
    """
    from merimee_etl import texte

    assert texte.construire(tmp_path) is None
