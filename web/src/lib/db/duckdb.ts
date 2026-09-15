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

/**
 * Resout l'URL du wasm a passer a `instantiate`.
 *
 * `precharger.mjs` pose un `<link rel="preload" as="fetch" crossorigin>` sur
 * ce meme fichier dans le shell HTML, pour que le telechargement parte des
 * l'analyse de la page plutot qu'apres coup. Mais `instantiate()` fait fetch
 * le wasm **depuis le worker** — un contexte distinct du document, qui n'y
 * reprend pas toujours le prechargement : mesure (compteur d'octets serveur),
 * le binaire partait deux fois, une par le prechargement et une par le
 * worker. Le fetch est donc fait ici, dans le document — la ou le
 * prechargement est repris de facon fiable — puis converti en URL `blob:`
 * que le worker peut fetch localement, sans repartir sur le reseau.
 *
 * Un echec (reseau, blob non supporte) retombe sur l'URL directe : le worker
 * la fetchera lui-meme, exactement comme avant ce dispositif.
 */
async function urlWasmPrechargee(): Promise<string> {
  try {
    const reponse = await fetch(ehWasm);
    if (!reponse.ok) return ehWasm;
    const octets = await reponse.arrayBuffer();
    // Le type doit etre pose explicitement : une URL `blob:` fetchee rend un
    // Content-Type tire du `Blob` lui-meme, et `instantiateStreaming` exige
    // `application/wasm` pour eviter de retomber sur la voie lente.
    return URL.createObjectURL(new Blob([octets], { type: 'application/wasm' }));
  } catch {
    return ehWasm;
  }
}

async function boot(): Promise<duckdb.AsyncDuckDBConnection> {
  const worker = new Worker(ehWorker);
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  const urlWasm = await urlWasmPrechargee();
  try {
    await db.instantiate(urlWasm);
  } finally {
    if (urlWasm !== ehWasm) URL.revokeObjectURL(urlWasm);
  }
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

// La promesse est memoisee, pas seulement le resultat : entre deux appels
// concurrents sur le meme nom, le second doit trouver l'enregistrement deja
// en vol et l'attendre, pas en relancer un second. Peupler un `Set` apres coup
// laissait une fenetre ouverte tant que l'`await` de `registerFileURL` durait —
// deux appels partis avant qu'elle se referme enregistraient deux fois le
// meme fichier.
const enregistres = new Map<string, Promise<void>>();

/**
 * Rend un fichier de `static/data/` interrogeable sous le nom `nom`, une fois.
 *
 * duckdb-wasm telecharge tout Parquet en entier, mais **une seule fois** : le
 * tampon reste ensuite en memoire, et `read_parquet` sur le meme nom ne ressort
 * plus sur le reseau. C'est ce qui rend acceptables les chargements a la
 * demande — un fragment de fiche, l'index plein texte.
 */
export function enregistrer(nom: string, chemin: string): Promise<void> {
  let promesse = enregistres.get(nom);
  if (promesse) return promesse;
  promesse = (async () => {
    await connection();
    await instance!.registerFileURL(nom, fichier(chemin), duckdb.DuckDBDataProtocol.HTTP, false);
  })().catch((e) => {
    // Echec (404, reseau) : retirer l'entree pour qu'un prochain appel puisse
    // retenter, plutot que de rester coince sur une promesse rejetee a vie.
    enregistres.delete(nom);
    throw e;
  });
  enregistres.set(nom, promesse);
  return promesse;
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

/**
 * Echappe `%`, `_` et l'antislash lui-meme pour un usage dans un `LIKE`.
 *
 * Sans cela, un `%` ou un `_` saisi par l'utilisateur redevient un joker : une
 * recherche de commune sur « saint_denis » retomberait sur toute commune dont
 * le neuvieme caractere est quelconque. A utiliser avec `ESCAPE '\\'` cote SQL —
 * DuckDB n'interprete pas l'antislash dans un litteral standard, verifie a
 * l'execution, donc `lit()` seul ne suffit pas a le poser.
 */
export function echapperLike(motif: string): string {
  return motif.replace(/[\\%_]/g, (c) => `\\${c}`);
}
