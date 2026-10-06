import { describe, expect, it } from 'vitest';
import { replier } from '$lib/state/filters.svelte';
import { dansMetropole, RACCOURCIS, surligner } from '$lib/recherche';

describe('replier', () => {
  it('retire accents et casse', () => {
    expect(replier('  Église Saint-Étienne ')).toBe('eglise saint-etienne');
  });

  it('ramene ligatures et apostrophes typographiques a la forme du corpus', () => {
    expect(replier('Chœur')).toBe('choeur');
    expect(replier('Lætitia')).toBe('laetitia');
    expect(replier('L’Isle-Adam')).toBe("l'isle-adam");
  });
});

describe('surligner', () => {
  it('trouve la saisie sans tenir compte des accents', () => {
    expect(surligner('Église de la Nativité', 'eglise')).toEqual({ avant: '', trouve: 'Église', apres: ' de la Nativité' });
  });

  it('decoupe le libelle d’origine quand une ligature change la longueur', () => {
    expect(surligner('Le chœur roman', 'coeur')).toBeNull();
    expect(surligner('Le chœur roman', 'choeur')).toEqual({ avant: 'Le ', trouve: 'chœur', apres: ' roman' });
  });

  it('ne trouve rien d’une saisie vide ou absente', () => {
    expect(surligner('Rouen', '  ')).toBeNull();
    expect(surligner('Rouen', 'lyon')).toBeNull();
  });
});

describe('dansMetropole', () => {
  it('accepte une emprise bretonne, refuse une emprise qui touche la Reunion', () => {
    expect(dansMetropole([-4.8, 47.3, -1.0, 48.9])).toBe(true);
    expect(dansMetropole([2.3, -21.4, 55.7, 48.9])).toBe(false);
  });
});

describe('RACCOURCIS', () => {
  it('chacun pose au moins un filtre', () => {
    for (const r of RACCOURCIS) {
      const valeurs = Object.values(r.filtres).flat();
      expect(valeurs.length, r.libelle).toBeGreaterThan(0);
    }
  });
});
