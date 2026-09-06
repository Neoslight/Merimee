/** Requetes du tableau de bord. Un scan complet coute ~46 760 lignes : inutile
 *  de materialiser des vues intermediaires, DuckDB repond en quelques ms. */
import { fragmentDetails, query, queryArrow, lit } from './duckdb';
import { scoreTexte } from './texte';
import { indexTexte } from '$lib/state/texte.svelte';
import { fragmentDe } from './shards';
import {
  buildWhere,
  replier,
  termesTexte,
  type FacetKey,
  type Filters
} from '$lib/state/filters.svelte';
import { mesures } from '$lib/state/mesures.svelte';

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

/**
 * Le nuage de points, rendu **deja en GeoJSON**.
 *
 * La carte en est le seul consommateur : fabriquer d'abord 44 484 objets
 * `Point` que personne d'autre ne lit etait le poste dominant de tout le cycle
 * de filtrage — 52 ms de conversion Arrow puis 75 ms de `FeatureCollection`,
 * contre 13 ms de SQL et 15 ms de rendu. Un seul jeu d'objets est desormais
 * construit, directement depuis les vecteurs colonnes.
 *
 * Le parcours se fait **lot par lot**, et non par `table.getChild(...)` :
 * DuckDB renvoie une vingtaine de fragments, et `toArray()` sur le vecteur
 * d'un seul fragment rend une **vue** du tampon, pas une copie. Les
 * coordonnees et les comptes ne sont donc jamais recopies ; seules les chaines
 * sont decodees, parce qu'elles doivent exister — la reference identifie la
 * notice au clic.
 *
 * Les types sont fixes en SQL (`::DOUBLE`, `::INT`) plutot que devines a la
 * lecture : un `BIGINT` rendrait un `BigInt64Array`, dont les valeurs sont des
 * `bigint` que les expressions MapLibre ne savent pas comparer.
 */
export async function points(f: Filters): Promise<GeoJSON.FeatureCollection> {
  const table = await queryArrow(`
    SELECT reference, lon::DOUBLE AS lon, lat::DOUBLE AS lat, statut,
           nb_palissy::INT AS nb, siecle_max::INT AS siecle
    FROM monuments
    WHERE lat IS NOT NULL AND ${buildWhere(f)}
  `);
  const t0 = performance.now();
  const features: GeoJSON.Feature[] = new Array(table.numRows);
  let i = 0;
  for (const lot of table.batches) {
    const lon = lot.getChild('lon')!.toArray() as Float64Array;
    const lat = lot.getChild('lat')!.toArray() as Float64Array;
    const nb = lot.getChild('nb')!.toArray() as Int32Array;
    const reference = lot.getChild('reference')!;
    const statut = lot.getChild('statut')!;
    // Le siecle est nullable et le tampon porte 0 la ou la notice n'en indexe
    // aucun : seul `get` distingue « XXe » de « non renseigne ».
    const siecle = lot.getChild('siecle')!;
    for (let j = 0; j < lot.numRows; j++, i++) {
      const ref = reference.get(j) as string;
      features[i] = {
        type: 'Feature',
        id: ref,
        geometry: { type: 'Point', coordinates: [lon[j], lat[j]] },
        properties: {
          reference: ref,
          statut: statut.get(j),
          nb: nb[j],
          siecle: siecle.get(j)
        }
      };
    }
  }
  mesures.collection = performance.now() - t0;
  mesures.n = features.length;
  return { type: 'FeatureCollection', features };
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

/** Valeurs cochees d'une facette. Les cles scalaires du filtre (`nbPalissy`,
 *  `recherche`, `bbox`, `anneeProtection`) ne sont jamais facettees : le test
 *  de tableau suffit a les ecarter. */
function selectionnees(f: Filters, cle: FacetKey): string[] {
  const valeur = (f as unknown as Record<string, unknown>)[cle];
  return Array.isArray(valeur) ? (valeur as string[]) : [];
}

/**
 * Comptes d'une facette, evaluee sans son propre filtre : les options non
 * selectionnees gardent ainsi un compte exploitable.
 *
 * `terme` fouille le vocabulaire complet cote DuckDB. Le filtrer en JavaScript
 * sur la liste renvoyee ne verrait que `limite` valeurs : 7 000 des 7 040
 * auteurs du corpus tombent hors du plafond, et 5 607 n'ont qu'une notice.
 * `strip_accents` evite d'avoir a stocker une colonne repliee en plus.
 */
export async function facette(
  f: Filters,
  cle: FacetKey,
  limite = 40,
  terme = ''
): Promise<Compte[]> {
  const source = sourceFacette(cle, buildWhere(f, cle));

  // Une valeur cochee reste listee meme hors resultat, sinon saisir un terme
  // rendrait impossible de la decocher.
  const choisies = selectionnees(f, cle);
  const epinglee = choisies.length ? `valeur IN (${choisies.map(lit).join(', ')})` : 'FALSE';

  // `%` et `_` saisis par l'utilisateur sont des jokers LIKE : les neutraliser.
  const motif = replier(terme).replace(/[\\%_]/g, (c) => `\\${c}`);
  const cherche = motif
    ? `strip_accents(lower(valeur)) LIKE ${lit(`%${motif}%`)} ESCAPE '\\'`
    : 'TRUE';

  return query<Compte>(`
    SELECT valeur, count(*)::INT AS n
    FROM ${source}
    WHERE valeur IS NOT NULL AND valeur <> '' AND (${epinglee} OR ${cherche})
    GROUP BY 1
    ORDER BY (${epinglee}) DESC, n DESC, valeur ASC
    LIMIT ${limite}
  `);
}

/** Cles facettables, dans l'ordre d'affichage du panneau. */
const FACETTABLES: FacetKey[] = [
  'statut', 'domaines', 'denominations', 'regions',
  'departements', 'auteurs', 'proprietaires', 'periodes'
];

/** Source d'une facette : la colonne scalaire, ou la colonne `LIST` deroulee. */
function sourceFacette(cle: FacetKey, where: string): string {
  const liste = LISTES[cle];
  return liste
    ? `(SELECT unnest(${liste}) AS valeur FROM monuments WHERE ${where})`
    : `(SELECT ${SCALAIRES[cle]} AS valeur FROM monuments WHERE ${where})`;
}

/**
 * Nombre de valeurs distinctes par facette, filtres courants appliques —
 * **chacune sans le sien**, comme `facette()` : sinon cocher une valeur ferait
 * tomber la cardinalite a 1 et le nombre ne dirait plus rien.
 *
 * C'est ce qui rend visible le plafond des 40 valeurs : « 40 sur 7 040 » dit
 * ce que la liste cache, la liste seule ne le disait pas.
 *
 * Huit balayages de 46 760 lignes en un seul aller-retour : DuckDB les enchaine
 * en quelques millisecondes, et une requete par facette couterait huit
 * allers-retours pour le meme travail.
 */
export async function cardinalites(f: Filters): Promise<Partial<Record<FacetKey, number>>> {
  const morceaux = FACETTABLES.map(
    (cle) => `SELECT ${lit(cle)} AS cle, count(DISTINCT valeur)::INT AS n
              FROM ${sourceFacette(cle, buildWhere(f, cle))}
              WHERE valeur IS NOT NULL AND valeur <> ''`
  );
  const lignes = await query<{ cle: FacetKey; n: number }>(morceaux.join(' UNION ALL '));
  return Object.fromEntries(lignes.map((l) => [l.cle, l.n]));
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

export interface Cellule {
  siecle: number;
  decennie: number;
  n: number;
}

export interface Matrice {
  cellules: Cellule[];
  /** Occurrences anterieures au 10e siecle, hors des axes. Signalees, pas tues. */
  ecartees: number;
}

/** En deca, les effectifs sont anecdotiques (341 occurrences pour neuf siecles)
 *  et neuf lignes presque vides ecraseraient la partie lisible. */
export const SIECLE_MATRICE_MIN = 10;

/**
 * Croisement epoque de construction x decennie de protection : ce que les deux
 * frises suggerent cote a cote sans jamais le montrer ensemble.
 *
 * Les couples sont dedoublonnes. Sans `DISTINCT`, une notice portant deux actes
 * dans la meme decennie compterait deux fois dans la meme cellule.
 *
 * Les deux filtres d'axe sont retires du predicat, comme une facette est
 * comptee sans elle-meme : la matrice reste explorable une fois une cellule
 * choisie.
 */
export async function matrice(f: Filters): Promise<Matrice> {
  const where = buildWhere(f, ['siecles', 'anneeProtection']);
  const couples = `
    SELECT DISTINCT s.reference, s.siecle, (p.annee // 10) * 10 AS decennie
    FROM (SELECT reference, unnest(siecles) AS siecle FROM monuments WHERE ${where}) s
    JOIN protections p USING (reference)
    WHERE p.annee IS NOT NULL
  `;
  const [cellules, [reste]] = await Promise.all([
    query<Cellule>(`
      SELECT siecle::INT AS siecle, decennie::INT AS decennie, count(*)::INT AS n
      FROM (${couples}) WHERE siecle >= ${SIECLE_MATRICE_MIN}
      GROUP BY 1, 2 ORDER BY 1, 2
    `),
    query<{ n: number }>(`
      SELECT count(*)::INT AS n FROM (${couples}) WHERE siecle < ${SIECLE_MATRICE_MIN}
    `)
  ]);
  return { cellules, ecartees: reste?.n ?? 0 };
}

export interface Ligne {
  reference: string;
  titre: string;
  commune: string;
  departement_nom: string;
  statut: string;
  nb_palissy: number;
}

/** Sous-requete de classement, `null` des que le mode plein texte n'est pas
 *  actif ou que rien n'a ete resolu. */
function ordreTexte(f: Filters): string | null {
  const termes = termesTexte();
  if (!f.texte || !termes?.length || !indexTexte.stats) return null;
  return scoreTexte(termes, indexTexte.stats);
}

/**
 * Liste laterale : inclut les 2 276 notices sans coordonnees, absentes de la carte.
 *
 * En mode plein texte l'ordre change : c'est le seul endroit ou le classement
 * BM25 se voit. La carte et les facettes n'ont besoin que de l'appartenance,
 * et scorer pour elles serait payer un tri que personne ne lit.
 */
export async function liste(f: Filters, limite = 200): Promise<Ligne[]> {
  const ordre = ordreTexte(f);
  if (ordre) {
    return query<Ligne>(`
      SELECT m.reference, m.titre, m.commune, m.departement_nom, m.statut, m.nb_palissy
      FROM monuments m JOIN ${ordre} s USING (reference)
      WHERE ${buildWhere(f)}
      ORDER BY s.score DESC, m.titre ASC LIMIT ${limite}
    `);
  }
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
  renvois: string[];
  /** Noms de fichiers Wikimedia Commons, au plus trois. Vides si l'instantane
   *  Wikidata n'a pas ete produit : la fiche s'en passe sans rien afficher. */
  commons: string[];
  /** Nombre de photographies Memoire sur POP. Elles ne sont pas reprises :
   *  sous droits reserves, la fiche n'en fait qu'un renvoi. */
  memoire: number;
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
           d.renvois, d.commons, d.memoire, d.auteurs_detail
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
    renvois: toArray<string>(ligne.renvois),
    commons: toArray<string>(ligne.commons),
    memoire: Number(ligne.memoire ?? 0),
    actes: actes as unknown as Detail['actes']
  };
}

/**
 * Une notice au hasard parmi celles dont l'historique est renseigne.
 *
 * `ORDER BY random() LIMIT 1` et non `USING SAMPLE 1 ROWS` : l'echantillon
 * passe **sous** le filtre dans le plan, il tirait donc une ligne de la table
 * entiere puis lui appliquait le predicat. `has_historique` ne couvrant que
 * 24 819 notices sur 46 760, le bouton rendait `null` une fois sur deux —
 * mesure : trois clics muets sur cinq. Le tri sur 46 760 lignes ne coute rien
 * a cote d'un bouton qui ne repond pas.
 */
export async function auHasard(f: Filters): Promise<string | null> {
  const [row] = await query<{ reference: string }>(`
    SELECT reference FROM monuments
    WHERE has_historique AND ${buildWhere(f)}
    ORDER BY random() LIMIT 1
  `);
  return row?.reference ?? null;
}
