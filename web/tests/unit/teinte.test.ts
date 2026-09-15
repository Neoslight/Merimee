/**
 * `teinter()` classe chaque couche d'une feuille de style **par nature**
 * (`type`, `source-layer`) et jamais par identifiant CARTO, precisement pour
 * survivre a un renommage chez le fournisseur. Le test construit une feuille
 * factice qui couvre les cinq natures peintes plus les deux cas de repli —
 * couche de type connu mais nature non reconnue, et couche dont `peindre()` ne
 * sait rien faire — sans instancier MapLibre : `teinter()` n'attend qu'un objet
 * portant `getStyle()` et `setPaintProperty()`.
 */
import { describe, expect, it } from 'vitest';
import type { LayerSpecification, Map as MapLibreMap } from 'maplibre-gl';
import { teinter } from '$lib/teinte';
import type { Palette } from '$lib/state/theme.svelte';

const PALETTE: Palette = {
  carteTerre: '#eceae4',
  carteMer: '#dce3e8',
  carteTrait: '#c8c4ba',
  carteDetail: '#f3f1eb',
  carteLibelle: '#827e75'
} as Palette;

function feuille(layers: Partial<LayerSpecification>[]): MapLibreMap {
  const poses: { id: string; propriete: string; valeur: unknown }[] = [];
  return {
    getStyle: () => ({ layers: layers as LayerSpecification[] }),
    setPaintProperty: (id: string, propriete: string, valeur: unknown) => {
      poses.push({ id, propriete, valeur });
    },
    // Expose pour les tests qui veulent verifier une couleur precise, sans
    // que `teinter()` en ait besoin.
    __poses: poses
  } as unknown as MapLibreMap;
}

describe('classification par nature', () => {
  it('background -> terre', () => {
    const carte = feuille([{ id: 'fond', type: 'background' }]);
    expect(teinter(carte, PALETTE)).toMatchObject({ terre: 1, ignorees: 0 });
  });

  it('symbol -> libelle, meme si son source-layer contient "water"', () => {
    // Priorite du `type` sur le `source-layer` : un libelle de plan d'eau
    // (« water_name ») ne doit pas devenir un trait de cote.
    const carte = feuille([{ id: 'etiquette', type: 'symbol', 'source-layer': 'water_name' }]);
    expect(teinter(carte, PALETTE)).toMatchObject({ libelle: 1, mer: 0, ignorees: 0 });
  });

  it('source-layer contenant "water" -> mer', () => {
    const carte = feuille([{ id: 'eau', type: 'fill', 'source-layer': 'water' }]);
    expect(teinter(carte, PALETTE)).toMatchObject({ mer: 1, ignorees: 0 });
  });

  it('source-layer contenant "boundar" -> trait', () => {
    const carte = feuille([{ id: 'frontiere', type: 'line', 'source-layer': 'boundary' }]);
    expect(teinter(carte, PALETTE)).toMatchObject({ trait: 1, ignorees: 0 });
  });

  it('source-layer contenant "transportation" -> detail', () => {
    const carte = feuille([{ id: 'route', type: 'line', 'source-layer': 'transportation_name' }]);
    expect(teinter(carte, PALETTE)).toMatchObject({ detail: 1, ignorees: 0 });
  });

  it('couche de type reconnu mais nature non identifiee -> terre ou trait, jamais couleur d origine', () => {
    // Aucune branche « je laisse tel quel » : un `fill` inconnu retombe en
    // terre (aplat), une `line` inconnue retombe en trait — c'est le `type`
    // qui decide du repli, jamais un jeu de couleurs propre a la couche.
    const carteAplat = feuille([{ id: 'mystere-fill', type: 'fill', 'source-layer': 'inconnu' }]);
    expect(teinter(carteAplat, PALETTE)).toMatchObject({ terre: 1, ignorees: 0 });

    const carteLigne = feuille([{ id: 'mystere-line', type: 'line', 'source-layer': 'inconnu' }]);
    expect(teinter(carteLigne, PALETTE)).toMatchObject({ trait: 1, ignorees: 0 });
  });

  it('un type que `peindre` ne sait pas peindre est ignore, quelle que soit sa nature', () => {
    // `raster` n'a pas de branche dans `peindre()` : meme classe en « terre »
    // par defaut, il ne doit compter dans aucune categorie peinte.
    const carte = feuille([{ id: 'fond-ancien', type: 'raster' }]);
    const compte = teinter(carte, PALETTE);
    expect(compte.ignorees).toBe(1);
    expect(compte.terre + compte.mer + compte.trait + compte.libelle + compte.detail).toBe(0);
  });

  it('une feuille complete repartit chaque couche dans exactement une categorie', () => {
    const carte = feuille([
      { id: 'fond', type: 'background' },
      { id: 'etiquette', type: 'symbol', 'source-layer': 'place_label' },
      { id: 'eau', type: 'fill', 'source-layer': 'water' },
      { id: 'frontiere', type: 'line', 'source-layer': 'boundary' },
      { id: 'batiment', type: 'fill-extrusion', 'source-layer': 'building' },
      { id: 'mystere', type: 'fill', 'source-layer': 'inconnu' },
      { id: 'ombrage', type: 'hillshade' }
    ]);
    const compte = teinter(carte, PALETTE);
    expect(compte).toEqual({ terre: 2, mer: 1, trait: 1, libelle: 1, detail: 1, ignorees: 1 });
  });
});
