/**
 * Bootstrap DuckDB-Wasm.
 *
 * Le bundle retenu est `eh` (exception handling, mono-thread) et non `coi` :
 * le bundle multi-thread exige les en-tetes COOP/COEP, qu'un hebergement
 * statique ne peut pas poser. Sur 46 760 lignes le mono-thread repond en
 * quelques millisecondes, la contrainte ne coute rien.
 *
 * Les bundles sont servis localement (imports Vite `?url`) plutot que depuis
 * jsDelivr : pas de dependance a un CDN tiers a l'execution.
 */
import * as duckdb from '@duckdb/duckdb-wasm';
import ehWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import { base } from '$app/paths';

export type Row = Record<string, any>;

let ready: Promise<duckdb.AsyncDuckDBConnection> | null = null;
let instance: duckdb.AsyncDuckDB | null = null;

const fichier = (chemin: string) => new URL(`${base}/data/${chemin}`, location.href).href;

async function boot(): Promise<duckdb.AsyncDuckDBConnection> {
  const worker = new Worker(ehWorker);
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  await db.instantiate(ehWasm);
  instance = db;

  for (const nom of ['monuments.parquet', 'protections.parquet']) {
    await db.registerFileURL(nom, fichier(nom), duckdb.DuckDBDataProtocol.HTTP, false);
  }

  const conn = await db.connect();
  // Les deux tables chaudes sont materialisees : 2,7 Mo au total, sollicites
  // par chaque interaction.
  await conn.query(`CREATE TABLE monuments AS SELECT * FROM read_parquet('monuments.parquet')`);
  await conn.query(`CREATE TABLE protections AS SELECT * FROM read_parquet('protections.parquet')`);
  return conn;
}

export function connection(): Promise<duckdb.AsyncDuckDBConnection> {
  ready ??= boot();
  return ready;
}

const fragmentsCharges = new Set<number>();

/**
 * Enregistre a la demande le fragment de `details` contenant une notice, et
 * renvoie le nom sous lequel l'interroger.
 *
 * Chaque fragment pese ~320 Ko et n'est telecharge qu'une fois : consulter
 * une fiche ne rapatrie pas les 10 Mo de textes longs.
 */
export async function fragmentDetails(numero: number): Promise<string> {
  await connection();
  const nom = `details_${numero}.parquet`;
  if (!fragmentsCharges.has(numero)) {
    await instance!.registerFileURL(
      nom,
      fichier(`details/${numero}.parquet`),
      duckdb.DuckDBDataProtocol.HTTP,
      false
    );
    fragmentsCharges.add(numero);
  }
  return nom;
}

/** Execute une requete et renvoie des objets JS simples. */
export async function query<T = Row>(sql: string): Promise<T[]> {
  const conn = await connection();
  const table = await conn.query(sql);
  return table.toArray().map((row) => row.toJSON() as T);
}

/** Litteral SQL echappe. */
export function lit(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Liste SQL de chaines : `['a', 'b']`. */
export function litList(values: readonly string[]): string {
  return `[${values.map(lit).join(', ')}]`;
}
