"""Assemblage des tables et écriture des artefacts Parquet."""

from __future__ import annotations

import csv
import gzip
import json
from collections import defaultdict
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from .config import COMPRESSION, DETAILS_ROW_GROUP, DETAILS_SHARDS, MAX_IMAGES, REF_DIR
from .normalize import normalize_text, normalize_vocab, search_key, split_multi, split_vocab
from .parse import (classify_statut, merge_auteurs, palissy_ids, parse_auteurs,
                    parse_coords, parse_links, parse_protections, parse_siecles)

_STR = pa.string()
_LIST_STR = pa.list_(pa.string())

# `cog`, `annee_premiere_protection`, `annee_derniere_protection`, `siecle_min`,
# `techniques_decor`, `zones_protection`, `nb_protections`, `departement` et
# `typologie_dossier` ont été retirées : jamais lues côté navigateur (grep sur
# `web/src`, `SELECT *` compris — DuckDB-wasm télécharge le Parquet en entier,
# donc les colonnes non lues restent des octets payés pour rien à chaque
# premier écran). `departement_nom` reste : la facette l'affiche, pas le code
# numérique. Retirer une colonne ici ne change aucun chiffre de l'oracle,
# seulement le poids du fichier.
MONUMENTS_SCHEMA = pa.schema([
    ("reference", _STR),
    ("titre", _STR),
    ("commune", _STR),
    ("departement_nom", _STR),
    ("region", _STR),
    ("lat", pa.float32()),
    ("lon", pa.float32()),
    ("statut", _STR),
    ("partiel", pa.bool_()),
    ("nature_acte", _STR),
    ("siecle_max", pa.int8()),
    ("siecles", pa.list_(pa.int8())),
    ("periodes", _LIST_STR),
    ("domaines", _LIST_STR),
    ("denominations", _LIST_STR),
    ("auteurs", _LIST_STR),
    ("proprietaires", _LIST_STR),
    ("nb_palissy", pa.int32()),
    ("has_historique", pa.bool_()),
    ("search_key", _STR),
])

# `statut` et `partiel` sont déjà sur `monuments` (le seul lu par les requêtes
# de facette et de détail) : la fiche assemble ses actes via `m.statut` /
# `m.partiel`, jamais via `protections.statut` — cf. `queries.ts::detail`.
PROTECTIONS_SCHEMA = pa.schema([
    ("reference", _STR),
    ("annee", pa.int16()),
    ("mois", pa.int8()),
    ("jour", pa.int8()),
    ("libelle", _STR),
])

DETAILS_SCHEMA = pa.schema([
    ("reference", _STR),
    ("adresse", _STR),
    ("lieudit", _STR),
    ("cadastre", _STR),
    ("historique", _STR),
    ("precision_protection", _STR),
    ("observations", _STR),
    ("siecle_detail", _STR),
    ("auteurs_detail", _LIST_STR),
    ("archiv_mh", _STR),
    ("liens_externes", _LIST_STR),
    ("palissy", _LIST_STR),
    ("renvois", _LIST_STR),
    ("commons", _LIST_STR),
    # Un nombre, pas des fichiers : les illustrations Mémoire sont sous droits
    # réservés, la fiche n'en fait qu'un renvoi vers POP. Cf. `memoire.py`.
    ("memoire", pa.int32()),
])


# Deux instantanés, deux provenances, dans cet ordre. Wikidata relie l'image à
# la notice par une propriété (`P380` -> `P18`) ; Commons ne fait que constater
# qu'un fichier cite la référence. Le premier passe donc devant le second.
_INSTANTANES = ("wikidata_images.csv", "commons_images.csv")


@lru_cache(maxsize=1)
def _images_commons() -> dict[str, list[str]]:
    """Noms de fichiers Wikimedia Commons, par notice.

    Les instantanés sont produits à part (`python -m merimee_etl.wikidata`, puis
    `python -m merimee_etl.commons`) : le pipeline ne va jamais sur le réseau.
    Absents, la colonne vaut la liste vide partout et les artefacts restent
    valides — c'est ce qui permet aux tests de tourner hors-ligne.
    """
    images: dict[str, list[str]] = defaultdict(list)
    for nom in _INSTANTANES:
        path = Path(REF_DIR) / nom
        if not path.exists():
            continue
        with path.open(encoding="utf-8", newline="") as fh:
            # Les lignes de tête expliquent la provenance du fichier : elles ne
            # sont pas des données.
            lignes = (ligne for ligne in fh if not ligne.startswith("#"))
            for row in csv.DictReader(lignes):
                fichiers = images[row["reference"]]
                # Le plafond vaut pour la notice, pas pour la source : deux
                # instantanés ne doivent pas faire six vignettes.
                if row["fichier"] not in fichiers and len(fichiers) < MAX_IMAGES:
                    fichiers.append(row["fichier"])
    return images


@lru_cache(maxsize=1)
def _illustrations_memoire() -> dict[str, int]:
    """Nombre d'illustrations POP par notice.

    Même contrat que les instantanés photo : produit à part par
    `python -m merimee_etl.memoire`, absent le compte vaut zéro partout et les
    artefacts restent valides. La fiche n'affiche alors simplement rien.
    """
    chemin = Path(REF_DIR) / "memoire_illustrations.csv"
    if not chemin.exists():
        return {}
    with chemin.open(encoding="utf-8", newline="") as fh:
        lignes = (ligne for ligne in fh if not ligne.startswith("#"))
        return {row["reference"]: int(row["images"]) for row in csv.DictReader(lignes)}


@dataclass(slots=True)
class BuildReport:
    notices: int = 0
    geolocalisees: int = 0
    protections: int = 0
    rejets: int = 0
    palissy_liens: int = 0

    def as_lines(self) -> list[str]:
        return [
            f"notices              : {self.notices:>7,}".replace(",", " "),
            f"geolocalisees        : {self.geolocalisees:>7,}".replace(",", " "),
            f"actes de protection  : {self.protections:>7,}".replace(",", " "),
            f"segments hors-format : {self.rejets:>7,}".replace(",", " "),
            f"liens Palissy        : {self.palissy_liens:>7,}".replace(",", " "),
        ]


def _first(value: str) -> str:
    """Premier segment d'un champ censé être simple.

    Deux notices portent deux départements (`01;71`, `12;81`) et une notice
    deux régions : on retient le premier plutôt que de transformer tous les
    filtres administratifs en listes pour trois cas.
    """
    parts = split_multi(value)
    return parts[0] if parts else ""


def transform(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, list[dict], BuildReport]:
    """Ligne à ligne : le coût est négligeable à 46 760 notices, la lisibilité prime."""
    report = BuildReport(notices=len(df))
    monuments: list[dict] = []
    protections: list[dict] = []
    details: list[dict] = []
    rejets: list[dict] = []

    for row in df.itertuples(index=False):
        ref = row.Reference.strip()
        lat, lon = parse_coords(row.coordonnees_au_format_WGS84)
        siecles, periodes, siecles_bad = parse_siecles(
            row.Format_abrege_du_siecle_de_construction)
        for segment in siecles_bad:
            rejets.append({"reference": ref, "champ": "Format_abrege_du_siecle_de_construction",
                           "segment": segment})
        statut, partiel = classify_statut(row.Typologie_de_la_protection)

        events, bad = parse_protections(ref, row.Date_et_typologie_de_la_protection)
        for segment in bad:
            rejets.append({"reference": ref, "champ": "Date_et_typologie_de_la_protection",
                           "segment": segment})
        for e in events:
            protections.append({
                "reference": e.reference, "annee": e.annee, "mois": e.mois,
                "jour": e.jour, "libelle": e.libelle,
            })

        # La typologie de protection est parfois absente (448 notices) alors
        # que les actes datés existent : on retombe sur eux.
        if statut in {"inconnu", "autre"} and events:
            statuts = {e.statut for e in events}
            if {"classé", "inscrit"} <= statuts:
                statut = "classé+inscrit"
            elif "classé" in statuts:
                statut = "classé"
            elif "inscrit" in statuts:
                statut = "inscrit"

        palissy = palissy_ids(row.Lien_vers_la_base_Palissy)
        titre = normalize_text(row.Titre_editorial_de_la_notice)
        commune = normalize_text(row.Commune_forme_editoriale)
        historique = normalize_text(row.Historique)

        if lat is not None:
            report.geolocalisees += 1
        report.palissy_liens += len(palissy)

        monuments.append({
            "reference": ref,
            "titre": titre,
            "commune": commune,
            "departement_nom": _first(row.Departement_en_lettres),
            "region": _first(row.Region),
            "lat": lat,
            "lon": lon,
            "statut": statut,
            "partiel": partiel,
            "nature_acte": normalize_vocab("Nature_de_la_protection",
                                           _first(row.Nature_de_la_protection)),
            "siecle_max": siecles[-1] if siecles else None,
            "siecles": siecles,
            "periodes": periodes,
            "domaines": split_vocab("Domaine", row.Domaine),
            "denominations": split_vocab("Denomination_de_l_edifice",
                                         row.Denomination_de_l_edifice),
            "auteurs": parse_auteurs(row.Auteur_de_l_edifice),
            "proprietaires": split_vocab("Statut_juridique_de_l_edifice",
                                         row.Statut_juridique_de_l_edifice),
            "nb_palissy": len(palissy),
            "has_historique": bool(historique),
            "search_key": search_key(titre, commune,
                                     normalize_text(row.Departement_en_lettres)),
        })

        details.append({
            "reference": ref,
            "adresse": normalize_text(row.Adresse_forme_editoriale),
            "lieudit": normalize_text(row.Lieudit),
            "cadastre": normalize_text(row.Cadastre),
            "historique": historique,
            "precision_protection": normalize_text(row.Precision_de_la_protection),
            "observations": normalize_text(row.Observations),
            "siecle_detail": normalize_text(
                row.Siecle_de_la_campagne_principale_de_construction),
            # Mentions completes, role compris : `monuments.auteurs` ne
            # conserve que l'identite pour rester facettable.
            "auteurs_detail": merge_auteurs(row.Auteur_de_l_edifice),
            "archiv_mh": row.Lien_vers_la_base_Archiv_MH.strip(),
            "liens_externes": parse_links(row.Liens_externes),
            "palissy": palissy,
            "renvois": split_multi(row.Renvoi_vers_une_notice_de_la_base_Merimee_ou_Palissy),
            "commons": _images_commons().get(ref, []),
            "memoire": _illustrations_memoire().get(ref, 0),
        })

    report.protections = len(protections)
    report.rejets = len(rejets)

    monuments_df = pd.DataFrame(monuments).sort_values("reference", ignore_index=True)
    protections_df = pd.DataFrame(protections)
    # `details` est interrogé notice par notice via HTTP Range : le tri par
    # référence rend les statistiques min/max des row groups discriminantes.
    details_df = pd.DataFrame(details).sort_values("reference", ignore_index=True)
    return monuments_df, protections_df, details_df, rejets, report


def fnv1a(texte: str) -> int:
    """FNV-1a 32 bits.

    Le meme calcul est reproduit dans `web/src/lib/db/shards.ts` : le client
    doit deduire le fragment d'une reference sans telecharger d'index.
    """
    h = 0x811C9DC5
    for octet in texte.encode("utf-8"):
        h ^= octet
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def shard_of(reference: str) -> int:
    return fnv1a(reference) % DETAILS_SHARDS


def _write(df: pd.DataFrame, schema: pa.Schema, path: Path, row_group: int | None = None) -> int:
    table = pa.Table.from_pandas(df, schema=schema, preserve_index=False)
    kwargs = {"compression": COMPRESSION, "write_statistics": True}
    if row_group:
        kwargs["row_group_size"] = row_group
    pq.write_table(table, path, **kwargs)
    return path.stat().st_size


def points_colonnaires(monuments: pd.DataFrame) -> dict:
    """Nuage de points du premier écran, en colonnes.

    Le navigateur ne peut rien afficher tant que DuckDB-Wasm n'a pas été
    téléchargé puis compilé — plusieurs secondes sur un téléphone — alors que
    le premier écran, sans filtre, n'a besoin d'aucun moteur SQL. Ce fichier
    le sert tout de suite ; la première réponse de DuckDB le remplace.

    **JSON et non binaire** : GitHub Pages compresse `application/json`, pas un
    `.bin`. Colonnes et non entités GeoJSON : les clés ne sont pas répétées
    44 484 fois. Coordonnées à 5 décimales, soit environ un mètre — le Parquet
    les stocke en `float32`, qui n'en porte guère plus. Le statut est un index
    dans une table portée par le fichier : quatre libellés, pas 44 484.

    Mêmes lignes que `monuments WHERE lat IS NOT NULL`, dans le même ordre :
    `test_points_instantanes` le vérifie sur les artefacts.
    """
    geo = monuments[monuments.lat.notna()]
    valeurs = [s if isinstance(s, str) else None for s in geo.statut]
    connus = sorted({s for s in valeurs if s is not None})
    statuts: list[str | None] = connus + ([None] if None in valeurs else [])
    index = {s: i for i, s in enumerate(statuts)}
    return {
        "total": int(len(monuments)),
        "geolocalises": int(len(geo)),
        "statuts": statuts,
        "reference": geo.reference.tolist(),
        "lon": [round(float(v), 5) for v in geo.lon],
        "lat": [round(float(v), 5) for v in geo.lat],
        "statut": [index[s] for s in valeurs],
        "nb": [int(v) if pd.notna(v) else 0 for v in geo.nb_palissy],
        "siecle": [int(v) if pd.notna(v) else None for v in geo.siecle_max],
    }


def write_artifacts(
    monuments: pd.DataFrame,
    protections: pd.DataFrame,
    details: pd.DataFrame,
    out_dir: Path,
) -> dict[str, int]:
    out_dir.mkdir(parents=True, exist_ok=True)
    tailles = {
        "monuments.parquet": _write(monuments, MONUMENTS_SCHEMA,
                                    out_dir / "monuments.parquet"),
        "protections.parquet": _write(protections, PROTECTIONS_SCHEMA,
                                      out_dir / "protections.parquet"),
    }

    nuage = json.dumps(points_colonnaires(monuments), ensure_ascii=False,
                       separators=(",", ":")).encode("utf-8")
    (out_dir / "points.json").write_bytes(nuage)
    tailles["points.json"] = len(nuage)
    # Le poids qui compte est celui du transfert : Pages sert ce fichier gzippé.
    tailles["points.json (gzip)"] = len(gzip.compress(nuage, compresslevel=6))

    # Les fiches sont consultees une par une : un fichier unique de 9,5 Mo
    # serait rapatrie en entier au premier clic.
    dossier = out_dir / "details"
    dossier.mkdir(exist_ok=True)
    for ancien in dossier.glob("*.parquet"):
        ancien.unlink()
    fragments = details.assign(_shard=details.reference.map(shard_of))
    total = 0
    for numero, groupe in fragments.groupby("_shard", sort=True):
        total += _write(groupe.drop(columns="_shard").reset_index(drop=True),
                        DETAILS_SCHEMA, dossier / f"{numero}.parquet", DETAILS_ROW_GROUP)
    tailles[f"details/*.parquet ({DETAILS_SHARDS})"] = total
    return tailles
