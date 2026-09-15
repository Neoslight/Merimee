/**
 * `buildWhere` est le seul endroit qui traduit `Filters` en SQL : une regression
 * ici touche toutes les requetes du cycle a la fois. Les filtres sont construits
 * localement (`filtresVides()` + surcharges) plutot que par le singleton
 * `filters`, sauf pour `termesResolus`, qui est un etat prive du module et ne se
 * pose qu'au travers de `poserTermes`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { buildWhere, filtresVides, poserTermes, type Filters } from '$lib/state/filters.svelte';

function f(partiel: Partial<Filters>): Filters {
  return { ...filtresVides(), ...partiel };
}

afterEach(() => {
  // `termesResolus` est un module-level : le laisser fuir d'un test a l'autre
  // ferait dependre les assertions suivantes de l'ordre d'execution.
  poserTermes(null);
});

describe('except', () => {
  it("retire une seule cle quand `except` est une chaine", () => {
    const filtres = f({ domaines: ['architecture religieuse'], regions: ['Bretagne'] });
    const where = buildWhere(filtres, 'domaines');
    expect(where).not.toContain('domaines');
    expect(where).toContain("region IN ('Bretagne')");
  });

  it('retire plusieurs cles quand `except` est une liste, comme la matrice', () => {
    const filtres = f({
      siecles: [12],
      anneeProtection: [1900, 1950],
      statut: ['classé']
    });
    const where = buildWhere(filtres, ['siecles', 'anneeProtection']);
    expect(where).not.toContain('siecles');
    expect(where).not.toContain('protections');
    expect(where).toContain("statut IN ('classé')");
  });

  it('sans `except`, toutes les clauses actives sont presentes', () => {
    const filtres = f({ domaines: ['architecture religieuse'], regions: ['Bretagne'] });
    const where = buildWhere(filtres);
    expect(where).toContain('domaines');
    expect(where).toContain('region');
  });

  it("rend 'TRUE' quand aucun filtre n'est actif", () => {
    expect(buildWhere(filtresVides())).toBe('TRUE');
  });
});

describe('echappement LIKE de la recherche par titre', () => {
  it('neutralise `%` et `_` saisis par l utilisateur', () => {
    const where = buildWhere(f({ recherche: 'saint_denis 100%' }));
    expect(where).toContain(String.raw`search_key LIKE '%saint\_denis%' ESCAPE '\'`);
    expect(where).toContain(String.raw`search_key LIKE '%100\%%' ESCAPE '\'`);
    // Semantique ET : chaque mot est sa propre clause, jointe par AND.
    expect(where).toMatch(/LIKE.*ESCAPE '\\' AND search_key LIKE.*ESCAPE '\\'/);
  });

  it('echappe l apostrophe comme un litteral SQL ordinaire', () => {
    const where = buildWhere(f({ recherche: "d'ete" }));
    expect(where).toContain("d''ete");
  });

  it('un antislash saisi est lui-meme echappe, pas interprete', () => {
    const where = buildWhere(f({ recherche: 'a\\b' }));
    expect(where).toContain(String.raw`'%a\\b%'`);
  });

  it('aucun filtre de recherche si le champ est vide ou blanc', () => {
    expect(buildWhere(f({ recherche: '   ' }))).toBe('TRUE');
  });
});

describe('predicat plein texte : null vs [] vs identifiants', () => {
  it("aucune clause tant qu'aucune resolution n'a ete publiee (null)", () => {
    poserTermes(null);
    const where = buildWhere(f({ texte: 'jube' }));
    expect(where).toBe('TRUE');
  });

  it('resolu sans aucun terme connu (le tableau vide) -> FALSE, pas une absence de clause', () => {
    poserTermes([]);
    const where = buildWhere(f({ texte: 'zzzzz' }));
    expect(where).toContain('FALSE');
  });

  it('des identifiants resolus produisent la clause de `clauseTexte`', () => {
    poserTermes([387, 112]);
    const where = buildWhere(f({ texte: 'eglise chateau' }));
    // Le nom de la table est deterministe (hash des termes) : on ne le
    // recalcule pas ici, on verifie juste la forme de la clause produite.
    expect(where).toMatch(/reference IN \(SELECT reference FROM texte_sel_\d+(_\d+)*\)/);
  });

  it("sans `filters.texte`, la clause reste absente meme si des termes sont poses", () => {
    poserTermes([387]);
    expect(buildWhere(f({ texte: '' }))).toBe('TRUE');
  });
});

describe('gardes numeriques', () => {
  it('ecarte les siecles non entiers sans lever, et garde les valides', () => {
    const where = buildWhere(f({ siecles: [12, Number.NaN, 19.5, Infinity, 8] }));
    expect(where).toBe('list_has_any(siecles, [12, 8]::TINYINT[])');
  });

  it('siecles entierement invalides -> pas de clause', () => {
    expect(buildWhere(f({ siecles: [Number.NaN, 1.5] }))).toBe('TRUE');
  });

  it('ecarte une plage d annees non entiere', () => {
    expect(buildWhere(f({ anneeProtection: [1900.5, 1950] }))).toBe('TRUE');
    expect(buildWhere(f({ anneeProtection: [1900, Number.NaN] }))).toBe('TRUE');
  });

  it('garde une plage d annees valide', () => {
    const where = buildWhere(f({ anneeProtection: [1900, 1950] }));
    expect(where).toContain('annee BETWEEN 1900 AND 1950');
  });

  it('ecarte un seuil Palissy non entier meme positif', () => {
    expect(buildWhere(f({ nbPalissy: 2.5 }))).toBe('TRUE');
  });

  it('garde un seuil Palissy entier positif', () => {
    expect(buildWhere(f({ nbPalissy: 5 }))).toContain('nb_palissy >= 5');
  });

  it('ecarte une bbox non finie', () => {
    expect(buildWhere(f({ bbox: [2, 48, Number.NaN, 49] }))).toBe('TRUE');
  });
});
