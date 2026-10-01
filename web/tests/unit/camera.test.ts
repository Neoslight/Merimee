import { describe, expect, it } from 'vitest';
import { devoilePosition, margesDepart, METROPOLE, ZOOM_DISCRET, type Bornes } from '$lib/carte/camera';

describe('METROPOLE', () => {
  it('contient les extremites du territoire, Corse comprise', () => {
    const [ouest, sud, est, nord] = METROPOLE;
    // Ouessant, Bonifacio, Lauterbourg, Dunkerque.
    for (const [lon, lat] of [[-5.1, 48.46], [9.16, 41.39], [8.18, 48.97], [2.38, 51.03]]) {
      expect(lon).toBeGreaterThan(ouest);
      expect(lon).toBeLessThan(est);
      expect(lat).toBeGreaterThan(sud);
      expect(lat).toBeLessThan(nord);
    }
  });
});

describe('margesDepart', () => {
  it('reserve la legende pleine largeur sous 900 px', () => {
    expect(margesDepart(375).bottom).toBeGreaterThan(margesDepart(1400).bottom);
    expect(margesDepart(900)).toEqual(margesDepart(375));
  });

  it('laisse de la carte a cadrer sur un telephone', () => {
    const m = margesDepart(375);
    expect(375 - m.left - m.right).toBeGreaterThan(280);
  });
});

describe('devoilePosition', () => {
  const paris: Bornes = [2.3, 48.82, 2.4, 48.89];
  const ici = { lon: 2.3499, lat: 48.853 };

  it('ne devoile rien sans position connue', () => {
    expect(devoilePosition(14, paris, null)).toBe(false);
  });

  it('devoile quand la position est a l’ecran et le zoom serre', () => {
    expect(devoilePosition(14, paris, ici)).toBe(true);
    expect(devoilePosition(ZOOM_DISCRET, paris, ici)).toBe(true);
  });

  it('ne devoile pas a l’echelle d’une region', () => {
    expect(devoilePosition(ZOOM_DISCRET - 0.1, METROPOLE, ici)).toBe(false);
  });

  it('ne devoile pas quand la carte regarde ailleurs', () => {
    const marseille: Bornes = [5.3, 43.25, 5.45, 43.35];
    expect(devoilePosition(14, marseille, ici)).toBe(false);
  });
});
