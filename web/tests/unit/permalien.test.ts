/**
 * `permalien.ts` est la seule memoire partageable de l'exploration : un
 * aller-retour qui perd ou deforme une valeur casse un lien deja partage.
 */
import { describe, expect, it } from 'vitest';
import { decoder, encoder, type EtatPartage } from '$lib/state/permalien';
import { ANNEE_MAX, ANNEE_MIN, filtresVides } from '$lib/state/filters.svelte';

function etat(partiel: Partial<EtatPartage['filtres']> = {}): EtatPartage {
  return {
    filtres: { ...filtresVides(), ...partiel },
    selection: null,
    vue: 'carte',
    fond: null
  };
}

describe('aller-retour encoder/decoder', () => {
  it('rend un etat equivalent pour une combinaison de filtres usuelle', () => {
    const depart = etat({
      statut: ['classé'],
      domaines: ['architecture religieuse'],
      siecles: [12, 19],
      anneeProtection: [1900, 1950],
      nbPalissy: 3,
      recherche: 'chateau'
    });
    const rechargee = decoder(encoder(depart));
    expect(rechargee.filtres).toEqual(depart.filtres);
    expect(rechargee.vue).toBe('carte');
    expect(rechargee.selection).toBeNull();
  });

  it('conserve la selection et la vue', () => {
    const depart: EtatPartage = { ...etat(), selection: 'PA00078066', vue: 'liste' };
    const rechargee = decoder(encoder(depart));
    expect(rechargee.selection).toBe('PA00078066');
    expect(rechargee.vue).toBe('liste');
  });

  it('conserve le fond historique', () => {
    const depart: EtatPartage = { ...etat(), fond: 'cassini' };
    expect(decoder(encoder(depart)).fond).toBe('cassini');
  });
});

describe('valeurs a virgule (parametre repete)', () => {
  it('distingue deux valeurs contenant une virgule de leur concatenation', () => {
    // 63 libelles du corpus portent deja une virgule : un separateur imprimable
    // les confondrait avec deux valeurs distinctes.
    const depart = etat({
      domaines: [
        'architecture judiciaire, penitentiaire ou de police',
        'architecture de jardin'
      ]
    });
    const chaine = encoder(depart);
    // Chaque valeur a son propre `domaine=`, jamais une liste jointe.
    expect(chaine.match(/domaine=/g)?.length).toBe(2);
    expect(decoder(chaine).filtres.domaines).toEqual(depart.filtres.domaines);
  });

  it('un auteur avec virgule survit intact', () => {
    const depart = etat({ auteurs: ['Simon, Gabriel'] });
    expect(decoder(encoder(depart)).filtres.auteurs).toEqual(['Simon, Gabriel']);
  });
});

describe('validation a la lecture', () => {
  it('ecarte les siecles hors de 1-21', () => {
    const rechargee = decoder('?siecle=0&siecle=22&siecle=-1&siecle=abc&siecle=12');
    expect(rechargee.filtres.siecles).toEqual([12]);
  });

  it('borne une plage d annees hors domaine plutot que de la rejeter', () => {
    const rechargee = decoder('?annees=1000-3000');
    expect(rechargee.filtres.anneeProtection).toEqual([ANNEE_MIN, ANNEE_MAX]);
  });

  it('ignore une plage d annees illisible', () => {
    expect(decoder('?annees=abc-def').filtres.anneeProtection).toBeNull();
    expect(decoder('?annees=1900').filtres.anneeProtection).toBeNull();
  });

  it('remet une plage a l endroit si les bornes sont inversees', () => {
    const rechargee = decoder('?annees=1950-1900');
    expect(rechargee.filtres.anneeProtection).toEqual([1900, 1950]);
  });

  it('ignore une reference qui ne correspond pas au format attendu', () => {
    expect(decoder('?ref=' + encodeURIComponent('<script>')).selection).toBeNull();
    expect(decoder('?ref=' + 'x'.repeat(40)).selection).toBeNull();
  });

  it('accepte une reference valide, et l ancien parametre notice= en alias', () => {
    expect(decoder('?ref=PA00078066').selection).toBe('PA00078066');
    expect(decoder('?notice=PA00078066').selection).toBe('PA00078066');
  });

  it('retombe sur la vue carte pour une valeur inconnue', () => {
    expect(decoder('?vue=n-importe-quoi').vue).toBe('carte');
    expect(decoder('?vue=matrice').vue).toBe('matrice');
  });

  it('retombe sur aucun fond pour une valeur inconnue', () => {
    expect(decoder('?fond=n-importe-quoi').fond).toBeNull();
    expect(decoder('?fond=etatmajor').fond).toBe('etatmajor');
  });

  it('ignore un objets negatif ou nul', () => {
    expect(decoder('?objets=0').filtres.nbPalissy).toBe(0);
    expect(decoder('?objets=-5').filtres.nbPalissy).toBe(0);
    expect(decoder('?objets=3').filtres.nbPalissy).toBe(3);
  });
});

describe('c= : jamais dans l URL vivante, consomme au decodage', () => {
  it("n'apparait pas quand encoder() est appele sans cadrage — le cas de l'URL vivante", () => {
    const chaine = encoder(etat({ statut: ['classé'] }));
    expect(chaine).not.toContain('c=');
  });

  it("apparait seulement quand un cadrage est explicitement fourni — le cas de « Copier le lien »", () => {
    const chaine = encoder(etat(), { lon: 2.35, lat: 48.86, zoom: 12 });
    expect(chaine).toContain('c=2.35%2C48.86%2C12');
  });

  it('un lien produit avec cadrage le restitue au decodage', () => {
    const chaine = encoder(etat(), { lon: 2.35, lat: 48.86, zoom: 12 });
    expect(decoder(chaine).cadrage).toEqual({ lon: 2.35, lat: 48.86, zoom: 12 });
  });

  it('une vue de carte hors domaine est ecartee plutot que de laisser MapLibre sur un ecran vide', () => {
    expect(decoder('?c=200,48,12').cadrage).toBeNull();
    expect(decoder('?c=2,100,12').cadrage).toBeNull();
    expect(decoder('?c=2,48').cadrage).toBeNull();
  });

  it('absente de la chaine, le cadrage decode est nul', () => {
    expect(decoder('').cadrage).toBeNull();
  });
});

describe('bbox', () => {
  it("n'est jamais ecrite dans l URL, quel que soit son etat", () => {
    const chaine = encoder(etat({ bbox: [2, 48, 3, 49] }));
    expect(chaine).not.toContain('bbox');
  });

  it('decoder ne la reconstruit jamais : elle reste a null', () => {
    expect(decoder('?bbox=2,48,3,49').filtres.bbox).toBeNull();
  });
});
