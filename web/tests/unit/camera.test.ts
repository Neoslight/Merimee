import { describe, expect, it } from 'vitest';
import {
  adoucir,
  decalage,
  devoilePosition,
  DUREE_APPROCHE,
  dureeApproche,
  estVisible,
  margesDepart,
  METROPOLE,
  SANS_MARGE,
  ZOOM_DISCRET,
  type Bornes
} from '$lib/carte/camera';

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

describe('estVisible', () => {
  // Bureau, fiche ouverte a droite : 416 px masques sur 1400.
  const fiche = { ...SANS_MARGE, right: 416 };

  it('tient pour visible un point au milieu de la carte', () => {
    expect(estVisible({ x: 500, y: 400 }, 1400, 800, SANS_MARGE)).toBe(true);
    expect(estVisible({ x: 500, y: 400 }, 1400, 800, fiche)).toBe(true);
  });

  it('tient pour masque un point sous un panneau', () => {
    expect(estVisible({ x: 1100, y: 400 }, 1400, 800, SANS_MARGE)).toBe(true);
    expect(estVisible({ x: 1100, y: 400 }, 1400, 800, fiche)).toBe(false);
  });

  it('garde un jeu au bord : un point colle au cadre ne se lit pas', () => {
    expect(estVisible({ x: 4, y: 400 }, 1400, 800, SANS_MARGE)).toBe(false);
    expect(estVisible({ x: 500, y: 796 }, 1400, 800, SANS_MARGE)).toBe(false);
  });

  it('compte la feuille du telephone en bas', () => {
    const feuille = { ...SANS_MARGE, bottom: 304 };
    expect(estVisible({ x: 190, y: 200 }, 375, 684, feuille)).toBe(true);
    expect(estVisible({ x: 190, y: 500 }, 375, 684, feuille)).toBe(false);
  });
});

describe('decalage', () => {
  it('est nul sans panneau', () => {
    expect(decalage(SANS_MARGE)).toEqual([0, 0]);
  });

  it('pousse la cible vers le centre de la part visible', () => {
    // Fiche a droite : la cible part a gauche de la moitie de sa largeur.
    expect(decalage({ ...SANS_MARGE, right: 416 })).toEqual([-208, 0]);
    // Feuille en bas : la cible remonte.
    expect(decalage({ ...SANS_MARGE, bottom: 304 })).toEqual([0, -152]);
    // Tiroir a gauche et fiche a droite se compensent.
    expect(decalage({ ...SANS_MARGE, left: 296, right: 296 })).toEqual([0, 0]);
  });
});

describe('adoucir', () => {
  it('part de 0, arrive a 1, et ne recule jamais', () => {
    expect(adoucir(0)).toBe(0);
    expect(adoucir(1)).toBe(1);
    let avant = 0;
    for (let i = 1; i <= 200; i++) {
      const v = adoucir(i / 200);
      expect(v).toBeGreaterThanOrEqual(avant);
      avant = v;
    }
  });

  it('se raccorde sans a-coup : pente continue au changement de regime', () => {
    const pente = (t: number) => (adoucir(t + 1e-6) - adoucir(t - 1e-6)) / 2e-6;
    expect(pente(0.3 - 1e-3)).toBeCloseTo(pente(0.3 + 1e-3), 1);
  });

  it('passe plus de temps a se poser qu’a partir', () => {
    // A mi-course du temps, plus de la moitie du trajet est faite : la fin
    // est lente.
    expect(adoucir(0.5)).toBeGreaterThan(0.6);
    // Et l'arrivee se pose : derniere pente quasi nulle.
    expect((1 - adoucir(0.98)) / 0.02).toBeLessThan(0.01);
  });
});

describe('dureeApproche', () => {
  it('croit avec le saut d’echelle, plafonnee', () => {
    expect(dureeApproche(15, 17)).toBeLessThan(dureeApproche(9, 17));
    expect(dureeApproche(5, 17)).toBe(DUREE_APPROCHE);
  });
});
