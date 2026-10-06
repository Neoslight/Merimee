/**
 * Fonds superposes de la Geoplateforme IGN, servis sans cle d'API : la photo
 * aerienne actuelle et deux cartes anciennes.
 *
 * Trois points mesures, a ne pas redecouvrir :
 *
 * - le prefixe `BNF-IGNF_` de Cassini est **obligatoire** : l'identifiant nu
 *   `GEOGRAPHICALGRIDSYSTEMS.CASSINI` renvoie 400 ;
 * - `zoomMax` n'est pas une precaution, c'est le piege du dispositif. Cassini
 *   s'arrete a z14 : sans `maxzoom` sur la source, MapLibre reclame des tuiles
 *   inexistantes au-dela et **la couche disparait** au moment precis ou l'on
 *   zoome sur l'edifice. Avec, il etire la derniere tuile disponible, ce qui
 *   est le comportement correct pour une carte ancienne ;
 * - Cassini pese ~160 Ko la tuile, soit ~2 Mo par ecran ; la photo aerienne
 *   12 a 22 Ko (releve Paris et Lozere, z8 a z18). D'ou la visibilite `none`
 *   au depart, posee par `MonumentMap` : aucun octet IGN ne part tant qu'un
 *   fond n'est pas demande.
 *
 * L'attribution n'est pas decorative : ce sont des reproductions BnF / IGN,
 * la mention est une obligation. Portee par la source, MapLibre l'ajoute et
 * la retire tout seul avec la couche.
 */
export type Superposition = 'aerien' | 'cassini' | 'etatmajor';

export const SUPERPOSITIONS = [
  {
    cle: 'aerien',
    titre: 'Photo aérienne',
    epoque: 'IGN, actuelle',
    couche: 'ORTHOIMAGERY.ORTHOPHOTOS',
    format: 'image/jpeg',
    zoomMax: 19,
    poids: '~20 Ko par tuile',
    attribution: 'Photographies aériennes — IGN',
    // Une photographie se lit pleine : a 65 %, elle lave le plan et le plan la
    // brouille. Les noms de lieux, eux, passent au-dessus (`sousLibelles`) —
    // c'est la vue « hybride » qu'on attend d'une carte.
    opacite: 100,
    sousLibelles: true
  },
  {
    cle: 'cassini',
    titre: 'Cassini',
    epoque: 'XVIIIe siècle',
    couche: 'BNF-IGNF_GEOGRAPHICALGRIDSYSTEMS.CASSINI',
    format: 'image/png',
    zoomMax: 14,
    poids: '~160 Ko par tuile',
    attribution: 'Carte de Cassini — BnF / IGN',
    // Une carte ancienne porte sa propre toponymie : les libelles modernes
    // par-dessus feraient deux ecritures superposees.
    opacite: 65,
    sousLibelles: false
  },
  {
    cle: 'etatmajor',
    titre: 'État-major',
    epoque: '1820-1866',
    couche: 'GEOGRAPHICALGRIDSYSTEMS.ETATMAJOR40',
    format: 'image/jpeg',
    zoomMax: 15,
    poids: '~20 Ko par tuile',
    attribution: "Carte de l'état-major — IGN",
    opacite: 65,
    sousLibelles: false
  }
] as const satisfies readonly {
  cle: Superposition;
  titre: string;
  epoque: string;
  couche: string;
  format: string;
  zoomMax: number;
  poids: string;
  attribution: string;
  /** Opacite proposee quand on choisit ce fond, en pourcent. */
  opacite: number;
  /** Le fond se pose sous les libelles du plan plutot que par-dessus. */
  sousLibelles: boolean;
}[];

export const CLES_SUPERPOSITIONS: readonly Superposition[] = SUPERPOSITIONS.map((s) => s.cle);

export const tuiles = (s: (typeof SUPERPOSITIONS)[number]) =>
  'https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile' +
  `&LAYER=${s.couche}&STYLE=normal&TILEMATRIXSET=PM` +
  `&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=${encodeURIComponent(s.format)}`;
