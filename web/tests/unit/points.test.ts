import { describe, expect, it } from 'vitest';
import { entite, versCollection } from '$lib/db/points';

const FICHIER = {
  total: 3,
  geolocalises: 2,
  statuts: ['classé', 'inscrit', null],
  reference: ['PA00000001', 'PA00000002'],
  lon: [2.34989, 5.5],
  lat: [48.85296, 43],
  statut: [0, 2],
  nb: [3, 250],
  siecle: [12, null]
};

describe('versCollection', () => {
  it('rend les memes entites que queries.points()', () => {
    const nuage = versCollection(FICHIER)!;
    expect(nuage.features).toHaveLength(2);
    expect(nuage.features[0]).toEqual(entite('PA00000001', 2.34989, 48.85296, 'classé', 3, 12));
    expect(nuage.features[1].properties).toEqual({
      reference: 'PA00000002',
      statut: null,
      nb: 250,
      siecle: null
    });
    expect(nuage.features[1].id).toBe('PA00000002');
  });

  it('refuse un fichier incoherent plutot que de peindre faux', () => {
    expect(versCollection(null)).toBeNull();
    expect(versCollection({ ...FICHIER, lat: [48] })).toBeNull();
    expect(versCollection({ ...FICHIER, statuts: undefined })).toBeNull();
  });
});
