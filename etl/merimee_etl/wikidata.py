"""Instantané des photographies Wikimedia Commons rattachées aux notices.

La base Mérimée ne porte **aucun lien vers une image** : ni colonne Mémoire, ni
Wikidata, ni fichier. Le seul pont existant passe par Wikidata, qui indexe
l'identifiant Mérimée en propriété `P380` et l'image en `P18`. 84,6 % du corpus
y a au moins une photographie.

Ce module est lancé **à part** du pipeline :

    python -m merimee_etl.wikidata

`python -m merimee_etl` ne l'appelle jamais. Le pipeline reste hors-ligne et
reproductible, et les tests passent sans réseau — `build.py` se contente de la
liste vide quand l'instantané est absent.

Le fichier produit est versionné dans `data/ref/` comme les autres, mais **ce
n'est pas une décision éditoriale** : c'est un instantané daté d'une base
tierce, qui vieillit et se rafraîchit par cette commande.
"""

from __future__ import annotations

import argparse
import csv
import ssl
import sys
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

import pandas as pd

from .config import MAX_IMAGES, OUT_DIR, REF_DIR

ENDPOINT = "https://query.wikidata.org/sparql"

def requete_sparql(prefixe: str) -> str:
    """Requête restreinte à un préfixe de référence.

    `PA` pour le corpus des immeubles protégés : sans le filtre, la requête
    ramène aussi les notices d'inventaire `IA`, absentes d'ici. `ACR` pour la
    couche du label : ses identifiants sont portés par la **même** propriété
    `P380` — 578 items le 2026-09-15, dont 392 illustrés.
    """
    if not prefixe.isalnum():
        raise ValueError(f"préfixe invalide : {prefixe!r}")
    return f"""
SELECT ?ref ?img WHERE {{
  ?item wdt:P380 ?ref ; wdt:P18 ?img .
  FILTER(STRSTARTS(?ref, "{prefixe}"))
}}
"""


REQUETE = requete_sparql("PA")

# Le service impose un agent nommé ; une requête anonyme est refusée.
AGENT = "MerimeeDashboard/1.0 (https://github.com/Neoslight/Merimee)"

PREFIXE = "http://commons.wikimedia.org/wiki/Special:FilePath/"

SORTIE = Path(REF_DIR) / "wikidata_images.csv"
SORTIE_ACR = Path(REF_DIR) / "wikidata_images_acr.csv"

ENTETE = [
    "# Instantané Wikidata : identifiant Mérimée (P380) -> fichier Commons (P18).",
    "# Généré par `python -m merimee_etl.wikidata`, jamais à la main.",
    "# Ce n'est pas une décision éditoriale, c'est une base tierce datée.",
]

ENTETE_ACR = [
    "# Instantané Wikidata, label Architecture contemporaine remarquable :",
    "# identifiant ACR (P380) -> fichier Commons (P18).",
    "# Généré par `python -m merimee_etl.wikidata --acr`, jamais à la main.",
]


def _contexte_tls() -> ssl.SSLContext:
    """Magasin de certificats.

    Le magasin par défaut de Python sous Windows a livré un
    `CERTIFICATE_VERIFY_FAILED: certificate has expired` sur ce point
    d'entrée : `certifi`, tiré par `requests`, est à jour et le règle. Absent,
    on retombe sur le défaut plutôt que d'ajouter une dépendance obligatoire
    pour une commande lancée deux fois par an.
    """
    try:
        import certifi
    except ImportError:
        return ssl.create_default_context()
    return ssl.create_default_context(cafile=certifi.where())


def interroger(timeout: int = 300, prefixe: str = "PA") -> list[tuple[str, str]]:
    """Couples (référence, nom de fichier Commons), dans l'ordre du service."""
    url = f"{ENDPOINT}?{urllib.parse.urlencode({'query': requete_sparql(prefixe)})}"
    requete = urllib.request.Request(
        url, headers={"Accept": "text/csv", "User-Agent": AGENT}
    )
    with urllib.request.urlopen(requete, timeout=timeout, context=_contexte_tls()) as reponse:
        texte = reponse.read().decode("utf-8")

    couples: list[tuple[str, str]] = []
    for ligne in csv.DictReader(texte.splitlines()):
        image = ligne["img"]
        if not image.startswith(PREFIXE):
            continue
        # Wikidata renvoie une **URL** : le nom de fichier y est percent-encode
        # (`Nohant%2006%202009.jpg`). Le stocker tel quel puis le reencoder
        # cote navigateur produit `%252006` et un 404. On decode ici, une fois.
        couples.append(
            (ligne["ref"].strip(), urllib.parse.unquote(image[len(PREFIXE):]))
        )
    return couples


def restreindre(couples: list[tuple[str, str]], references: set[str]) -> list[dict]:
    """Ne garde que les notices du corpus, au plus `MAX_IMAGES` chacune.

    Le tri rend le fichier stable d'une passe à l'autre : sans lui, l'ordre du
    service ferait apparaître un diff à chaque rafraîchissement.
    """
    par_notice: dict[str, set[str]] = defaultdict(set)
    for ref, fichier in couples:
        if ref in references:
            par_notice[ref].add(fichier)

    lignes = []
    for ref in sorted(par_notice):
        for fichier in sorted(par_notice[ref])[:MAX_IMAGES]:
            lignes.append({"reference": ref, "fichier": fichier})
    return lignes


def references_du_corpus(artefacts: Path, acr: bool = False) -> set[str]:
    """Références réellement produites par le pipeline.

    Se lit sur `monuments.parquet` plutôt que sur le CSV source : c'est ce que
    le navigateur interroge, et le fichier fait 2,3 Mo contre 100. La couche
    ACR se lit de même sur ses fragments `acr/fiches/`.
    """
    chemin = artefacts / ("acr/fiches" if acr else "monuments.parquet")
    if not chemin.exists():
        raise SystemExit(
            f"{chemin} introuvable : lancer `python -m merimee_etl` d'abord."
        )
    return set(pd.read_parquet(chemin, columns=["reference"]).reference)


def ecrire(lignes: list[dict], sortie: Path = SORTIE, entete: list[str] = ENTETE) -> int:
    sortie.parent.mkdir(parents=True, exist_ok=True)
    with sortie.open("w", encoding="utf-8", newline="") as fh:
        for commentaire in entete:
            fh.write(commentaire + "\n")
        writer = csv.DictWriter(fh, fieldnames=["reference", "fichier"])
        writer.writeheader()
        writer.writerows(lignes)
    return sortie.stat().st_size


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="merimee_etl.wikidata", description=__doc__)
    parser.add_argument("--acr", action="store_true",
                        help="couche Architecture contemporaine remarquable")
    args = parser.parse_args(argv)
    sortie = SORTIE_ACR if args.acr else SORTIE

    references = references_du_corpus(OUT_DIR, acr=args.acr)
    print(f"corpus                : {len(references):>7,}".replace(",", " "))

    print(f"interrogation de {ENDPOINT} ...")
    try:
        couples = interroger(prefixe="ACR" if args.acr else "PA")
    except OSError as erreur:
        print(f"service injoignable : {erreur}", file=sys.stderr)
        return 1
    print(f"couples renvoyés      : {len(couples):>7,}".replace(",", " "))

    lignes = restreindre(couples, references)
    couvertes = len({ligne["reference"] for ligne in lignes})
    taille = ecrire(lignes, sortie, ENTETE_ACR if args.acr else ENTETE)

    part = 100 * couvertes / len(references) if references else 0
    print(f"notices illustrées    : {couvertes:>7,} ({part:.1f} %)".replace(",", " "))
    print(f"{sortie} : {taille / 1_048_576:.1f} Mo")
    print("relancer `python -m merimee_etl` pour reporter dans les fragments.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
