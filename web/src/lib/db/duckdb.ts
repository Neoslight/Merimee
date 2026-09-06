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
import type { Table } from 'apache-arrow';
import ehWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import { base } from '$app/paths';
import { amorcage } from '$lib/state/amorcage.svelte';
import { mesures } from '$lib/state/mesures.svelte';

export type Row = Record<string, any>;

let ready: Promise<duckdb.AsyncDuckDBConnection> | null = null;
let instance: duckdb.AsyncDuckDB | null = null;

const fichier = (chemin: string) => new URL(`${base}/data/${chemin}`, location.href).href;

async function boot(): Promise<duckdb.AsyncDuckDBConnection> {
  const worker = new Worker(ehWorker);
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  await db.instantiate(ehWasm);
  amorcage.phase = 'corpus';
  instance = db;

  for (const nom of ['monuments.parquet', 'protections.parquet']) {
    await db.registerFileURL(nom, fichier(nom), duckdb.DuckDBDataProtocol.HTTP, false);
  }

  const conn = await db.connect();
  // Les deux tables chaudes sont materialisees : 2,7 Mo au total, sollicites
  // par chaque interaction.
  await conn.query(`CREATE TABLE monuments AS SELECT * FROM read_parquet('monuments.parquet')`);
  await conn.query(`CREATE TABLE protections AS SELECT * FROM read_parquet('protections.parquet')`);
  amorcage.phase = 'pret';
  return conn;
}

export function connection(): Promise<duckdb.AsyncDuckDBConnection> {
  ready ??= boot();
  return ready;
}

const enregistres = new Set<string>();

/**
 * Rend un fichier de `static/data/` interrogeable sous le nom `nom`, une fois.
 *
 * duckdb-wasm telecharge tout Parquet en entier, mais **une seule fois** : le
 * tampon reste ensuite en memoire, et `read_parquet` sur le meme nom ne ressort
 * plus sur le reseau. C'est ce qui rend acceptables les chargements a la
 * demande — un fragment de fiche, l'index plein texte.
 */
export async function enregistrer(nom: string, chemin: string): Promise<void> {
  await connection();
  if (enregistres.has(nom)) return;
  await instance!.registerFileURL(nom, fichier(chemin), duckdb.DuckDBDataProtocol.HTTP, false);
  enregistres.add(nom);
}

/**
 * Enregistre a la demande le fragment de `details` contenant une notice, et
 * renvoie le nom sous lequel l'interroger.
 *
 * Chaque fragment pese ~320 Ko : consulter une fiche ne rapatrie pas les 10 Mo
 * de textes longs.
 */
export async function fragmentDetails(numero: number): Promise<string> {
  const nom = `details_${numero}.parquet`;
  await enregistrer(nom, `details/${numero}.parquet`);
  return nom;
}

/** Execute une requete et renvoie des objets JS simples. */
export async function query<T = Row>(sql: string): Promise<T[]> {
  const conn = await connection();
  const table = await conn.query(sql);
  return table.toArray().map((row) => row.toJSON() as T);
}

/**
 * Execute une requete et renvoie la table Arrow **sans la convertir**.
 *
 * Reservee au nuage de points, seule requete a ramener des dizaines de milliers
 * de lignes. La mesure avait tranche : sur 44 484 points, `conn.query` coutait
 * 13 ms quand la fabrication d'objets JavaScript en coutait 127 — un jeu par
 * `row.toJSON()`, un autre par la `FeatureCollection`. Lire les vecteurs
 * colonnes supprime le premier jeu entierement ; `queries.points()` construit
 * le second directement depuis eux.
 *
 * `mesures.sql` est pose ici, ou le moteur DuckDB est seul en cause.
 */
export async function queryArrow(sql: string): Promise<Table> {
  const conn = await connection();
  const t0 = performance.now();
  const table = await conn.query(sql);
  mesures.sql = performance.now() - t0;
  return table;
}

/** Litteral SQL echappe. */
export function lit(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Liste SQL de chaines : `['a', 'b']`. */
export function litList(values: readonly string[]): string {
  return `[${values.map(lit).join(', ')}]`;
}
