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
 * Cle canonique d'un jeu de termes : l'ordre de saisie ne doit pas produire
 * deux tables pour le meme ensemble — « nef eglise » et « eglise nef »
 * partagent la meme.
 */
function cleTermes(termes: readonly number[]): string {
  return [...termes].sort((a, b) => a - b).join(',');
}

/** Nom de table deterministe : aucun aller-retour n'est necessaire pour le
 *  retrouver, `clauseTexte` le recalcule sans jamais interroger DuckDB.
 *  Les identifiants sont ecrits en clair, pas haches : avec `IF NOT EXISTS`,
 *  une collision de hachage rendrait en silence les notices d'un autre jeu
 *  de termes. */
function nomTable(cle: string): string {
  return `texte_sel_${cle.replaceAll(',', '_')}`;
}

/**
 * Tables temporaires deja posees, en ordre d'utilisation (la plus ancienne en
 * tete). `Map` conserve l'ordre d'insertion, et reinserer une cle deplacee en
 * fin suffit a en faire une file LRU.
 */
const CAPACITE_CACHE = 8;
const cache = new Map<string, Promise<string>>();

/**
 * Materialise, si besoin, la table des references portant tous les `termes`
 * — c'est-a-dire le resultat que `clauseTexte` inlinait jusqu'ici dans
 * **chaque** requete du cycle : `totaux`, `points`, les huit facettes de
 * `cardinalites`, les deux histogrammes, `matrice`. Chacune reprenait le
 * scan `postings` + jointure `docs` + `GROUP BY/HAVING`, en mono-thread, sur
 * une connexion unique qui les serialise — mesure en duckdb Python sur les
 * Parquet de `texte/`, `SET threads=1` : cycle (points, totaux, cardinalites,
 * deux histogrammes) a 1/2/3 termes, clause inlinee **48 a 62 ms**, table
 * temporaire deja posee **29 a 45 ms** (22 a 44 % de moins), et **17 a 35 %**
 * de moins meme en comptant la creation de la table dans le premier cycle.
 *
 * `CREATE TEMP TABLE IF NOT EXISTS` : deux resolutions concurrentes du meme
 * jeu de termes (double frappe) ne doivent pas relancer le calcul deux fois,
 * la promesse memoisee dans `cache` suffit deja a l'eviter, mais la garde
 * cote SQL protege aussi un appel qui contournerait le cache.
 */
async function materialiser(termes: readonly number[]): Promise<string> {
  const cle = cleTermes(termes);
  const existante = cache.get(cle);
  if (existante) {
    // Deplace en fin : c'est desormais l'entree la plus recemment utilisee.
    cache.delete(cle);
    cache.set(cle, existante);
    return existante;
  }
  const nom = nomTable(cle);
  const promesse = (async () => {
    await query(`
      CREATE TEMP TABLE IF NOT EXISTS ${nom} AS
      SELECT d.reference
      FROM read_parquet('${POSTINGS}') p
      JOIN read_parquet('${DOCS}') d USING (doc)
      WHERE p.terme IN (${termes.join(', ')})
      GROUP BY d.reference HAVING count(DISTINCT p.terme) = ${termes.length}
    `);
    return nom;
  })().catch((e) => {
    // Echec (index pas encore enregistre, requete annulee) : ne pas laisser
    // une entree rejetee bloquer toute tentative suivante sur ce jeu de termes.
    cache.delete(cle);
    throw e;
  });
  cache.set(cle, promesse);
  // Purge par le front de la Map — la plus ancienne — jamais l'entree qu'on
  // vient de poser, qui vient d'etre inseree en fin. Une requete perimee qui
  // viserait encore une table evincee echoue silencieusement : `echec()`
  // (`+page.svelte`) n'affiche une erreur que pour le cycle en cours, et
  // seules des tables plus anciennes que la selection courante sont evincees.
  while (cache.size > CAPACITE_CACHE) {
    const [plusAncienne] = cache.keys();
    const table = await cache.get(plusAncienne)!.catch(() => null);
    cache.delete(plusAncienne);
    if (table) query(`DROP TABLE IF EXISTS ${table}`).catch(() => {});
  }
  return promesse;
}

/**
 * A appeler avant `poserTermes` : la table doit exister avant que le predicat
 * qui la vise ne parte dans le cycle de requetes. `poserTermes` n'est donc
 * publie qu'une fois cette promesse resolue.
 */
export async function preparerClauseTexte(termes: readonly number[]): Promise<void> {
  if (termes.length) await materialiser(termes);
}

/**
 * Predicat d'appartenance, en entiers seuls.
 *
 * Semantique **ET** : tous les termes doivent etre presents, comme la recherche
 * par titre. D'ou le `HAVING`, calcule une fois par `materialiser` plutot qu'a
 * chaque requete — et d'ou l'absence de tout seuil de frequence dans l'index —
 * couper les mots courants ferait echouer « eglise romane » sur son premier mot.
 *
 * Purement synchrone : le nom de table est une fonction deterministe des
 * termes, `buildWhere` n'a donc pas a attendre DuckDB pour le calculer. La
 * table elle-meme est garantie posee par `preparerClauseTexte`, appelee avant
 * que `termesResolus` ne soit publie.
 */
export function clauseTexte(termes: readonly number[]): string {
  return `reference IN (SELECT reference FROM ${nomTable(cleTermes(termes))})`;
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
