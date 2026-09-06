"""Point d'entrée : `python -m merimee_etl`."""

from __future__ import annotations

import argparse
import csv
import sys
import time
from pathlib import Path

from .build import transform, write_artifacts
from .config import OUT_DIR, RAW_CSV, REPORT_DIR
from .load import load_raw
from .texte import construire as construire_index


def _human(size: int) -> str:
    return f"{size / 1_048_576:.1f} Mo"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="merimee_etl", description=__doc__)
    parser.add_argument("--raw", type=Path, default=RAW_CSV, help="CSV source")
    parser.add_argument("--out", type=Path, default=OUT_DIR, help="dossier des artefacts")
    parser.add_argument("--report", type=Path, default=REPORT_DIR, help="rapports de rejets")
    parser.add_argument("--no-strict", action="store_true",
                        help="tolère un volume différent du fichier de référence")
    args = parser.parse_args(argv)

    if not args.raw.exists():
        print(f"source introuvable : {args.raw}", file=sys.stderr)
        return 1

    started = time.perf_counter()
    print(f"lecture {args.raw} ...")
    df = load_raw(args.raw, strict=not args.no_strict)

    print("transformation ...")
    monuments, protections, details, rejets, report = transform(df)

    print(f"écriture {args.out} ...")
    sizes = write_artifacts(monuments, protections, details, args.out)

    # Absent si `duckdb` ou l'extension `fts` manque : la recherche plein texte
    # n'est alors pas proposée, et rien d'autre ne change.
    index = construire_index(args.out)
    if index:
        sizes.update(index)
    else:
        print("index plein texte non construit (duckdb ou extension fts absente)")

    args.report.mkdir(parents=True, exist_ok=True)
    rejets_path = args.report / "rejets.csv"
    with rejets_path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=["reference", "champ", "segment"])
        writer.writeheader()
        writer.writerows(rejets)

    print("\n".join(report.as_lines()))
    for name, size in sizes.items():
        print(f"{name:<21}: {_human(size)}")
    print(f"rejets détaillés     : {rejets_path}")
    print(f"terminé en {time.perf_counter() - started:.1f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
