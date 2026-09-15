"""Tests des fonctions pures des scripts annexes (instantanés photo, alias).

Ces modules (`wikidata.py`, `commons.py`, `memoire.py`) parlent au réseau,
mais chacun isole sa logique de décision dans une fonction pure : c'est elle
qu'on teste ici, sans aucun appel réseau. `_alias_key` (`parse.py`) est du
pipeline principal, mais partage la même nature — une fonction de
normalisation sans effet de bord.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from merimee_etl.commons import photographie  # noqa: E402
from merimee_etl.config import MAX_IMAGES  # noqa: E402
from merimee_etl.parse import _alias_key  # noqa: E402
from merimee_etl.wikidata import restreindre  # noqa: E402

# --------------------------------------------------------------------------
# wikidata.restreindre
# --------------------------------------------------------------------------


def test_restreindre_ecarte_les_references_hors_corpus():
    couples = [("PA00000001", "a.jpg"), ("PM87000711", "b.jpg")]
    lignes = restreindre(couples, {"PA00000001"})
    assert lignes == [{"reference": "PA00000001", "fichier": "a.jpg"}]


def test_restreindre_deduplique_et_plafonne_a_max_images():
    # Cinq fichiers distincts pour une seule notice, dont un doublon : au plus
    # `MAX_IMAGES` doivent survivre, dans l'ordre alphabétique — c'est ce qui
    # rend le fichier stable d'un rafraîchissement à l'autre.
    couples = [
        ("PA00000001", "e.jpg"),
        ("PA00000001", "c.jpg"),
        ("PA00000001", "a.jpg"),
        ("PA00000001", "a.jpg"),  # doublon exact
        ("PA00000001", "d.jpg"),
        ("PA00000001", "b.jpg"),
    ]
    lignes = restreindre(couples, {"PA00000001"})
    assert len(lignes) == MAX_IMAGES == 3
    assert [l["fichier"] for l in lignes] == ["a.jpg", "b.jpg", "c.jpg"]


def test_restreindre_trie_par_reference():
    couples = [("PA00000002", "z.jpg"), ("PA00000001", "a.jpg")]
    lignes = restreindre(couples, {"PA00000001", "PA00000002"})
    assert [l["reference"] for l in lignes] == ["PA00000001", "PA00000002"]


def test_restreindre_sans_couples_rend_liste_vide():
    assert restreindre([], {"PA00000001"}) == []


# --------------------------------------------------------------------------
# commons.photographie
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "nom,attendu",
    [
        ("Chateau_de_Vaux.jpg", True),
        ("Facade_nord.JPEG", True),          # extension en capitales
        ("Plan_de_coupe.png", True),
        ("Tour_beffroi.tiff", True),
        ("Tour_beffroi.tif", True),
        ("Location_map_France.png", False),           # carte de localisation
        ("France_map.jpg", False),                     # `_map` en fin de nom
        ("Carte_postale_ancienne.jpg", False),         # `carte`
        ("Blason_ville_de_Metz.jpg", False),           # blason
        ("Logo_Ville_de_Paris.png", False),            # logo
        ("Edifice_MH_disparu.jpg", False),             # MH disparu
        ("Pictogramme_monument.png", False),           # picto
        ("Flag_of_France.jpg", False),                 # flag
        ("Coat_of_arms_city.png", False),               # coat (blason en anglais)
        ("Blason_ville_de_Metz.svg", False),           # pas une extension raster
        ("Notice_sans_extension", False),
    ],
)
def test_photographie(nom, attendu):
    assert photographie(nom) is attendu


# --------------------------------------------------------------------------
# parse._alias_key
# --------------------------------------------------------------------------


def test_alias_key_insensible_a_l_inversion_par_virgule():
    assert _alias_key("Guimard, Hector") == _alias_key("Guimard Hector")


def test_alias_key_replie_accents_et_casse():
    assert _alias_key("VAUBAN") == _alias_key("Vauban") == "vauban"


def test_alias_key_neutralise_la_ponctuation():
    # Les points et virgules ne doivent pas faire deux clés pour la même
    # personne, et les espaces multiples qui en résultent sont normalisés.
    assert _alias_key("Vauban, Sébastien.") == "vauban sebastien"
    assert _alias_key("Vauban Sébastien") == "vauban sebastien"
