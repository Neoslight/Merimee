/**
 * Chronometrage de la chaine qui va d'une requete SQL aux points affiches.
 *
 * Raison d'etre : la question « 44 000 points, est-ce trop ? » n'avait jamais
 * ete tranchee que par intuition. La mesure a repondu, sur le corpus entier :
 * **SQL 13 ms, fabrication d'objets 127 ms, rendu 15 ms**. MapLibre dessine ses
 * cercles en WebGL et non dans le DOM — la saturation qu'on redoute d'ordinaire
 * n'existe pas a cet endroit — tandis que 81 % du temps partait en allocation
 * JavaScript, deux jeux de 44 484 objets : un par `row.toJSON()`, un autre par
 * la `FeatureCollection`.
 *
 * D'ou le correctif que ces chiffres ont designe, et lui seul : `points()` lit
 * les vecteurs colonnes Arrow et ne construit plus qu'un jeu d'objets. Les deux
 * autres pistes restent ecartees — agreger en grille cote SQL ne servirait a
 * rien tant que `sql` pese 13 ms, et changer de moteur de rendu encore moins
 * tant que `rendu` en pese 15.
 *
 * Le releve reste en place pour que la regression se voie : trois appels a
 * `performance.now()` par cycle, cout nul devant ce qu'ils mesurent, actifs en
 * production plutot que caches derriere un drapeau de developpement, ou ils ne
 * diraient rien des machines reelles.
 */
import { browser } from '$app/environment';

export interface Mesures {
  /** `conn.query(sql)` seul : moteur DuckDB, hors lecture des vecteurs. */
  sql: number;
  /** Vecteurs Arrow -> `FeatureCollection`, en une passe. */
  collection: number;
  /** `setData` sur la source MapLibre. */
  rendu: number;
  /** Nombre de points du dernier cycle, pour rapporter les durees au volume. */
  n: number;
}

export const mesures = $state<Mesures>({ sql: 0, collection: 0, rendu: 0, n: 0 });

// Publie sur `window` : c'est le seul chemin par lequel le smoke test peut lire
// le releve, un module Svelte n'etant pas atteignable depuis Playwright.
if (browser) (window as unknown as { __mesures: Mesures }).__mesures = mesures;
