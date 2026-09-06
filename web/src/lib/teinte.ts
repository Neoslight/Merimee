/**
 * Repeint le fond de carte clair aux teintes du produit.
 *
 * CARTO sert Positron sans cle d'API, mais dans sa palette : terre presque
 * blanche, routes en blanc pur, bois verts. Ecrire un style a la main
 * obligerait a declarer soi-meme une source de tuiles vectorielles, hors du
 * contrat que ces feuilles offrent ; on part donc de Positron et on le repeint.
 *
 * **La classification va par nature, jamais par identifiant.** `landcover_wood`
 * ou `boundary_2` sont une convention de CARTO, qui peut changer sans
 * prevenir ; le `source-layer` vient du schema OpenMapTiles et le `type` de la
 * specification MapLibre — ce sont, eux, des contrats.
 *
 * **Et elle se termine sur le `type`, sans branche « je laisse tel quel ».**
 * C'est ce qui transforme un renommage chez CARTO en degradation benigne au
 * lieu d'une panne muette : une couche non reconnue ressort en terre ou en
 * trait, jamais en vert. Le decompte rendu par `teinter` est l'autre moitie du
 * dispositif — cf. `state/carte.svelte.ts`.
 */
import type { LayerSpecification, Map as MapLibreMap } from 'maplibre-gl';
import type { Palette } from '$lib/state/theme.svelte';

export interface Teinture {
  terre: number;
  mer: number;
  trait: number;
  libelle: number;
  detail: number;
  /** Couches qu'aucune passe ne sait peindre : raster, cercles, ombrage. */
  ignorees: number;
}

type Nature = keyof Omit<Teinture, 'ignorees'>;

function nature(couche: LayerSpecification): Nature {
  if (couche.type === 'background') return 'terre';
  if (couche.type === 'symbol') return 'libelle';
  const source = ('source-layer' in couche ? (couche['source-layer'] as string) : '') ?? '';
  if (/water|ocean|river|marine/i.test(source)) return 'mer';
  if (/boundar|admin/i.test(source)) return 'trait';
  if (/transportation|aeroway|building|ferry/i.test(source)) return 'detail';
  // Rien ne ressort d'ici avec ses couleurs d'origine : un aplat inconnu vaut
  // mieux en terre qu'en vert, une ligne inconnue mieux en trait qu'en blanc.
  return couche.type === 'line' ? 'trait' : 'terre';
}

/**
 * Pose l'encre selon le `type`, qui seul dit quelles proprietes de peinture
 * existent : ecrire `fill-color` sur une ligne leverait.
 *
 * `cerne` n'est pas un detail. **Il n'existe pas de couche « cote » dans
 * OpenMapTiles** : le trait de cote est le bord du polygone d'eau, et
 * `fill-outline-color` est le seul levier qui le donne. Terre et mer ne sont
 * separees que par 1,08:1 de luminance — sans ce bord, le littoral disparait.
 */
function peindre(
  map: MapLibreMap,
  couche: LayerSpecification,
  encre: string,
  cerne: string,
  halo: string
): boolean {
  switch (couche.type) {
    case 'background':
      map.setPaintProperty(couche.id, 'background-color', encre);
      return true;
    case 'fill':
      map.setPaintProperty(couche.id, 'fill-color', encre);
      map.setPaintProperty(couche.id, 'fill-outline-color', cerne);
      return true;
    case 'fill-extrusion':
      map.setPaintProperty(couche.id, 'fill-extrusion-color', encre);
      return true;
    case 'line':
      map.setPaintProperty(couche.id, 'line-color', encre);
      return true;
    case 'symbol':
      map.setPaintProperty(couche.id, 'text-color', encre);
      map.setPaintProperty(couche.id, 'text-halo-color', halo);
      return true;
    default:
      return false;
  }
}

/**
 * A appeler **avant** tout `addLayer` : `map.getStyle().layers` contiendrait
 * sinon nos propres couches, et repeindre `monuments-points` en couleur de
 * terre serait la panne la plus bete du dispositif.
 */
export function teinter(map: MapLibreMap, palette: Palette): Teinture {
  const compte: Teinture = { terre: 0, mer: 0, trait: 0, libelle: 0, detail: 0, ignorees: 0 };
  const encres: Record<Nature, string> = {
    terre: palette.carteTerre,
    mer: palette.carteMer,
    trait: palette.carteTrait,
    detail: palette.carteDetail,
    libelle: palette.carteLibelle
  };
  for (const couche of map.getStyle().layers ?? []) {
    const quoi = nature(couche);
    // Le bord d'un plan d'eau est une cote : il prend le trait, pas l'encre.
    const cerne = quoi === 'mer' ? palette.carteTrait : encres[quoi];
    if (peindre(map, couche, encres[quoi], cerne, palette.carteTerre)) compte[quoi] += 1;
    else compte.ignorees += 1;
  }
  return compte;
}
