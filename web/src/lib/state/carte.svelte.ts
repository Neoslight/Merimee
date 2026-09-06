/**
 * Ce que la carte a effectivement peint, pour que le smoke test puisse le lire.
 *
 * Deux valeurs, et une seule raison d'exister : elles sont **invisibles
 * autrement**. Le fond clair est repeint couche par couche (`lib/teinte.ts`) et
 * la rampe de densite est posee dans MapLibre, qui n'expose ni l'un ni l'autre
 * au DOM. Un repeint devenu inoperant — CARTO renomme ses couches — ne leverait
 * aucune erreur : la carte ressortirait presque juste, et rien ne le dirait.
 * C'est ce silence que ce releve rompt.
 *
 * Le detail par nature n'est pas du zele : une assertion sur un total passerait
 * encore le jour ou les frontieres cesseraient d'etre reconnues et tomberaient
 * dans la branche par defaut. Le smoke test **imprime** ce decompte, pour qu'un
 * releve aberrant se voie meme quand l'assertion passe.
 *
 * Module a part de `mesures.svelte.ts`, qui chronometre la chaine des points :
 * y ranger un etat de peinture melangerait deux questions sans rapport.
 */
import { browser } from '$app/environment';
import type { Teinture } from '$lib/teinte';

export interface EtatCarte {
  /** Couches du fond repeintes au dernier `style.load`. Tout a zero en theme
   *  sombre, ou dark-matter est pris tel quel. */
  teinture: Teinture;
  /** Haut de la rampe de densite effectivement injectee dans MapLibre. La
   *  legende lit la meme valeur : les deux doivent s'accorder. */
  chaleurHaute: string;
}

const VIDE: Teinture = { terre: 0, mer: 0, trait: 0, libelle: 0, detail: 0, ignorees: 0 };

export const etatCarte = $state<EtatCarte>({ teinture: { ...VIDE }, chaleurHaute: '' });

export function oublierTeinture() {
  etatCarte.teinture = { ...VIDE };
}

// Publie sur `window`, comme le releve de `mesures` : c'est le seul chemin par
// lequel Playwright peut atteindre un module Svelte.
if (browser) (window as unknown as { __carte: EtatCarte }).__carte = etatCarte;
