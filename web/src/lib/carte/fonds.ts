import type { FondHistorique } from '$lib/state/permalien';

/**
 * Fonds historiques de la Geoplateforme IGN, servis sans cle d'API.
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
 * - Cassini pese ~170 Ko la tuile, soit ~2 Mo par ecran. D'ou la visibilite
 *   `none` au depart, posee par `MonumentMap` : aucun octet IGN ne part tant
 *   qu'un fond n'est pas demande.
 *
 * L'attribution n'est pas decorative : ce sont des reproductions BnF / IGN,
 * la mention est une obligation. Portee par la source, MapLibre l'ajoute et
 * la retire tout seul avec la couche.
 */
export const HISTORIQUES = [
  {
    cle: 'cassini',
    titre: 'Cassini',
    epoque: 'XVIIIe siècle',
    couche: 'BNF-IGNF_GEOGRAPHICALGRIDSYSTEMS.CASSINI',
    format: 'image/png',
    zoomMax: 14,
    poids: '~170 Ko par tuile',
    attribution: 'Carte de Cassini — BnF / IGN'
  },
  {
    cle: 'etatmajor',
    titre: 'État-major',
    epoque: '1820-1866',
    couche: 'GEOGRAPHICALGRIDSYSTEMS.ETATMAJOR40',
    format: 'image/jpeg',
    zoomMax: 15,
    poids: '~20 Ko par tuile',
    attribution: "Carte de l'état-major — IGN"
  }
] as const satisfies readonly {
  cle: FondHistorique;
  titre: string;
  epoque: string;
  couche: string;
  format: string;
  zoomMax: number;
  poids: string;
  attribution: string;
}[];

export const tuiles = (h: (typeof HISTORIQUES)[number]) =>
  'https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile' +
  `&LAYER=${h.couche}&STYLE=normal&TILEMATRIXSET=PM` +
  `&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=${encodeURIComponent(h.format)}`;
