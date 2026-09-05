"""Normalisation textuelle : apostrophes, espaces, accents, vocabulaires contrôlés."""

from __future__ import annotations

import csv
import re
import unicodedata
from functools import lru_cache
from pathlib import Path

from .config import REF_DIR

_SPACES = re.compile(r"[\s\u00a0\u202f]+")
_APOSTROPHES = str.maketrans({"\u2019": "'", "\u02bc": "'", "\u2018": "'"})


def normalize_text(value: str | None) -> str:
    """Apostrophes typographiques, espaces insécables et espaces multiples."""
    if not value:
        return ""
    return _SPACES.sub(" ", value.translate(_APOSTROPHES)).strip()


def strip_accents(value: str) -> str:
    decomposed = unicodedata.normalize("NFD", value)
    return "".join(c for c in decomposed if unicodedata.category(c) != "Mn")


def fold(value: str) -> str:
    """Forme de comparaison : sans accents, minuscules, espaces normalisés."""
    return strip_accents(normalize_text(value)).lower()


def split_multi(value: str | None) -> list[str]:
    """Éclate un champ multivalué.

    Le séparateur est `;` partout, mais certains champs utilisent ` ; `
    (`Statut_juridique_de_l_edifice`) : le strip par segment couvre les deux.
    """
    if not value:
        return []
    return [part for part in (normalize_text(p) for p in value.split(";")) if part]


@lru_cache(maxsize=1)
def _vocab_map() -> dict[tuple[str, str], str]:
    """Corrections de vocabulaire, indexées sur (champ, forme repliée)."""
    path = Path(REF_DIR) / "vocabulaires.csv"
    mapping: dict[tuple[str, str], str] = {}
    if not path.exists():
        return mapping
    with path.open(encoding="utf-8", newline="") as fh:
        for row in csv.DictReader(fh):
            mapping[(row["champ"], fold(row["valeur_brute"]))] = row["valeur_normalisee"]
    return mapping


def normalize_vocab(champ: str, value: str) -> str:
    """Applique la table de corrections, sinon replie la casse.

    Les vocabulaires contrôlés du fichier source souffrent d'une casse
    incohérente (`Dossier de protection` 18 777 vs `dossier de protection`
    27 643). On ramène tout en minuscules, hors correction explicite.
    """
    value = normalize_text(value)
    if not value:
        return ""
    override = _vocab_map().get((champ, fold(value)))
    if override is not None:
        return override
    return value[0].lower() + value[1:] if value[0].isupper() else value


def split_vocab(champ: str, value: str | None) -> list[str]:
    """Éclate puis normalise, en dédoublonnant sans perdre l'ordre."""
    seen: dict[str, None] = {}
    for part in split_multi(value):
        normalized = normalize_vocab(champ, part)
        if normalized:
            seen.setdefault(normalized, None)
    return list(seen)


def search_key(*parts: str) -> str:
    """Clé de recherche instantanée : sans accents, minuscules."""
    return fold(" ".join(p for p in parts if p))
