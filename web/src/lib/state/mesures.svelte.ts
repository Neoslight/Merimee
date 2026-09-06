/**
 * Chronometrage de la chaine qui va d'une requete SQL aux points affiches.
 *
 * Raison d'etre : la question « 44 000 points, est-ce trop ? » n'avait jamais
 * ete tranchee que par intuition. MapLibre rend ses cercles en WebGL et non
 * dans le DOM, donc la saturation qu'on redoute d'ordinaire n'existe pas a cet
 * endroit ; en revanche personne n'avait mesure ce que coute, **a chaque
 * changement de filtre**, la fabrication de deux jeux de 44 000 objets
 * JavaScript — un par `row.toJSON()`, un autre par la construction de la
 * `FeatureCollection`.
 *
 * Ces chiffres existent pour departager trois correctifs qui n'ont pas le meme
 * prix : lire les colonnes Arrow sans passer par des objets, agreger en grille
 * cote SQL, ou changer de moteur de rendu. Tant qu'ils ne sont pas releves,
 * aucun des trois ne se justifie.
 *
 * Quatre appels a `performance.now()` par cycle : le cout de la mesure est nul
 * devant ce qu'elle mesure. Elle reste donc active en production plutot que
 * cachee derriere un drapeau de developpement, ou elle ne dirait rien des
 * machines reelles.
 */
import { browser } from '$app/environment';

export interface Mesures {
  /** `conn.query(sql)` seul : moteur DuckDB, hors conversion. */
  sql: number;
  /** Vecteurs Arrow -> objets JavaScript. */
  conversion: number;
  /** Construction de la `FeatureCollection`. */
  geojson: number;
  /** `setData` sur la source MapLibre. */
  rendu: number;
  /** Nombre de points du dernier cycle, pour rapporter les durees au volume. */
  n: number;
}

export const mesures = $state<Mesures>({ sql: 0, conversion: 0, geojson: 0, rendu: 0, n: 0 });

// Publie sur `window` : c'est le seul chemin par lequel le smoke test peut lire
// le releve, un module Svelte n'etant pas atteignable depuis Playwright.
if (browser) (window as unknown as { __mesures: Mesures }).__mesures = mesures;

/** Total du dernier cycle : ce que l'utilisateur attend reellement. */
export function totalMesures(m: Mesures = mesures): number {
  return m.sql + m.conversion + m.geojson + m.rendu;
}
