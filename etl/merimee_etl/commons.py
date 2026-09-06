"""Second instantané photographique : les fichiers Commons qui citent la notice.

Le pont Wikidata (`wikidata.py`) n'est pas étroit — **46 618 items portent déjà
un identifiant Mérimée `P380`** sur 46 760 notices. Les 7 204 fiches sans
photographie n'ont pas d'item manquant : elles n'ont pas de `P18`. Ce module
va chercher ce qui existe sur Commons sans avoir été relié à Wikidata.

Trois routes ont été mesurées sur échantillon avant d'en retenir une :

* **image de tête de l'article frwiki** : 172 « images » sur 300, mais 13 vraies
  photographies. Le reste est cartes de localisation, blasons, `MH_disparu.svg` ;
* **`insource:"PA…"`** : 11 notices sur 100. Le fichier **cite la référence**,
  généralement par le modèle `{{Mérimée}}` de sa page de description ;
* **geosearch dans un rayon de 150 m** : 44 sur 100, mais le sujet n'est pas
  vérifié — la préfecture de Nanterre y récolte `BENOIT HAMON.jpg`, une
  « Demeure » de Salins-les-Bains y récolte l'église voisine. Corroborer par le
  titre ne filtre presque rien : le nom de commune figure dans la plupart des
  noms de fichiers, il atteste le lieu, pas le sujet.

**Seule la route précise est retenue.** Une fiche affirme quelque chose en
montrant une photographie ; la plaque nommée que `DetailPanel` pose à défaut
vaut mieux qu'une image fausse.

La sortie est un fichier **séparé** de l'instantané Wikidata : deux bases
tierces de fiabilité différente, dont l'une doit pouvoir être régénérée ou
jetée sans toucher l'autre. `build.py` lit les deux, Wikidata d'abord.

    python -m merimee_etl.commons            # ~7 200 requetes, ~25 min
    python -m merimee_etl.commons --limite 50

L'écriture est incrémentale et les références déjà traitées sont sautées : une
coupure réseau ne fait pas repartir de zéro.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import pandas as pd

from .config import MAX_IMAGES, OUT_DIR, REF_DIR
from .wikidata import AGENT, _contexte_tls
from .wikidata import SORTIE as SORTIE_WIKIDATA

API = "https://commons.wikimedia.org/w/api.php"

SORTIE = Path(REF_DIR) / "commons_images.csv"

ENTETE = [
    "# Instantané Wikimedia Commons : fichiers dont la page cite la référence Mérimée.",
    "# Généré par `python -m merimee_etl.commons`, jamais à la main.",
    "# Complète `wikidata_images.csv` ; ce n'est pas une décision éditoriale.",
]

# Une pause courte suffit : l'API de recherche est servie par CirrusSearch, et
# 7 200 requêtes espacées de 150 ms restent sous le seuil de courtoisie.
PAUSE = 0.15

_RASTER = re.compile(r"\.(jpe?g|png|tiff?)$", re.IGNORECASE)
# Le piège mesuré sur les images de tête frwiki : ce qui illustre une notice
# n'est pas forcément une photographie de l'édifice.
_ECARTE = re.compile(
    r"(location[_ ]map|_map\b|carte|blason|logo|mh[_ ]disparu|picto|flag|coat)",
    re.IGNORECASE,
)


def photographie(nom: str) -> bool:
    """Vrai si le nom de fichier ressemble à une photographie, pas à un pictogramme."""
    return bool(_RASTER.search(nom)) and not _ECARTE.search(nom)


def _api(params: dict[str, str], timeout: int = 45) -> dict:
    url = f"{API}?{urllib.parse.urlencode(params)}"
    requete = urllib.request.Request(url, headers={"User-Agent": AGENT})
    with urllib.request.urlopen(requete, timeout=timeout, context=_contexte_tls()) as reponse:
        return json.load(reponse)


def fichiers_citant(reference: str) -> list[str]:
    """Fichiers Commons dont le wikitexte cite `reference`, au plus `MAX_IMAGES`.

    Une panne réseau ponctuelle rend une liste vide plutôt que d'interrompre :
    la reprise reverra la notice au prochain passage.
    """
    try:
        reponse = _api(
            {
                "action": "query",
                "format": "json",
                "list": "search",
                "srnamespace": "6",
                "srlimit": str(MAX_IMAGES * 2),
                "srsearch": f'insource:"{reference}"',
            }
        )
    except (OSError, urllib.error.HTTPError, json.JSONDecodeError):
        return []
    resultats = reponse.get("query", {}).get("search", [])
    # `File:` en tête de chaque titre : les fragments stockent le nom nu, comme
    # pour l'instantané Wikidata.
    noms = [item["title"].removeprefix("File:") for item in resultats]
    return [nom for nom in noms if photographie(nom)][:MAX_IMAGES]


def _references_couvertes() -> set[str]:
    """Notices déjà illustrées par l'instantané Wikidata."""
    if not SORTIE_WIKIDATA.exists():
        return set()
    with SORTIE_WIKIDATA.open(encoding="utf-8", newline="") as fh:
        lignes = (ligne for ligne in fh if not ligne.startswith("#"))
        return {row["reference"] for row in csv.DictReader(lignes)}


def _deja_traitees() -> tuple[list[dict], set[str]]:
    """Lignes déjà écrites, et les références qu'elles couvrent.

    Seules les notices trouvées apparaissent : une notice cherchée sans succès
    sera recherchée au prochain passage, et c'est voulu — Commons s'enrichit.
    """
    if not SORTIE.exists():
        return [], set()
    with SORTIE.open(encoding="utf-8", newline="") as fh:
        lignes = (ligne for ligne in fh if not ligne.startswith("#"))
        acquises = list(csv.DictReader(lignes))
    return acquises, {row["reference"] for row in acquises}


def ecrire(lignes: list[dict], sortie: Path = SORTIE) -> int:
    sortie.parent.mkdir(parents=True, exist_ok=True)
    ordonnees = sorted(lignes, key=lambda row: (row["reference"], row["fichier"]))
    with sortie.open("w", encoding="utf-8", newline="") as fh:
        for commentaire in ENTETE:
            fh.write(commentaire + "\n")
        writer = csv.DictWriter(fh, fieldnames=["reference", "fichier"])
        writer.writeheader()
        writer.writerows(ordonnees)
    return sortie.stat().st_size


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="merimee_etl.commons", description=__doc__)
    parser.add_argument("--limite", type=int, default=0,
                        help="ne traiter que N notices (essai)")
    parser.add_argument("--pause", type=float, default=PAUSE,
                        help="secondes entre deux requêtes")
    args = parser.parse_args(argv)

    chemin = OUT_DIR / "monuments.parquet"
    if not chemin.exists():
        print(f"{chemin} introuvable : lancer `python -m merimee_etl` d'abord.",
              file=sys.stderr)
        return 1

    corpus = list(pd.read_parquet(chemin, columns=["reference"]).reference)
    couvertes = _references_couvertes()
    acquises, trouvees = _deja_traitees()

    manquantes = [ref for ref in corpus
                  if ref not in couvertes and ref not in trouvees]
    if args.limite:
        manquantes = manquantes[: args.limite]

    print(f"corpus                : {len(corpus):>7,}".replace(",", " "))
    print(f"illustrées (Wikidata) : {len(couvertes):>7,}".replace(",", " "))
    print(f"à interroger          : {len(manquantes):>7,}".replace(",", " "))

    nouvelles = 0
    for rang, reference in enumerate(manquantes, start=1):
        for fichier in fichiers_citant(reference):
            acquises.append({"reference": reference, "fichier": fichier})
            nouvelles += 1
        if rang % 250 == 0:
            # Sauvegarde intermédiaire : 25 minutes de réseau ne doivent pas
            # tenir dans un seul processus.
            ecrire(acquises)
            print(f"  {rang:>6} interrogées, {nouvelles:>5} fichiers retenus")
        time.sleep(args.pause)

    taille = ecrire(acquises)
    gagnees = len({row["reference"] for row in acquises})
    print(f"notices complétées    : {gagnees:>7,}".replace(",", " "))
    print(f"{SORTIE} : {taille / 1024:.0f} Ko")
    print("relancer `python -m merimee_etl` pour reporter dans les fragments.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
