/**
 * Localisation d'une notice dans les fragments de `details`.
 *
 * duckdb-wasm telecharge tout fichier Parquet en entier : ni `directIO` ni une
 * URL absolue passee a `read_parquet` ne declenchent de requete Range (verifie
 * en navigateur sur la version 1.32). Le fichier est donc la seule granularite
 * de chargement disponible, d'ou l'eclatement en 32 fragments.
 *
 * Le hachage est reproduit a l'identique dans `etl/merimee_etl/build.py` :
 * aucun index n'a besoin d'etre telecharge pour savoir ou chercher.
 */
export const NB_FRAGMENTS = 32;

/** FNV-1a 32 bits. */
export function fnv1a(texte: string): number {
  let h = 0x811c9dc5;
  const octets = new TextEncoder().encode(texte);
  for (const octet of octets) {
    h ^= octet;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function fragmentDe(reference: string): number {
  return fnv1a(reference) % NB_FRAGMENTS;
}
