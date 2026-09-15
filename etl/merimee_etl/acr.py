"""Couche « Architecture contemporaine remarquable » (ACR).

Un second export de POP, **distinct** de la base des immeubles protégés : 1 822
notices `ACR…`, 44 colonnes dont les noms ne recoupent qu'en partie ceux de
`merimee.csv` (`Reference_de_la_notice`, `Coordonnees`, `Titre_courant`,
`Description_historique`…). Le label se perd à la protection au titre des
monuments historiques : le recouvrement mesuré avec le corpus principal tient à
5 renvois `PA`, et aucun point MH ne double un point ACR.

La couche est un **bonus d'affichage**, pas un élargissement du corpus. Elle ne
touche ni `monuments`, ni `details`, ni les chiffres de l'oracle : ses artefacts
vivent dans `acr/`, et le navigateur ne les demande qu'à l'activation de la
couche. Aucun filtre ne s'y applique.

Le fichier source est facultatif : absent, `construire` ne fait rien.
"""

from __future__ import annotations

import gzip
import json
import re
from pathlib import Path

import pandas as pd
import pyarrow as pa

from . import build
from .config import ACR_SHARDS, ACR_SOUS_DOSSIER, MAX_IMAGES, SEP
from .normalize import normalize_text, split_multi
from .parse import merge_auteurs, parse_coords, parse_links

# Colonnes du CSV effectivement lues. Les descripteurs techniques (matériaux,
# couverture, élévation…) sont remplis à moins de 2 % : ils ne font pas une fiche.
COLONNES = [
    "Reference_de_la_notice",
    "Titre_courant",
    "Commune_forme_editoriale",
    "Departement_en_lettres",
    "Region",
    "Coordonnees",
    "Adresse_forme_editoriale",
    "Lieudit",
    "Denominations",
    "Siecle_de_la_campagne_principale_de_construction",
    "Datation_de_l_edifice",
    "Auteur_de_l_edifice",
    "Date_de_Label",
    "Precisions_sur_l_interet",
    "Description_historique",
    "Description_de_l_edifice",
    "Observations",
    "Statut_juridique_du_proprietaire",
    "Liens_externes",
]

INSTANTANES = ("wikidata_images_acr.csv", "commons_images_acr.csv")

_STR = pa.string()
_LIST_STR = pa.list_(pa.string())

SCHEMA = pa.schema([
    ("reference", _STR),
    ("titre", _STR),
    ("commune", _STR),
    ("departement_nom", _STR),
    ("region", _STR),
    ("lat", pa.float32()),
    ("lon", pa.float32()),
    # Première année de label : 13 notices en portent deux (`2000 ; 2026`),
    # l'attribution puis son renouvellement. `annees_label` garde les deux.
    ("annee_label", pa.int16()),
    ("annees_label", pa.list_(pa.int16())),
    ("siecle_detail", _STR),
    ("datation", _STR),
    ("denominations", _LIST_STR),
    ("auteurs_detail", _LIST_STR),
    ("proprietaires", _LIST_STR),
    ("adresse", _STR),
    ("lieudit", _STR),
    ("interet", _STR),
    ("historique", _STR),
    ("description", _STR),
    ("observations", _STR),
    ("liens_externes", _LIST_STR),
    ("commons", _LIST_STR),
])

_ANNEE = re.compile(r"\b(1[89]\d\d|20\d\d)\b")


class IntegriteAcr(RuntimeError):
    """Le fichier ACR ne ressemble pas à ce que la couche attend."""


def charger(chemin: Path) -> pd.DataFrame:
    """Lecture par le parseur CSV, comme `load.py` : jamais de `split` manuel."""
    with chemin.open(encoding="utf-8") as fh:
        entete = fh.readline().rstrip("\n").split(SEP)
    manquantes = [c for c in COLONNES if c not in entete]
    if manquantes:
        raise IntegriteAcr(f"colonnes absentes du source ACR : {manquantes}")
    df = pd.read_csv(
        chemin, sep=SEP, dtype=str, encoding="utf-8", quotechar='"',
        usecols=COLONNES, keep_default_na=False, na_filter=False,
    )[COLONNES]
    refs = df["Reference_de_la_notice"].str.strip()
    if (refs == "").any():
        raise IntegriteAcr("références ACR vides")
    if refs.duplicated().any():
        raise IntegriteAcr(f"références ACR dupliquées : {refs[refs.duplicated()].tolist()[:5]}")
    return df


def annees_label(valeur: str | None) -> list[int]:
    """`"2000 ; 2026"` -> `[2000, 2026]`. Vide pour les 5 notices sans date."""
    return sorted({int(a) for a in _ANNEE.findall(valeur or "")})


def titre_acr(valeur: str | None) -> str:
    """Majuscule initiale : 336 titres courants commencent en minuscule
    (`pont à hauban dit pont Albert-Caquot`), ce qui détonne en tête de fiche
    à côté des titres éditoriaux des Monuments historiques."""
    texte = normalize_text(valeur)
    return texte[:1].upper() + texte[1:]


def transformer(df: pd.DataFrame) -> pd.DataFrame:
    images = build.lire_instantanes(INSTANTANES)
    lignes: list[dict] = []
    for row in df.itertuples(index=False):
        ref = row.Reference_de_la_notice.strip()
        lat, lon = parse_coords(row.Coordonnees)
        annees = annees_label(row.Date_de_Label)
        lignes.append({
            "reference": ref,
            "titre": titre_acr(row.Titre_courant),
            # Un ouvrage à cheval sur deux communes (`Donzère;La Garde-Adhémart`)
            # les garde toutes deux : ce n'est pas un filtre, rien n'oblige à
            # n'en retenir qu'une.
            "commune": ", ".join(split_multi(row.Commune_forme_editoriale)),
            "departement_nom": ", ".join(split_multi(row.Departement_en_lettres)),
            "region": ", ".join(split_multi(row.Region)),
            "lat": lat,
            "lon": lon,
            "annee_label": annees[0] if annees else None,
            "annees_label": annees,
            "siecle_detail": normalize_text(row.Siecle_de_la_campagne_principale_de_construction),
            "datation": " ; ".join(split_multi(row.Datation_de_l_edifice)),
            "denominations": split_multi(row.Denominations),
            "auteurs_detail": merge_auteurs(row.Auteur_de_l_edifice),
            "proprietaires": split_multi(row.Statut_juridique_du_proprietaire),
            "adresse": normalize_text(row.Adresse_forme_editoriale),
            "lieudit": normalize_text(row.Lieudit),
            "interet": normalize_text(row.Precisions_sur_l_interet),
            "historique": normalize_text(row.Description_historique),
            "description": normalize_text(row.Description_de_l_edifice),
            "observations": normalize_text(row.Observations),
            "liens_externes": parse_links(row.Liens_externes),
            "commons": images.get(ref, [])[:MAX_IMAGES],
        })
    return pd.DataFrame(lignes).sort_values("reference", ignore_index=True)


def points_acr(fiches: pd.DataFrame) -> dict:
    """Nuage de la couche, en colonnes — même forme que `build.points_colonnaires`,
    sans statut ni mobilier : la couche a une seule teinte."""
    geo = fiches[fiches.lat.notna()]
    return {
        "total": int(len(fiches)),
        "geolocalises": int(len(geo)),
        "reference": geo.reference.tolist(),
        "lon": [round(float(v), 5) for v in geo.lon],
        "lat": [round(float(v), 5) for v in geo.lat],
        "annee": [int(v) if pd.notna(v) else None for v in geo.annee_label],
    }


def fragment_acr(reference: str) -> int:
    """Même FNV-1a que `details`, modulo propre : cf. `shards.ts::fragmentAcr`."""
    return build.fnv1a(reference) % ACR_SHARDS


def construire(source: Path, out_dir: Path) -> dict[str, int] | None:
    """Écrit `acr/points.json` et `acr/fiches/{n}.parquet`, ou rien sans source.

    Les fiches sont éclatées comme `details` : un Parquet unique de 1,8 Mo
    serait rapatrié en entier au premier clic sur un point ACR.
    """
    if not source.exists():
        return None
    fiches = transformer(charger(source))
    dossier = out_dir / ACR_SOUS_DOSSIER
    fragments = dossier / "fiches"
    fragments.mkdir(parents=True, exist_ok=True)
    for ancien in fragments.glob("*.parquet"):
        ancien.unlink()

    nuage = json.dumps(points_acr(fiches), ensure_ascii=False,
                       separators=(",", ":")).encode("utf-8")
    (dossier / "points.json").write_bytes(nuage)

    total = 0
    groupes = fiches.assign(_fragment=fiches.reference.map(fragment_acr))
    for numero, groupe in groupes.groupby("_fragment", sort=True):
        total += build._write(groupe.drop(columns="_fragment").reset_index(drop=True),
                              SCHEMA, fragments / f"{numero}.parquet")
    return {
        f"acr/fiches/*.parquet ({ACR_SHARDS})": total,
        "acr/points.json": len(nuage),
        "acr/points.json (gzip)": len(gzip.compress(nuage, compresslevel=6)),
    }
