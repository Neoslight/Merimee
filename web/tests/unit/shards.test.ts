/**
 * Les trois valeurs de reference de `test_hachage_stable`
 * (`etl/tests/test_pipeline.py`), verrouillees des deux cotes : un changement
 * de l'un sans l'autre desynchronise le cote pipeline (qui ecrit les
 * fragments) du cote navigateur (qui les retrouve).
 */
import { describe, expect, it } from 'vitest';
import { fnv1a, fragmentDe, NB_FRAGMENTS } from '$lib/db/shards';

describe('fnv1a', () => {
  it('reproduit les trois valeurs de reference partagees avec le pipeline Python', () => {
    expect(fnv1a('PA00078066') % 32).toBe(19);
    expect(fnv1a('PA31000132') % 32).toBe(28);
    expect(fnv1a('PA00116859') % 32).toBe(8);
  });

  it('rend un entier non signe sur 32 bits', () => {
    const h = fnv1a('quelque chose de plus long pour sortir du cas trivial');
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });
});

describe('fragmentDe', () => {
  it('reste dans les bornes de NB_FRAGMENTS', () => {
    for (const ref of ['PA00078066', 'PA31000132', 'PA00116859', '', 'x']) {
      const f = fragmentDe(ref);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(NB_FRAGMENTS);
    }
  });

  it('est deterministe', () => {
    expect(fragmentDe('PA00078066')).toBe(fragmentDe('PA00078066'));
  });
});
