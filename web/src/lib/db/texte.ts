/**
 * Recherche plein texte dans les historiques, scoree BM25.
 *
 * L'index est **precalcule par l'ETL** (`etl/merimee_etl/texte.py`) et expedie
 * en trois Parquet. Le navigateur ne l'indexe pas : il faudrait pour cela
 * rapatrier les 32 fragments `details` (12 Mo), et le bundle `eh` est
 * mono-thread. Ici, il ne fait que resoudre des mots en identifiants entiers,
 * puis compter et scorer.
 *
 * Le **lexique** est ce qui dispense d'un stemmer dans le bundle : l'index
 * porte des radicaux Snowball (`jub`, `machicoul`), et le lexique y rattache
 * toutes les formes du corpus. `mascaron` et `mascarons` designent donc le meme
 * terme sans une ligne de linguistique cote client.
 *
 * Les trois fichiers pesent 3,8 Mo : ils ne sont demandes qu'au premier usage
 * du mode « historiques », jamais au demarrage.
 */
import { enregistrer, lit, query } from './duckdb';

const POSTINGS = 'texte_postings.parquet';
const LEXIQUE = 'texte_lexique.parquet';
const DOCS = 'texte_docs.parquet';

/** Constantes BM25 usuelles. `1 - B` et `K1 + 1` sont precalcules parce qu'ils
 *  partent tels quels dans le SQL. */
const K1 = 1.2;
const B = 0.75;

/** Statistiques du corpus indexe, lues une fois au chargement. */
export interface StatsTexte {
  /** Notices portant un historique : 24 819 sur 46 760. */
  n: number;
  /** Longueur moyenne, en mots. */
  avgdl: number;
}

/**
 * Rend l'index interrogeable et renvoie ses statistiques.
 *
 * L'absence des fichiers n'est pas une anomalie : l'ETL ne les ecrit pas quand
 * l'extension `fts` n'est pas chargeable. L'appelant bascule alors le bouton
 * hors service plutot que d'echouer.
 */
export async function chargerIndex(): Promise<StatsTexte> {
  await Promise.all([
    enregistrer(POSTINGS, 'texte/postings.parquet'),
    enregistrer(LEXIQUE, 'texte/lexique.parquet'),
    enregistrer(DOCS, 'texte/docs.parquet')
  ]);
  const [stats] = await query<StatsTexte>(`
    SELECT count(*)::INT AS n, avg(longueur)::DOUBLE AS avgdl
    FROM read_parquet('${DOCS}')
  `);
  return stats;
}

/**
 * Identifiants de terme des mots saisis, dans l'ordre de la saisie.
 *
 * Un mot absent du lexique n'existe dans aucun historique : il ressort en
 * `null`, pour que l'interface puisse le nommer au lieu de rendre zero
 * resultat, indiscernable d'un filtre trop serre.
 */
export async function resoudre(mots: readonly string[]): Promise<(number | null)[]> {
  if (!mots.length) return [];
  const lignes = await query<{ forme: string; terme: number }>(`
    SELECT forme, terme FROM read_parquet('${LEXIQUE}')
    WHERE forme IN (${mots.map(lit).join(', ')})
  `);
  const table = new Map(lignes.map((l) => [l.forme, l.terme]));
  return mots.map((mot) => table.get(mot) ?? null);
}

/**
 * Predicat d'appartenance, en entiers seuls.
 *
 * Semantique **ET** : tous les termes doivent etre presents, comme la recherche
 * par titre. D'ou le `HAVING`, et d'ou l'absence de tout seuil de frequence
 * dans l'index — couper les mots courants ferait echouer « eglise romane » sur
 * son premier mot.
 */
export function clauseTexte(termes: readonly number[]): string {
  const liste = termes.join(', ');
  return `reference IN (
    SELECT d.reference
    FROM read_parquet('${POSTINGS}') p
    JOIN read_parquet('${DOCS}') d USING (doc)
    WHERE p.terme IN (${liste})
    GROUP BY d.reference HAVING count(DISTINCT p.terme) = ${termes.length}
  )`;
}

/**
 * Sous-requete `(reference, score)` pour ordonner la liste.
 *
 * Le classement ne sert que la vue liste : la carte et les facettes n'ont
 * besoin que de l'appartenance. `df` se compte au vol sur les memes groupes de
 * lignes que le predicat vient de lire, plutot que d'etre expedie en quatrieme
 * colonne d'un fichier.
 */
export function scoreTexte(termes: readonly number[], stats: StatsTexte): string {
  const liste = termes.join(', ');
  return `(
    WITH pertinents AS (
      SELECT terme, doc, tf FROM read_parquet('${POSTINGS}') WHERE terme IN (${liste})
    ),
    frequences AS (SELECT terme, count(*)::INT AS df FROM pertinents GROUP BY 1)
    SELECT d.reference,
           sum(
             ln((${stats.n} - f.df + 0.5) / (f.df + 0.5) + 1)
             * (p.tf * ${K1 + 1})
             / (p.tf + ${K1} * (${1 - B} + ${B} * d.longueur / ${stats.avgdl}))
           ) AS score
    FROM pertinents p
    JOIN frequences f USING (terme)
    JOIN read_parquet('${DOCS}') d USING (doc)
    GROUP BY d.reference
  )`;
}
