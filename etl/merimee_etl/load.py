"""Lecture du CSV source et contrôles d'intégrité."""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from .config import EXPECTED_COLS, EXPECTED_ROWS, KEEP_COLS, SEP


class IntegrityError(RuntimeError):
    """Le fichier source ne correspond pas à ce que le pipeline attend."""


def read_header(path: Path) -> list[str]:
    """L'en-tete n'est pas quotée, contrairement aux lignes de données."""
    with path.open(encoding="utf-8") as fh:
        return fh.readline().rstrip("\n").split(SEP)


def load_raw(path: Path, *, strict: bool = True) -> pd.DataFrame:
    """Charge le CSV en texte pur.

    Le fichier utilise le pipe comme séparateur, mais la notice `PA31000132`
    contient un pipe littéral dans un champ quoté : un `split("|")` manuel
    produirait 79 champs sur cette ligne. Le parseur CSV est obligatoire.
    """
    header = read_header(path)
    if strict and len(header) != EXPECTED_COLS:
        raise IntegrityError(f"{len(header)} colonnes en en-tête, {EXPECTED_COLS} attendues")

    missing = [c for c in KEEP_COLS if c not in header]
    if missing:
        raise IntegrityError(f"colonnes absentes du source : {missing}")

    df = pd.read_csv(
        path,
        sep=SEP,
        dtype=str,
        encoding="utf-8",
        quotechar='"',
        usecols=KEEP_COLS,
        low_memory=False,
        keep_default_na=False,
        na_filter=False,
    )
    df = df[KEEP_COLS]

    if strict and len(df) != EXPECTED_ROWS:
        raise IntegrityError(f"{len(df)} notices lues, {EXPECTED_ROWS} attendues")
    if df["Reference"].duplicated().any():
        dupes = df.loc[df["Reference"].duplicated(), "Reference"].tolist()[:5]
        raise IntegrityError(f"références dupliquées : {dupes}")
    if (df["Reference"] == "").any():
        raise IntegrityError("références vides")

    return df
