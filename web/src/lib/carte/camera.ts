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
 * carte recouvrent. A droite les commandes de zoom, en bas la legende et la
 * vignette des calques — pleine largeur sous 900 px, d'ou la reserve plus haute.
 */
export function margesDepart(largeur: number): Marges {
  return largeur <= 900
    ? { top: 16, bottom: 140, left: 12, right: 60 }
    : { top: 24, bottom: 110, left: 24, right: 64 };
}

export const SANS_MARGE: Marges = { top: 0, bottom: 0, left: 0, right: 0 };

/** Zoom d'arrivee sur un edifice : son point mesure une dizaine de pixels et
 *  ses voisins restent a l'ecran — on voit ou il est, pas seulement lui. */
export const ZOOM_EDIFICE = 14.5;

/** En deca, la carte ne situe pas un edifice : choisir une notice ailleurs que
 *  sur la carte rapproche alors la vue au lieu de la laisser nationale. */
export const ZOOM_PROCHE = 11;

/** Duree du vol de « Au hasard », en millisecondes. Fixe, et non laissee au
 *  calcul de MapLibre : son `maxDuration` ne plafonne pas un vol trop long, il
 *  le remplace par un saut — exactement ce qu'on ne veut pas vers l'outre-mer. */
export const DUREE_VOL = 3800;

/** Jeu laisse entre un point et le bord de la part visible. */
const AISANCE = 24;

/**
 * Le point tombe-t-il dans la part de la carte que rien ne recouvre ?
 *
 * `p` est en pixels du conteneur ; `marges` dit ce que les panneaux ouverts
 * masquent sur chaque bord.
 */
export function estVisible(
  p: { x: number; y: number },
  largeur: number,
  hauteur: number,
  marges: Marges
): boolean {
  return (
    p.x >= marges.left + AISANCE &&
    p.x <= largeur - marges.right - AISANCE &&
    p.y >= marges.top + AISANCE &&
    p.y <= hauteur - marges.bottom - AISANCE
  );
}

/**
 * Decalage a passer a `easeTo` / `flyTo` pour que la cible arrive au centre de
 * la part visible et non au centre du canevas.
 *
 * `offset`, et non l'option `padding` de MapLibre : celle-ci **reste posee**
 * sur la carte apres le mouvement et deplace tout ce qui suit, `getCenter`
 * compris — donc la vue copiee dans un lien.
 */
export function decalage(marges: Marges): [number, number] {
  return [(marges.left - marges.right) / 2, (marges.top - marges.bottom) / 2];
}

/**
 * Emprise d'un nuage de points, `null` s'il est vide. Sert a cadrer une
 * region ou un departement qu'on vient de choisir : la selection elle-meme
 * dit ou regarder, sans table de contours a embarquer.
 */
export function emprise(entites: readonly GeoJSON.Feature[]): Bornes | null {
  let ouest = Infinity;
  let sud = Infinity;
  let est = -Infinity;
  let nord = -Infinity;
  for (const entite of entites) {
    if (entite.geometry?.type !== 'Point') continue;
    const [lon, lat] = entite.geometry.coordinates;
    if (lon < ouest) ouest = lon;
    if (lon > est) est = lon;
    if (lat < sud) sud = lat;
    if (lat > nord) nord = lat;
  }
  return Number.isFinite(ouest) ? [ouest, sud, est, nord] : null;
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
