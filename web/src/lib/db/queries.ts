/** Requetes du tableau de bord. Un scan complet coute ~46 760 lignes : inutile
 *  de materialiser des vues intermediaires, DuckDB repond en quelques ms. */
import { fragmentDetails, query, lit } from './duckdb';
import { fragmentDe } from './shards';
import { buildWhere, type FacetKey, type Filters } from '$lib/state/filters.svelte';

export interface Point {
  reference: string;
  lat: number;
  lon: number;
  statut: string;
  nb_palissy: number;
}

export interface Compte {
  valeur: string;
  n: number;
}

export interface Totaux {
  total: number;
  geolocalises: number;
  classes: number;
  inscrits: number;
  objets: number;
}

/** Les colonnes `LIST` se facettent par UNNEST, sans table de liaison. */
const LISTES: Partial<Record<FacetKey, string>> = {
  domaines: 'domaines',
  denominations: 'denominations',
  auteurs: 'auteurs',
  proprietaires: 'proprietaires',
  periodes: 'periodes'
};

const SCALAIRES: Partial<Record<FacetKey, string>> = {
  statut: 'statut',
  regions: 'region',
  departements: 'departement_nom'
};

export async function points(f: Filters): Promise<Point[]> {
  return query<Point>(`
    SELECT reference, lat, lon, statut, nb_palissy
    FROM monuments
    WHERE lat IS NOT NULL AND ${buildWhere(f)}
  `);
}

export async function totaux(f: Filters): Promise<Totaux> {
  const [row] = await query<Record<string, number>>(`
    SELECT count(*)::INT AS total,
           count(lat)::INT AS geolocalises,
           count(*) FILTER (statut IN ('classé', 'classé+inscrit'))::INT AS classes,
           count(*) FILTER (statut IN ('inscrit', 'classé+inscrit'))::INT AS inscrits,
           coalesce(sum(nb_palissy), 0)::INT AS objets
    FROM monuments WHERE ${buildWhere(f)}
  `);
  return row as unknown as Totaux;
}

/**
 * Comptes d'une facette, evaluee sans son propre filtre : les options non
 * selectionnees gardent ainsi un compte exploitable.
 */
export async function facette(f: Filters, cle: FacetKey, limite = 40): Promise<Compte[]> {
  const where = buildWhere(f, cle);
  const liste = LISTES[cle];
  const source = liste
    ? `(SELECT unnest(${liste}) AS valeur FROM monuments WHERE ${where})`
    : `(SELECT ${SCALAIRES[cle]} AS valeur FROM monuments WHERE ${where})`;
  return query<Compte>(`
    SELECT valeur, count(*)::INT AS n
    FROM ${source}
    WHERE valeur IS NOT NULL AND valeur <> ''
    GROUP BY 1 ORDER BY n DESC, valeur ASC LIMIT ${limite}
  `);
}

export interface BarreSiecle {
  siecle: number;
  n: number;
}

/** Axe 1 : epoque de construction. */
export async function histogrammeSiecles(f: Filters): Promise<BarreSiecle[]> {
  return query<BarreSiecle>(`
    SELECT siecle::INT AS siecle, count(*)::INT AS n
    FROM (SELECT unnest(siecles) AS siecle FROM monuments WHERE ${buildWhere(f, 'siecles')})
    WHERE siecle IS NOT NULL
    GROUP BY 1 ORDER BY 1
  `);
}

export interface BarreAnnee {
  annee: number;
  n: number;
}

/** Axe 2 : annee de l'arrete de protection (1840 -> 2026). */
export async function histogrammeProtections(f: Filters): Promise<BarreAnnee[]> {
  return query<BarreAnnee>(`
    SELECT annee::INT AS annee, count(*)::INT AS n
    FROM protections
    WHERE annee IS NOT NULL
      AND reference IN (SELECT reference FROM monuments WHERE ${buildWhere(f, 'anneeProtection')})
    GROUP BY 1 ORDER BY 1
  `);
}

export interface Ligne {
  reference: string;
  titre: string;
  commune: string;
  departement_nom: string;
  statut: string;
  nb_palissy: number;
}

/** Liste laterale : inclut les 2 276 notices sans coordonnees, absentes de la carte. */
export async function liste(f: Filters, limite = 200): Promise<Ligne[]> {
  return query<Ligne>(`
    SELECT reference, titre, commune, departement_nom, statut, nb_palissy
    FROM monuments WHERE ${buildWhere(f)}
    ORDER BY nb_palissy DESC, titre ASC LIMIT ${limite}
  `);
}

export interface Detail {
  reference: string;
  titre: string;
  commune: string;
  departement_nom: string;
  region: string;
  statut: string;
  partiel: boolean;
  nature_acte: string;
  siecles: number[];
  periodes: string[];
  domaines: string[];
  denominations: string[];
  auteurs_detail: string[];
  proprietaires: string[];
  adresse: string;
  lieudit: string;
  cadastre: string;
  historique: string;
  precision_protection: string;
  observations: string;
  siecle_detail: string;
  archiv_mh: string;
  liens_externes: string[];
  palissy: string[];
  nb_palissy: number;
  actes: { annee: number | null; mois: number | null; jour: number | null; libelle: string }[];
}

/** Arrow renvoie les colonnes `LIST` sous forme de vecteurs. */
function toArray<T>(value: unknown): T[] {
  if (!value) return [];
  if (Array.isArray(value)) return value as T[];
  const vector = value as { toArray?: () => ArrayLike<T> };
  return vector.toArray ? Array.from(vector.toArray()) : [];
}

/**
 * Fiche d'une notice. Seul le fragment de `details` qui la contient est
 * telecharge (~320 Ko), et une seule fois : le hachage de la reference donne
 * son numero sans index intermediaire.
 */
export async function detail(reference: string): Promise<Detail> {
  const ref = lit(reference);
  const fragment = await fragmentDetails(fragmentDe(reference));
  const [ligne] = await query(`
    SELECT m.reference, m.titre, m.commune, m.departement_nom, m.region, m.statut,
           m.partiel, m.nature_acte, m.siecles, m.periodes, m.domaines, m.denominations,
           m.proprietaires, m.nb_palissy,
           d.adresse, d.lieudit, d.cadastre, d.historique, d.precision_protection,
           d.observations, d.siecle_detail, d.archiv_mh, d.liens_externes, d.palissy,
           d.auteurs_detail
    FROM monuments m
    JOIN read_parquet('${fragment}') d USING (reference)
    WHERE m.reference = ${ref}
  `);
  const actes = await query(`
    SELECT annee, mois, jour, libelle FROM protections
    WHERE reference = ${ref} ORDER BY annee NULLS LAST, mois NULLS LAST, jour NULLS LAST
  `);
  return {
    ...(ligne as unknown as Detail),
    siecles: toArray<number>(ligne.siecles),
    periodes: toArray<string>(ligne.periodes),
    domaines: toArray<string>(ligne.domaines),
    denominations: toArray<string>(ligne.denominations),
    proprietaires: toArray<string>(ligne.proprietaires),
    auteurs_detail: toArray<string>(ligne.auteurs_detail),
    liens_externes: toArray<string>(ligne.liens_externes),
    palissy: toArray<string>(ligne.palissy),
    actes: actes as unknown as Detail['actes']
  };
}

/** Une notice au hasard parmi celles dont l'historique est renseigne. */
export async function auHasard(f: Filters): Promise<string | null> {
  const [row] = await query<{ reference: string }>(`
    SELECT reference FROM monuments
    WHERE has_historique AND ${buildWhere(f)}
    USING SAMPLE 1 ROWS
  `);
  return row?.reference ?? null;
}
