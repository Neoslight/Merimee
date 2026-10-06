/**
 * Recherche : ce qui se calcule sans base — raccourcis d'exploration,
 * surlignage de la saisie dans une suggestion.
 */
import { plier, replier, type Filters } from '$lib/state/filters.svelte';
import { METROPOLE, type Bornes } from '$lib/carte/camera';

/** Une entree du corpus a un geste, pour qui ne sait pas quoi chercher. */
export interface Raccourci {
  libelle: string;
  detail: string;
  /** Filtres poses a la place des filtres courants. Les valeurs sont celles du
   *  corpus, a la lettre : `16-recherche.spec.ts` verifie que chacune trouve
   *  des notices. */
  filtres: Partial<Pick<Filters, 'auteurs' | 'denominations'>>;
}

/**
 * Le champ vide propose ces raccourcis, comme les cartes en ligne proposent
 * leurs categories. Des figures et des familles d'edifices, pas des lieux :
 * un lieu, on sait le taper.
 */
export const RACCOURCIS: readonly Raccourci[] = [
  { libelle: 'Vauban', detail: 'les places fortes', filtres: { auteurs: ['Vauban Sébastien Le Prestre de'] } },
  { libelle: 'Hector Guimard', detail: 'l’Art nouveau', filtres: { auteurs: ['Guimard Hector'] } },
  { libelle: 'Le Corbusier', detail: 'le Mouvement moderne', filtres: { auteurs: ['Le Corbusier'] } },
  { libelle: 'Viollet-le-Duc', detail: 'les grandes restaurations', filtres: { auteurs: ['Viollet-le-Duc Eugène'] } },
  {
    libelle: 'Mégalithes',
    detail: 'dolmens, menhirs, allées couvertes',
    filtres: { denominations: ['dolmen', 'menhir', 'allée couverte', 'cromlech', 'alignement'] }
  },
  { libelle: 'Phares', detail: 'sur toutes les côtes', filtres: { denominations: ['phare'] } },
  { libelle: 'Cathédrales', detail: 'de toutes les époques', filtres: { denominations: ['cathédrale'] } },
  { libelle: 'Moulins', detail: 'à eau et à vent', filtres: { denominations: ['moulin'] } }
];

/** Une suggestion decoupee autour de ce qui correspond a la saisie. */
export interface Decoupe {
  avant: string;
  trouve: string;
  apres: string;
}

/**
 * Repere la saisie dans un libelle, accents, casse et ligatures confondus :
 * « coeur » se trouve dans « Chœur », « eglise » dans « Église ». Le repliage
 * peut changer la longueur (« œ » devient « oe ») : chaque caractere replie
 * garde l'indice du caractere d'origine, et c'est le libelle d'origine qu'on
 * decoupe.
 */
export function surligner(texte: string, saisie: string): Decoupe | null {
  const cible = replier(saisie);
  if (!cible) return null;
  let plie = '';
  const origine: number[] = [];
  for (let i = 0; i < texte.length; i++) {
    for (const c of plier(texte[i])) {
      plie += c;
      origine.push(i);
    }
  }
  const k = plie.indexOf(cible);
  if (k < 0) return null;
  const debut = origine[k];
  const fin = origine[k + cible.length - 1] + 1;
  return { avant: texte.slice(0, debut), trouve: texte.slice(debut, fin), apres: texte.slice(fin) };
}

/**
 * L'emprise tient-elle en metropole ? Une recherche par mot peut trouver
 * « Saint-Pierre » a Paris et a la Reunion : cadrer sur les deux montrerait
 * l'ocean. On ne cadre que ce qui tient dans l'hexagone, Corse comprise.
 */
export function dansMetropole([ouest, sud, est, nord]: Bornes): boolean {
  const [o, s, e, n] = METROPOLE;
  return ouest >= o && est <= e && sud >= s && nord <= n;
}
