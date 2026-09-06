"""Chemins, colonnes retenues et constantes du pipeline."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW_CSV = ROOT / "data" / "raw" / "merimee.csv"
REF_DIR = ROOT / "data" / "ref"
OUT_DIR = ROOT / "web" / "static" / "data"
REPORT_DIR = ROOT / "etl" / "out"

SEP = "|"
EXPECTED_ROWS = 46_760
EXPECTED_COLS = 78

# Colonnes du CSV effectivement lues. Tout le reste est écarté :
# `Producteur` est vide, `Copyright` est du boilerplate juridique répété
# (29 % du volume), et 28 colonnes sont remplies à moins de 1 %.
KEEP_COLS = [
    "Reference",
    "Titre_editorial_de_la_notice",
    "Commune_forme_editoriale",
    "COG_Insee_lors_de_la_protection",
    "Departement_format_numerique",
    "Departement_en_lettres",
    "Region",
    "coordonnees_au_format_WGS84",
    "Domaine",
    "Denomination_de_l_edifice",
    "Format_abrege_du_siecle_de_construction",
    "Siecle_de_la_campagne_principale_de_construction",
    "Typologie_de_la_protection",
    "Date_et_typologie_de_la_protection",
    "Nature_de_la_protection",
    "Statut_juridique_de_l_edifice",
    "Auteur_de_l_edifice",
    "Typologie_du_dossier",
    "Typologie_de_la_zone_de_protection",
    "Technique_du_decor_porte_de_l_edifice",
    "Adresse_forme_editoriale",
    "Lieudit",
    "Cadastre",
    "Historique",
    "Precision_de_la_protection",
    "Observations",
    "Liens_externes",
    "Lien_vers_la_base_Palissy",
    "Lien_vers_la_base_Archiv_MH",
    "Renvoi_vers_une_notice_de_la_base_Merimee_ou_Palissy",
    "Cadre_de_l_etude",
]

# Périodes non numériques de `Format_abrege_du_siecle_de_construction`,
# indexées sur leur forme sans accent et en minuscules.
PERIODES = {
    "prehistoire": "Préhistoire",
    "protohistoire": "Protohistoire",
    "antiquite": "Antiquité",
    "antiquite (?)": "Antiquité",
    "moyen age": "Moyen Age",
    "temps modernes": "Temps Modernes",
}

# Bornes de validité des coordonnées : métropole + outre-mer
# (La Réunion, Antilles, Guyane, Mayotte, Saint-Pierre-et-Miquelon).
LAT_RANGE = (-25.0, 52.0)
LON_RANGE = (-64.0, 57.0)

PROTECTION_YEAR_MIN = 1840
PROTECTION_YEAR_MAX = 2030

# `details` est eclate en fragments : duckdb-wasm telecharge tout fichier
# Parquet en entier (aucune lecture par plage d'octets, verifie en navigateur),
# donc la seule granularite de chargement disponible est le fichier lui-meme.
# 32 fragments d'environ 1 460 notices pesent ~300 Ko chacun.
DETAILS_SHARDS = 32
DETAILS_ROW_GROUP = 2_000
COMPRESSION = "zstd"

# Trois vignettes suffisent à une bande d'aperçu. Une notice en porte parfois
# une douzaine, dont les vues de détail : les garder toutes gonflerait les
# fragments sans rien apporter à la lecture. Le plafond vaut pour la notice, pas
# pour la source — deux instantanés ne doivent pas faire six vignettes.
MAX_IMAGES = 3

# L'index plein texte est trié par terme : des groupes de lignes de cette taille
# donnent aux statistiques Parquet de quoi écarter tout ce qui ne concerne pas
# les termes cherchés, et évitent au navigateur de matérialiser 1,6 M de lignes.
TEXTE_ROW_GROUP = 100_000
