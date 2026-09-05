"""Extraction des champs composites : coordonnees, siecles, protections, auteurs."""

from __future__ import annotations

import csv
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from .config import LAT_RANGE, LON_RANGE, PERIODES, REF_DIR
from .normalize import fold, normalize_text, split_multi

# --------------------------------------------------------------------------
# Coordonnées
# --------------------------------------------------------------------------


def parse_coords(value: str | None) -> tuple[float | None, float | None]:
    """`"lat,lon"` en degrés décimaux -> couple de floats, ou (None, None)."""
    if not value:
        return None, None
    parts = value.split(",")
    if len(parts) != 2:
        return None, None
    try:
        lat, lon = float(parts[0]), float(parts[1])
    except ValueError:
        return None, None
    if lat == 0.0 and lon == 0.0:
        return None, None
    if not (LAT_RANGE[0] <= lat <= LAT_RANGE[1]):
        return None, None
    if not (LON_RANGE[0] <= lon <= LON_RANGE[1]):
        return None, None
    return lat, lon


# --------------------------------------------------------------------------
# Siècles
# --------------------------------------------------------------------------

# `16e s.`, `1er s.`, `20 s.`, `16è s.` — le suffixe ordinal est optionnel.
_SIECLE = re.compile(r"(\d{1,2})\s*(?:er|ère|re|è|e|ème)?\s*s\b", re.IGNORECASE)


def parse_siecles(value: str | None) -> tuple[list[int], list[str]]:
    """Renvoie (siècles numériques triés, périodes non numériques).

    Un même segment peut porter plusieurs siècles : `limite 15e s. 16e s.`,
    `12e s.. 16e s.`, `15e s. : 17e s.` produisent chacun deux valeurs.
    """
    siecles: set[int] = set()
    periodes: dict[str, None] = {}
    for segment in split_multi(value):
        matches = _SIECLE.findall(segment)
        if matches:
            siecles.update(int(m) for m in matches if 1 <= int(m) <= 21)
            continue
        periode = PERIODES.get(fold(segment))
        if periode:
            periodes.setdefault(periode, None)
    return sorted(siecles), list(periodes)


# --------------------------------------------------------------------------
# Statut de protection
# --------------------------------------------------------------------------


def classify_statut(value: str | None) -> tuple[str, bool]:
    """`Typologie_de_la_protection` -> (statut normalisé, protection partielle).

    Une notice peut cumuler les deux statuts (2 562 cas) : additionner
    naivement classés et inscrits surcompte le corpus.
    """
    folded = fold(value or "")
    if not folded:
        return "inconnu", False
    partiel = "partiel" in folded
    # `declasse` contient `classe` : on le neutralise avant de tester.
    residuel = folded.replace("declasse", "")
    classe = "class" in residuel
    inscrit = "inscrit" in residuel
    if classe and inscrit:
        statut = "classé+inscrit"
    elif classe:
        statut = "classé"
    elif inscrit:
        statut = "inscrit"
    elif "declasse" in folded:
        statut = "déclassé"
    else:
        statut = "autre"
    return statut, partiel


# --------------------------------------------------------------------------
# Événements de protection
# --------------------------------------------------------------------------


@dataclass(slots=True)
class Protection:
    reference: str
    annee: int | None
    mois: int | None
    jour: int | None
    libelle: str
    statut: str
    partiel: bool
    brut: str


_DATE_HEAD = re.compile(
    r"^(?P<a>\d{4})"                       # annee sur 4 chiffres
    r"(?:\s*/\s*(?P<m>\d{1,3})"            # mois (parfois 3 chiffres : `019`)
    r"(?:\s*/\s*(?P<j>\d{1,3}))?)?"        # jour
    r"\s*[:./-]*\s*"                       # separateur, parfois absent
)


def _clean_segment(segment: str) -> str:
    """Répare les fautes de frappe récurrentes avant extraction."""
    cleaned = normalize_text(segment)
    cleaned = re.sub(r"/{2,}", "/", cleaned)                  # `2006//09/15`
    cleaned = re.sub(r"^(\d{4})(\d{2})/", r"\1/\2/", cleaned)  # `201909/13`
    return cleaned


def _coerce(part: str | None, hi: int) -> int | None:
    if not part:
        return None
    value = int(part.lstrip("0") or "0")  # `019` -> 19
    return value if 1 <= value <= hi else None


def parse_protections(
    reference: str, value: str | None
) -> tuple[list[Protection], list[str]]:
    """`YYYY/MM/DD : statut` (x n, séparés par `;`) -> événements + rejets.

    Les segments hors-format ne sont jamais silencieusement perdus : ils
    produisent quand même un événement (avec les champs lisibles) et sont
    signalés pour le rapport `etl/out/rejets.csv`.
    """
    events: list[Protection] = []
    rejects: list[str] = []
    for segment in split_multi(value):
        cleaned = _clean_segment(segment)
        match = _DATE_HEAD.match(cleaned)
        if match:
            annee = int(match.group("a"))
            mois = _coerce(match.group("m"), 12)
            jour = _coerce(match.group("j"), 31)
            libelle = cleaned[match.end():].strip(" :./-")
        else:
            annee = mois = jour = None
            libelle = cleaned.strip(" :./-")
        if annee is None or not libelle:
            rejects.append(segment)
        statut, partiel = classify_statut(libelle)
        events.append(
            Protection(
                reference, annee, mois, jour, libelle.lower(), statut, partiel, segment
            )
        )
    return events, rejects


# --------------------------------------------------------------------------
# Auteurs
# --------------------------------------------------------------------------


def _is_continuation(token: str) -> bool:
    """Un fragment de continuation ne démarre jamais une identité.

    Soit il commence par une minuscule (`marquis`, `dit`, `ou`), soit il se
    réduit a une parenthèse de rôle (`(architecte)`). Le séparateur `;` a
    coupé au milieu d'une mention composée : on recolle au lieu de créer un
    auteur fantôme (425 occurrences dans le corpus).
    """
    if not token:
        return True
    head = token[0]
    return head == "(" or (head.isalpha() and head.islower())


# `Jeanneret Charles-Edouard;dit;Le Corbusier (architecte)` : le fragment
# `dit` se recolle par la règle ci-dessus, mais `Le Corbusier` commence par
# une majuscule et repartirait en identité distincte. Une entrée qui se
# termine par une conjonction d'identité appelle donc la suivante.
_DANGLING = re.compile(r",\s*(?:dit|dite|ou|et)$", re.IGNORECASE)

# Rôle en fin de mention : `(architecte)`, `(maître de l'oeuvre, sculpteur)`.
_ROLE_PAREN = re.compile(r"\s*\([^()]*\)\s*$")
# Rôle accolé après une virgule : `Gabriel François, architecte`.
_ROLE_COMMA = re.compile(r",\s*(?!dit\b|dite\b|ou\b|et\b)[a-zà-öø-ÿ][^,]*$")


def _titlecase_token(token: str) -> str:
    """`GUIMARD` -> `Guimard`, en laissant les formes déjà mixtes intactes.

    Les patronymes sont saisis tantôt en capitales, tantôt en casse normale
    (`PERRET Auguste` et `Perret Auguste` coexistent) : sans ce repli, la
    même personne alimente deux entrées de facette.
    """
    if len(token) > 1 and token.isupper() and any(c.isalpha() for c in token):
        return "".join(
            c.lower() if i and token[i - 1].isalpha() else c
            for i, c in enumerate(token)
        )
    return token


def person_name(full: str) -> str:
    """Réduit une mention d'auteur à l'identité seule, sans rôle ni casse.

    Le rôle (`architecte`, `maître de l'oeuvre`) décrit l'intervention, pas
    la personne : le conserver éclate un même architecte en autant d'entrées
    que de rôles. Il reste disponible en clair dans la table de détails.
    """
    name = _ROLE_PAREN.sub("", normalize_text(full))
    previous = None
    while previous != name:
        previous = name
        name = _ROLE_COMMA.sub("", name).strip(" ,;.")
    return " ".join(_titlecase_token(t) for t in name.split(" ") if t)


def _alias_key(name: str) -> str:
    """Clé de rapprochement insensible à la ponctuation et à la casse.

    `Guimard, Hector` et `Guimard Hector` désignent la même personne : la
    virgule d'inversion ne doit pas produire deux entrées.
    """
    return " ".join(fold(name).replace(",", " ").replace(".", " ").split())


@lru_cache(maxsize=1)
def _alias_map() -> dict[str, str]:
    path = Path(REF_DIR) / "auteurs_alias.csv"
    mapping: dict[str, str] = {}
    if not path.exists():
        return mapping
    with path.open(encoding="utf-8", newline="") as fh:
        for row in csv.DictReader(fh):
            mapping[_alias_key(person_name(row["alias"]))] = row["canonique"]
    return mapping


# `GABRIEL Jacques-Ange, ou GABRIEL Ange-Jacques` : une attribution
# hésitante entre deux personnes, pas une identité composée. `dit` en
# revanche introduit un pseudonyme et reste attaché.
_ALTERNATIVE = re.compile(r",\s*ou\s+", re.IGNORECASE)


def merge_auteurs(value: str | None) -> list[str]:
    """Éclate le champ et recolle les fragments, rôles compris."""
    merged: list[str] = []
    for token in split_multi(value):
        if merged and (_is_continuation(token) or _DANGLING.search(merged[-1])):
            joiner = " " if _DANGLING.search(merged[-1]) else ", "
            merged[-1] = f"{merged[-1]}{joiner}{token}"
        else:
            merged.append(token)
    return merged


def parse_auteurs(value: str | None) -> list[str]:
    """Identités consolidées, prêtes pour une facette."""
    aliases = _alias_map()
    out: dict[str, None] = {}
    for mention in merge_auteurs(value):
        for variant in _ALTERNATIVE.split(mention):
            name = person_name(variant)
            if name:
                out.setdefault(aliases.get(_alias_key(name), name), None)
    return list(out)


# --------------------------------------------------------------------------
# Liens
# --------------------------------------------------------------------------

_POP_ID = re.compile(r"/([A-Z]{2}\w+)\s*$")


def parse_links(value: str | None) -> list[str]:
    return split_multi(value)


def palissy_ids(value: str | None) -> list[str]:
    """URLs POP -> identifiants Palissy (`IM...`), bien plus compacts."""
    ids: list[str] = []
    for url in split_multi(value):
        match = _POP_ID.search(url)
        ids.append(match.group(1) if match else url)
    return ids
