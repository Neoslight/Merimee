/**
 * Libelles du fond de carte en francais.
 *
 * Les feuilles CARTO (positron, dark-matter) ecrivent `{name_en}` aux petites
 * echelles et `{name}` au-dela : « Germany », « Brittany », « Garonne River »
 * sur un site francais. Leurs tuiles portent pourtant `name:fr` (schema
 * OpenMapTiles, verifie sur les tuiles z5 et z8 de la France) : il suffit de
 * reecrire le champ de texte des couches de libelles. Le nom local reste en
 * repli — une rue n'a pas de `name:fr`, son nom est deja le bon.
 */
import type { ExpressionSpecification, Map as MapLibreMap } from 'maplibre-gl';

export const NOM_FRANCAIS: ExpressionSpecification = ['coalesce', ['get', 'name:fr'], ['get', 'name']];

/** Un champ de texte qui affiche un nom — `{name}`, `{name_en}`, ou une
 *  expression qui les lit —, et non un numero de rue ou une cote. */
export function afficheUnNom(champ: unknown): boolean {
  if (champ === undefined || champ === null) return false;
  return /\{name(_[a-z]+)?\}|"name(_[a-z]+)?"/.test(JSON.stringify(champ));
}

/** Reecrit en francais toutes les couches de libelles d'un style ; rend le
 *  nombre de couches reecrites. A rappeler apres chaque `setStyle`. */
export function franciser(map: MapLibreMap): number {
  let n = 0;
  for (const couche of map.getStyle().layers ?? []) {
    if (couche.type !== 'symbol') continue;
    if (!afficheUnNom(couche.layout?.['text-field'])) continue;
    map.setLayoutProperty(couche.id, 'text-field', NOM_FRANCAIS);
    n += 1;
  }
  return n;
}
