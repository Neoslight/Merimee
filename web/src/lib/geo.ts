/**
 * Distance haversine en metres.
 *
 * Meme formule que `distanceSql` dans `queries.ts`, qui trie la liste : la
 * fiche et la ligne de liste d'une meme notice doivent annoncer la meme
 * distance.
 */
export function distanceMetres(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(a)));
}
