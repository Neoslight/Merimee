/**
 * Suggestions de la recherche : lieux, edifices, categories, en une requete.
 *
 * Tout se resout dans DuckDB, sur `monuments` : aucun geocodeur, aucun appel
 * reseau. Un lieu porte l'emprise de ses notices — c'est elle que la carte
 * cadre —, un edifice ses coordonnees, une categorie son effectif.
 *
 * Les suggestions ignorent les filtres poses : on cherche un nom, pas une
 * intersection. « Rouen » doit repondre meme sous un filtre « phare ».
 */
import { echapperLike, lit, query } from './duckdb';
import { replier, type FacetKey } from '$lib/state/filters.svelte';
import type { Bornes } from '$lib/carte/camera';

export type Genre = 'commune' | 'departement' | 'region' | 'edifice' | 'denomination' | 'domaine' | 'auteur';

export interface Suggestion {
  genre: Genre;
  libelle: string;
  /** Departement d'une commune, commune d'un edifice : ce qui distingue
   *  deux homonymes. */
  precision: string | null;
  n: number;
  /** Emprise d'un lieu, point d'un edifice (ouest = est, sud = nord). */
  bornes: Bornes | null;
  reference: string | null;
}

/** Cle de filtre que pose une categorie ou un lieu administratif. */
export const CLE_FILTRE: Partial<Record<Genre, FacetKey>> = {
  departement: 'departements',
  region: 'regions',
  denomination: 'denominations',
  domaine: 'domaines',
  auteur: 'auteurs'
};

/** Combien de suggestions par famille : assez pour choisir, pas au point de
 *  noyer la liste sous des homonymes. */
const PLAFONDS = { commune: 4, departement: 2, region: 2, edifice: 5, categorie: 2 } as const;

interface LigneBrute {
  genre: Genre;
  libelle: string;
  precision: string | null;
  n: number;
  o: number | null;
  s: number | null;
  e: number | null;
  nn: number | null;
  reference: string | null;
}

/**
 * Suggestions pour une saisie. Moins de deux caracteres ne disent rien :
 * liste vide.
 *
 * Le classement prefere ce qui **commence** par la saisie (« Rou » propose
 * Rouen avant Saint-Pierre-de-Rouvray), puis l'effectif. Un edifice doit
 * contenir tous les mots, dans n'importe quel ordre, comme le filtre de titre.
 */
export async function suggestions(saisie: string): Promise<Suggestion[]> {
  const terme = replier(saisie);
  if (terme.length < 2) return [];
  const contient = lit(`%${echapperLike(terme)}%`);
  const commence = lit(`${echapperLike(terme)}%`);
  const plie = (colonne: string) => `strip_accents(lower(${colonne}))`;
  const mots = terme.split(/\s+/).filter(Boolean);
  const tousLesMots = mots.map((mot) => `search_key LIKE ${lit(`%${echapperLike(mot)}%`)} ESCAPE '\\'`).join(' AND ');

  const lieu = (genre: Genre, colonne: string, precision: string, plafond: number) => `
    (SELECT '${genre}' AS genre, ${colonne} AS libelle, ${precision} AS precision, count(*)::INT AS n,
            min(lon)::DOUBLE AS o, min(lat)::DOUBLE AS s, max(lon)::DOUBLE AS e, max(lat)::DOUBLE AS nn,
            NULL::VARCHAR AS reference
     FROM monuments
     WHERE ${plie(colonne)} LIKE ${contient} ESCAPE '\\'
     GROUP BY ${colonne}${precision === 'NULL' ? '' : `, ${precision}`}
     ORDER BY (${plie(colonne)} LIKE ${commence} ESCAPE '\\') DESC, n DESC, libelle
     LIMIT ${plafond})`;

  const categorie = (genre: Genre, colonne: string) => `
    (SELECT '${genre}' AS genre, valeur AS libelle, NULL AS precision, count(*)::INT AS n,
            NULL::DOUBLE AS o, NULL::DOUBLE AS s, NULL::DOUBLE AS e, NULL::DOUBLE AS nn,
            NULL::VARCHAR AS reference
     FROM (SELECT unnest(${colonne}) AS valeur FROM monuments)
     WHERE ${plie('valeur')} LIKE ${contient} ESCAPE '\\'
     GROUP BY valeur
     ORDER BY (${plie('valeur')} LIKE ${commence} ESCAPE '\\') DESC, n DESC, libelle
     LIMIT ${PLAFONDS.categorie})`;

  const lignes = await query<LigneBrute>(`
    ${lieu('commune', 'commune', 'departement_nom', PLAFONDS.commune)}
    UNION ALL ${lieu('departement', 'departement_nom', 'region', PLAFONDS.departement)}
    UNION ALL ${lieu('region', 'region', 'NULL', PLAFONDS.region)}
    UNION ALL
    (SELECT 'edifice' AS genre, titre AS libelle, commune AS precision, nb_palissy::INT AS n,
            lon::DOUBLE AS o, lat::DOUBLE AS s, lon::DOUBLE AS e, lat::DOUBLE AS nn, reference
     FROM monuments
     WHERE ${tousLesMots}
     ORDER BY (${plie('titre')} LIKE ${commence} ESCAPE '\\') DESC, nb_palissy DESC, titre
     LIMIT ${PLAFONDS.edifice})
    UNION ALL ${categorie('denomination', 'denominations')}
    UNION ALL ${categorie('domaine', 'domaines')}
    UNION ALL ${categorie('auteur', 'auteurs')}
  `);

  return lignes.map((l) => ({
    genre: l.genre,
    libelle: l.libelle,
    precision: l.precision,
    n: l.n,
    bornes: l.o !== null && l.s !== null && l.e !== null && l.nn !== null ? [l.o, l.s, l.e, l.nn] : null,
    reference: l.reference
  }));
}
