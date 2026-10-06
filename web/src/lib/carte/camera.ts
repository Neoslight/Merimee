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

/** Zoom d'arrivee sur un edifice : l'echelle du batiment lui-meme, ou le plan
 *  dessine les emprises et ou la photo aerienne montre les toits. A 14,5 on
 *  arrivait dans le quartier, pas devant l'edifice. */
export const ZOOM_EDIFICE = 17;

/** En deca, la carte ne situe pas un edifice : choisir une notice ailleurs que
 *  sur la carte rapproche alors la vue au lieu de la laisser nationale. */
export const ZOOM_PROCHE = 11;

/** Duree du vol de « Au hasard », en millisecondes. Fixe, et non laissee au
 *  calcul de MapLibre : son `maxDuration` ne plafonne pas un vol trop long, il
 *  le remplace par un saut — exactement ce qu'on ne veut pas vers l'outre-mer.
 *  Huit secondes : le recul sur la France, la traversee, puis une longue
 *  descente — a 3,8 s, douze niveaux de zoom passaient d'un trait. */
export const DUREE_VOL = 8000;

/** Duree d'une approche depuis la liste ou la recherche, quand l'edifice est
 *  loin : meme courbe que le vol, sans le recul force sur la France. */
export const DUREE_APPROCHE = 5000;

/** Duree d'un rapprochement : d'autant plus longue que le saut d'echelle est
 *  grand, plafonnee a `DUREE_APPROCHE`. Passer de la France entiere au
 *  batiment demande le temps de lire le trajet ; glisser d'une rue a l'autre,
 *  non. */
export function dureeApproche(zoomDepart: number, zoomArrivee: number): number {
  return Math.min(DUREE_APPROCHE, 1600 + 300 * Math.abs(zoomArrivee - zoomDepart));
}

/** Part du mouvement passee a accelerer ; le reste decelere. */
const ELAN = 0.3;
/** Ordre de la deceleration : 3 donne une arrivee qui se pose, sans freinage
 *  sec. */
const FREIN = 3;
const K_ELAN = 1 / (ELAN * ELAN + (2 * ELAN * (1 - ELAN)) / FREIN);
const K_FREIN = (2 * K_ELAN * ELAN) / (FREIN * (1 - ELAN) ** (FREIN - 1));

/**
 * Courbe de temps des vols : un depart bref, puis une longue deceleration.
 *
 * L'acceleration douce par defaut de MapLibre est symetrique : la descente
 * finale, la plus belle part du vol, passait aussi vite que le decollage. Ici
 * 30 % du temps accelerent (quadratique), 70 % freinent (cubique), raccordes
 * en valeur **et** en pente — aucun a-coup au raccord.
 */
export function adoucir(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t <= ELAN ? K_ELAN * t * t : 1 - K_FREIN * (1 - t) ** FREIN;
}

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
