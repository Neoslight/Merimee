"""Assemblage des tables et écriture des artefacts Parquet."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from .config import COMPRESSION, DETAILS_ROW_GROUP, DETAILS_SHARDS
from .normalize import normalize_text, normalize_vocab, search_key, split_multi, split_vocab
from .parse import (classify_statut, merge_auteurs, palissy_ids, parse_auteurs,
                    parse_coords, parse_links, parse_protections, parse_siecles)

_STR = pa.string()
_LIST_STR = pa.list_(pa.string())

MONUMENTS_SCHEMA = pa.schema([
    ("reference", _STR),
    ("titre", _STR),
    ("commune", _STR),
    ("cog", _STR),
    ("departement", _STR),
    ("departement_nom", _STR),
    ("region", _STR),
    ("lat", pa.float32()),
    ("lon", pa.float32()),
    ("statut", _STR),
    ("partiel", pa.bool_()),
    ("nature_acte", _STR),
    ("typologie_dossier", _STR),
    ("annee_premiere_protection", pa.int16()),
    ("annee_derniere_protection", pa.int16()),
    ("nb_protections", pa.int16()),
    ("siecle_min", pa.int8()),
    ("siecle_max", pa.int8()),
    ("siecles", pa.list_(pa.int8())),
    ("periodes", _LIST_STR),
    ("domaines", _LIST_STR),
    ("denominations", _LIST_STR),
    ("auteurs", _LIST_STR),
    ("proprietaires", _LIST_STR),
    ("zones_protection", _LIST_STR),
    ("techniques_decor", _LIST_STR),
    ("nb_palissy", pa.int32()),
    ("has_historique", pa.bool_()),
    ("search_key", _STR),
])

PROTECTIONS_SCHEMA = pa.schema([
    ("reference", _STR),
    ("annee", pa.int16()),
    ("mois", pa.int8()),
    ("jour", pa.int8()),
    ("libelle", _STR),
    ("statut", _STR),
    ("partiel", pa.bool_()),
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
    ("cadre_etude", _STR),
    ("archiv_mh", _STR),
    ("liens_externes", _LIST_STR),
    ("palissy", _LIST_STR),
    ("renvois", _LIST_STR),
])


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
        siecles, periodes = parse_siecles(row.Format_abrege_du_siecle_de_construction)
        statut, partiel = classify_statut(row.Typologie_de_la_protection)

        events, bad = parse_protections(ref, row.Date_et_typologie_de_la_protection)
        for segment in bad:
            rejets.append({"reference": ref, "champ": "Date_et_typologie_de_la_protection",
                           "segment": segment})
        annees = [e.annee for e in events if e.annee is not None]
        for e in events:
            protections.append({
                "reference": e.reference, "annee": e.annee, "mois": e.mois,
                "jour": e.jour, "libelle": e.libelle, "statut": e.statut,
                "partiel": e.partiel,
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
            "cog": _first(row.COG_Insee_lors_de_la_protection),
            "departement": _first(row.Departement_format_numerique),
            "departement_nom": _first(row.Departement_en_lettres),
            "region": _first(row.Region),
            "lat": lat,
            "lon": lon,
            "statut": statut,
            "partiel": partiel,
            "nature_acte": normalize_vocab("Nature_de_la_protection",
                                           _first(row.Nature_de_la_protection)),
            "typologie_dossier": normalize_vocab("Typologie_du_dossier",
                                                 _first(row.Typologie_du_dossier)),
            "annee_premiere_protection": min(annees) if annees else None,
            "annee_derniere_protection": max(annees) if annees else None,
            "nb_protections": len(events),
            "siecle_min": siecles[0] if siecles else None,
            "siecle_max": siecles[-1] if siecles else None,
            "siecles": siecles,
            "periodes": periodes,
            "domaines": split_vocab("Domaine", row.Domaine),
            "denominations": split_vocab("Denomination_de_l_edifice",
                                         row.Denomination_de_l_edifice),
            "auteurs": parse_auteurs(row.Auteur_de_l_edifice),
            "proprietaires": split_vocab("Statut_juridique_de_l_edifice",
                                         row.Statut_juridique_de_l_edifice),
            "zones_protection": split_vocab("Typologie_de_la_zone_de_protection",
                                            row.Typologie_de_la_zone_de_protection),
            "techniques_decor": split_vocab("Technique_du_decor_porte_de_l_edifice",
                                            row.Technique_du_decor_porte_de_l_edifice),
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
            "cadre_etude": normalize_text(row.Cadre_de_l_etude),
            "archiv_mh": row.Lien_vers_la_base_Archiv_MH.strip(),
            "liens_externes": parse_links(row.Liens_externes),
            "palissy": palissy,
            "renvois": split_multi(row.Renvoi_vers_une_notice_de_la_base_Merimee_ou_Palissy),
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
