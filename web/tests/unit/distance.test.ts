import { describe, expect, it } from 'vitest';
import { formaterDistance } from '$lib/format';
import { distanceMetres } from '$lib/geo';

describe('formaterDistance', () => {
  it('arrondit le metre a la dizaine', () => {
    expect(formaterDistance(0)).toBe('10 m');
    expect(formaterDistance(347)).toBe('350 m');
  });

  it('bascule au kilometre apres arrondi, pas avant', () => {
    expect(formaterDistance(996)).toBe('1 km');
    expect(formaterDistance(1234)).toBe('1,2 km');
    expect(formaterDistance(9960)).toBe('10 km');
    expect(formaterDistance(38_400)).toBe('38 km');
    expect(formaterDistance(1_234_567)).toMatch(/^1\s235 km$/u);
  });

  it('ne rend rien d’une valeur invalide', () => {
    expect(formaterDistance(Number.NaN)).toBe('');
    expect(formaterDistance(-5)).toBe('');
  });
});

describe('distanceMetres', () => {
  it('Notre-Dame – Louvre, environ 1,2 km', () => {
    const d = distanceMetres(2.3499, 48.853, 2.3376, 48.8606);
    expect(d).toBeGreaterThan(1150);
    expect(d).toBeLessThan(1300);
  });

  it('est nulle sur place et symetrique', () => {
    expect(distanceMetres(5, 43, 5, 43)).toBe(0);
    expect(distanceMetres(2, 48, 5, 43)).toBeCloseTo(distanceMetres(5, 43, 2, 48), 6);
  });
});
