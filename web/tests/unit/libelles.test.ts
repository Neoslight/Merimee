import { describe, expect, it } from 'vitest';
import { afficheUnNom, NOM_FRANCAIS } from '$lib/carte/libelles';

describe('afficheUnNom', () => {
  it('reconnait les champs de nom de la feuille CARTO', () => {
    expect(afficheUnNom('{name_en}')).toBe(true);
    expect(afficheUnNom('{name}')).toBe(true);
    expect(afficheUnNom({ stops: [[8, '{name_en}'], [13, '{name}']] })).toBe(true);
    expect(afficheUnNom(['get', 'name'])).toBe(true);
  });

  it('laisse les numeros de rue et les champs absents', () => {
    expect(afficheUnNom('{housenumber}')).toBe(false);
    expect(afficheUnNom(undefined)).toBe(false);
  });
});

describe('NOM_FRANCAIS', () => {
  it('prefere name:fr et retombe sur le nom local', () => {
    expect(NOM_FRANCAIS).toEqual(['coalesce', ['get', 'name:fr'], ['get', 'name']]);
  });
});
