/**
 * Etat des filtres et construction du predicat SQL.
 *
 * Chaque cle produit sa propre clause. Cette separation permet d'evaluer une
 * facette en excluant son propre filtre : sinon toutes les options non
 * cochees tombent a zero des la premiere selection et le filtrage croise
 * devient inutilisable.
 */
import { lit, litList } from '$lib/db/duckdb';

export type FacetKey =
  | 'statut'
  | 'siecles'
  | 'periodes'
  | 'domaines'
  | 'denominations'
  | 'auteurs'
  | 'regions'
  | 'departements'
  | 'proprietaires'
  | 'anneeProtection'
  | 'nbPalissy'
  | 'recherche'
  | 'bbox';

export interface Filters {
  statut: string[];
  siecles: number[];
  periodes: string[];
  domaines: string[];
  denominations: string[];
  auteurs: string[];
  regions: string[];
  departements: string[];
  proprietaires: string[];
  anneeProtection: [number, number] | null;
  nbPalissy: number;
  recherche: string;
  bbox: [number, number, number, number] | null;
}

export const ANNEE_MIN = 1840;
export const ANNEE_MAX = 2026;

/** Etat neutre. Exporte pour que la lecture d'un permalien parte d'une base
 *  propre plutot que de fusionner avec les filtres deja poses. */
export function filtresVides(): Filters {
  return {
    statut: [],
    siecles: [],
    periodes: [],
    domaines: [],
    denominations: [],
    auteurs: [],
    regions: [],
    departements: [],
    proprietaires: [],
    anneeProtection: null,
    nbPalissy: 0,
    recherche: '',
    bbox: null
  };
}

export const filters = $state<Filters>(filtresVides());

/** Colonne `LIST` -> `list_has_any`, sans jointure ni table de liaison. */
function listeClause(colonne: string, valeurs: readonly string[]): string | null {
  return valeurs.length ? `list_has_any(${colonne}, ${litList(valeurs)})` : null;
}

const CLAUSES: Record<FacetKey, (f: Filters) => string | null> = {
  statut: (f) =>
    f.statut.length ? `statut IN (${f.statut.map(lit).join(', ')})` : null,
  siecles: (f) =>
    f.siecles.length ? `list_has_any(siecles, [${f.siecles.join(', ')}]::TINYINT[])` : null,
  periodes: (f) => listeClause('periodes', f.periodes),
  domaines: (f) => listeClause('domaines', f.domaines),
  denominations: (f) => listeClause('denominations', f.denominations),
  auteurs: (f) => listeClause('auteurs', f.auteurs),
  proprietaires: (f) => listeClause('proprietaires', f.proprietaires),
  regions: (f) => (f.regions.length ? `region IN (${f.regions.map(lit).join(', ')})` : null),
  // La facette expose le nom du departement, pas son code : le predicat doit
  // porter sur la meme colonne que les libelles affiches.
  departements: (f) =>
    f.departements.length ? `departement_nom IN (${f.departements.map(lit).join(', ')})` : null,
  // Semi-jointure sur les actes plutot que sur `annee_premiere/derniere` :
  // une notice protegee en 1925 puis en 1990 ne doit pas apparaitre pour 1960.
  anneeProtection: (f) =>
    f.anneeProtection
      ? `reference IN (SELECT reference FROM protections WHERE annee BETWEEN ${f.anneeProtection[0]} AND ${f.anneeProtection[1]})`
      : null,
  nbPalissy: (f) => (f.nbPalissy > 0 ? `nb_palissy >= ${f.nbPalissy}` : null),
  // Chaque mot est cherche separement : `search_key` concatene titre, commune
  // et departement, donc « chateau bordeaux » n'y apparait jamais d'un seul
  // tenant. Les mots doivent tous etre presents, dans n'importe quel ordre.
  recherche: (f) => {
    const mots = f.recherche.trim().split(/\s+/).filter(Boolean);
    if (!mots.length) return null;
    return mots.map((mot) => `search_key LIKE ${lit(`%${mot}%`)}`).join(' AND ');
  },
  bbox: (f) =>
    f.bbox
      ? `lat BETWEEN ${f.bbox[1]} AND ${f.bbox[3]} AND lon BETWEEN ${f.bbox[0]} AND ${f.bbox[2]}`
      : null
};

/**
 * Predicat SQL courant. `except` retire une cle : c'est ce qui permet a une
 * facette de continuer a montrer ses options alternatives.
 */
export function buildWhere(f: Filters, except?: FacetKey): string {
  const clauses = (Object.keys(CLAUSES) as FacetKey[])
    .filter((key) => key !== except)
    .map((key) => CLAUSES[key](f))
    .filter((clause): clause is string => clause !== null);
  return clauses.length ? clauses.join(' AND ') : 'TRUE';
}

export function toggle<K extends 'statut' | 'periodes' | 'domaines' | 'denominations' | 'auteurs' | 'regions' | 'departements' | 'proprietaires'>(
  cle: K,
  valeur: string
): void {
  const liste = filters[cle] as string[];
  const index = liste.indexOf(valeur);
  if (index === -1) liste.push(valeur);
  else liste.splice(index, 1);
}

export function toggleSiecle(siecle: number): void {
  const index = filters.siecles.indexOf(siecle);
  if (index === -1) filters.siecles.push(siecle);
  else filters.siecles.splice(index, 1);
}

export function reset(): void {
  Object.assign(filters, filtresVides());
}

/** Nombre de filtres actifs, pour l'affichage du bouton de remise a zero. */
export function countActive(f: Filters): number {
  return (Object.keys(CLAUSES) as FacetKey[]).filter((key) => CLAUSES[key](f) !== null).length;
}
