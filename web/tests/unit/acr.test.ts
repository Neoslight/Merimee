/**
 * Couche Architecture contemporaine remarquable : logique pure (`lib/acr.ts`)
 * et hachage des fragments de fiches, qui doit rester celui de `acr.py`.
 */
import { describe, expect, it } from 'vitest';
import { estAcr, libelleLabel, versCollectionAcr } from '$lib/acr';
import { fnv1a, fragmentAcr, NB_FRAGMENTS_ACR } from '$lib/db/shards';

describe('estAcr', () => {
  it('reconnait les references du label et elles seules', () => {
    expect(estAcr('ACR0000002')).toBe(true);
    expect(estAcr('PA00078066')).toBe(false);
    expect(estAcr('ACRO')).toBe(false);
    expect(estAcr(null)).toBe(false);
    expect(estAcr('')).toBe(false);
  });
});

describe('versCollectionAcr', () => {
  it('construit une entite par reference, annee comprise', () => {
    const c = versCollectionAcr({
      total: 3,
      geolocalises: 2,
      reference: ['ACR0000002', 'ACR0000003'],
      lon: [5.8, 5.9],
      lat: [46.1, 46.0],
      annee: [2003, null]
    });
    expect(c?.features).toHaveLength(2);
    expect(c?.features[0].properties).toEqual({ reference: 'ACR0000002', annee: 2003 });
    expect(c?.features[1].geometry).toEqual({ type: 'Point', coordinates: [5.9, 46.0] });
  });

  it('rejette un fichier incoherent plutot que de peindre faux', () => {
    expect(versCollectionAcr(null)).toBeNull();
    expect(versCollectionAcr({ reference: ['ACR0000002'], lon: [], lat: [1], annee: [null] })).toBeNull();
  });
});

describe('libelleLabel', () => {
  it('dit la date du label, et son renouvellement quand il y en a deux', () => {
    expect(libelleLabel([2003])).toBe('Label 2003');
    expect(libelleLabel([2000, 2026])).toBe('Label 2000 · renouvelé 2026');
    expect(libelleLabel([])).toBe('Label ACR');
  });
});

describe('fragmentAcr', () => {
  it('reste dans les bornes et suit le meme FNV-1a que `details`', () => {
    for (const ref of ['ACR0000002', 'ACR0000122', 'ACR0001999']) {
      const n = fragmentAcr(ref);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(NB_FRAGMENTS_ACR);
      expect(n).toBe(fnv1a(ref) % 8);
    }
  });
});
