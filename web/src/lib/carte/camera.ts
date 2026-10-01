/**
 * Cadrage de la carte : calculs purs, sans MapLibre.
 *
 * `MonumentMap` reste le seul a deplacer la camera ; ce module dit **ou** et
 * **s'il le faut**. Il ne connait ni le canevas ni le DOM, ce qui le rend
 * verifiable hors navigateur.
 */

/** Emprise `[ouest, sud, est, nord]`, en degres. */
export type Bornes = readonly [number, number, number, number];

/**
 * France metropolitaine, Corse comprise.
 *
 * La vue de depart etait un centre et un zoom fixes (`2.6, 46.6, z4.7`),
 * regles sur un ecran large : sur un telephone en portrait le meme couple
 * montrait l'Espagne et la Mediterranee, la moitie nord du pays hors champ.
 * Une emprise, elle, se cadre a toute largeur.
 */
export const METROPOLE: Bornes = [-5.3, 41.2, 9.7, 51.2];

/** Meme forme que `PaddingOptions` de MapLibre, d'ou les cles anglaises. */
export interface Marges {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * Marges de la vue de depart, en pixels : ce que les commandes posees sur la
 * carte recouvrent. A droite la colonne d'outils, en bas la legende — pleine
 * largeur sous 900 px, d'ou la reserve plus haute.
 */
export function margesDepart(largeur: number): Marges {
  return largeur <= 900
    ? { top: 16, bottom: 140, left: 12, right: 60 }
    : { top: 24, bottom: 110, left: 24, right: 64 };
}

/** En deca, la vue couvre plus d'une centaine de kilometres : son centre ne
 *  dit qu'une region. */
export const ZOOM_DISCRET = 9;

/**
 * La vue courante montre-t-elle ou se tient l'utilisateur ?
 *
 * « Copier le lien » joint la vue de carte (`c=lon,lat,zoom`). Apres « Me
 * localiser », cette vue est centree sur l'utilisateur : le lien copie disait
 * alors ou il se tenait, a cent metres pres, contre la regle de
 * `position.svelte.ts`. La vue est donc tue des que la position connue est a
 * l'ecran et que le zoom la situe — le lien s'ouvre alors sur la notice ou
 * sur la France, jamais sur celui qui l'a copie.
 */
export function devoilePosition(
  zoom: number,
  bornes: Bornes,
  ici: { lon: number; lat: number } | null
): boolean {
  if (!ici || zoom < ZOOM_DISCRET) return false;
  const [ouest, sud, est, nord] = bornes;
  return ici.lon >= ouest && ici.lon <= est && ici.lat >= sud && ici.lat <= nord;
}
