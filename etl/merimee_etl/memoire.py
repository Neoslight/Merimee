"""Instantané des illustrations Mémoire rattachées aux notices Mérimée.

Wikimedia laisse **6 692 notices sans photographie**. La plupart en ont pourtant
une : la base **Mémoire** — les campagnes photographiques du ministère de la
Culture — illustre la Plateforme ouverte du patrimoine. Sondage sur 60 de ces
notices : **47 portent au moins une image Mémoire**, soit ~78 %.

**Ces images ne sont pas reproduites ici, et ne doivent pas l'être.** Sur les
546 mentions de crédit relevées dans le même sondage, aucune n'est libre :
« tous droits réservés », « diffusion GrandPalaisRmn Photo », « reproduction
soumise à autorisation du titulaire des droits d'exploitation ». Les
photographies Commons sont sous licence libre, celles-ci non — les afficher
serait une reproduction non autorisée sur un site tiers. Ce module ne récolte
donc **qu'un nombre**, et la fiche n'en fait qu'un renvoi vers POP, qui les
montre chez lui et sous sa propre responsabilité.

La source est le jeu « Mémoire – illustration Mérimée et Palissy » de
data.gouv.fr, sous **ODbL** : un fichier de 1,36 Go, lu **en flux** et jamais
écrit sur le disque. À 30 Mo/s mesurés, la passe coûte moins d'une minute —
sans commune mesure avec les 6 692 pages POP qu'il faudrait sinon interroger.

Ce module est lancé **à part** du pipeline :

    python -m merimee_etl.memoire

`python -m merimee_etl` ne l'appelle jamais : le pipeline reste hors-ligne et
les tests sans réseau. Le fichier produit est versionné dans `data/ref/` comme
les deux instantanés photo, et comme eux **ce n'est pas une décision
éditoriale** : c'est une base tierce datée, qui vieillit.
"""

from __future__ import annotations

import csv
import io
import sys
import urllib.request
from collections import Counter
from pathlib import Path

from .config import OUT_DIR, REF_DIR
from .wikidata import AGENT, _contexte_tls, references_du_corpus

SOURCE = "https://ministere-culture.s3.sbg.io.cloud.ovh.net/POP/memoire_palissy_merimee.csv"

SORTIE = Path(REF_DIR) / "memoire_illustrations.csv"

ENTETE = [
    "# Instantané Mémoire : nombre d'illustrations POP par notice Mérimée.",
    "# Généré par `python -m merimee_etl.memoire`, jamais à la main.",
    "# Un nombre, pas une image : ces photographies sont sous droits réservés.",
]

# Le fichier Mémoire porte 120 colonnes ; trois seulement servent ici.
COLONNE_LIEN = "References_Palissy_Merimee_lien_notice_en_cours"
COLONNE_IMAGE = "Lien_vers_l_image"
# L'export tait la mention de droits sur 88 % des lignes : `Copyright` y est
# vide partout ou `Droits_de_diffusion` l'est — mesure, les deux colonnes ont
# ete comptees tour a tour et rendent le meme decompte. La mention complete se
# lit sur POP, pas ici ; on compte les deux pour ne pas dependre de laquelle
# des deux le ministere remplira demain.
COLONNE_DROITS = "Copyright"
COLONNE_DIFFUSION = "Droits_de_diffusion"

# Le CSV du ministère est en `|`, comme `merimee.csv`, et sans guillemets
# systématiques : `csv` s'en charge, on ne découpe pas à la main.
SEPARATEUR = "|"

# Un champ Mémoire peut porter un descriptif entier : la limite par défaut de
# `csv` (128 Ko) est trop basse pour ce fichier.
csv.field_size_limit(10_000_000)


def _lignes_distantes(url: str = SOURCE, timeout: int = 600):
    """Le fichier est lu en flux : 1,36 Go n'ont pas à toucher le disque."""
    requete = urllib.request.Request(url, headers={"User-Agent": AGENT})
    reponse = urllib.request.urlopen(requete, timeout=timeout, context=_contexte_tls())
    return io.TextIOWrapper(reponse, encoding="utf-8", newline="")


def compter(flux, references: set[str]) -> tuple[Counter, Counter, int]:
    """Illustrations par notice, mentions de droits, lignes lues.

    Une ligne Mémoire peut citer plusieurs notices (`PA00099871;IA19000868`) :
    chacune compte l'image. Les lignes sans `Lien_vers_l_image` sont des
    notices documentaires sans fichier, elles ne comptent pas.
    """
    par_notice: Counter = Counter()
    droits: Counter = Counter()
    lues = 0
    for row in csv.DictReader(flux, delimiter=SEPARATEUR):
        lues += 1
        if not (row.get(COLONNE_IMAGE) or "").strip():
            continue
        liens = (row.get(COLONNE_LIEN) or "").split(";")
        vues = set()
        for lien in liens:
            ref = lien.strip()
            if ref in references and ref not in vues:
                vues.add(ref)
                par_notice[ref] += 1
        if vues:
            mention = (row.get(COLONNE_DROITS) or "").strip()
            droits[mention or (row.get(COLONNE_DIFFUSION) or "").strip()] += 1
    return par_notice, droits, lues


def ecrire(par_notice: Counter, sortie: Path = SORTIE) -> int:
    sortie.parent.mkdir(parents=True, exist_ok=True)
    with sortie.open("w", encoding="utf-8", newline="") as fh:
        for commentaire in ENTETE:
            fh.write(commentaire + "\n")
        writer = csv.writer(fh)
        writer.writerow(["reference", "images"])
        for reference in sorted(par_notice):
            writer.writerow([reference, par_notice[reference]])
    return sortie.stat().st_size


def main(argv: list[str] | None = None) -> int:
    references = references_du_corpus(OUT_DIR)
    print(f"corpus                : {len(references):>7,}".replace(",", " "))

    print(f"lecture en flux de {SOURCE} ...")
    try:
        with _lignes_distantes() as flux:
            par_notice, droits, lues = compter(flux, references)
    except OSError as erreur:
        print(f"source injoignable : {erreur}", file=sys.stderr)
        return 1

    print(f"lignes Mémoire lues   : {lues:>7,}".replace(",", " "))
    total = sum(par_notice.values())
    part = 100 * len(par_notice) / len(references) if references else 0
    print(f"notices illustrées    : {len(par_notice):>7,} ({part:.1f} %)".replace(",", " "))
    print(f"illustrations         : {total:>7,}".replace(",", " "))

    # Les droits sont imprimés, pas stockés : c'est la justification du choix
    # de ne rien reproduire, et elle doit rester vérifiable d'une passe à
    # l'autre. Si une mention libre apparaissait un jour en nombre, le débat
    # se rouvrirait sur des chiffres.
    print("mentions de diffusion, les cinq plus fréquentes :")
    for mention, nombre in droits.most_common(5):
        print(f"  {nombre:>7,}".replace(",", " "), "|", (mention or "(vide)")[:90])

    taille = ecrire(par_notice)
    print(f"{SORTIE} : {taille / 1024:.0f} Ko")
    print("relancer `python -m merimee_etl` pour reporter dans les fragments.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
