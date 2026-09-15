/**
 * Couche « Architecture contemporaine remarquable » : logique pure.
 *
 * Un second corpus, **hors du filtrage croise** : aucun prédicat, aucun
 * compteur, aucune liste ne le voit. Il ne vit que sur la carte, masque par
 * defaut, et dans la fiche. Module sans `$app`, teste par Vitest.
 */

/** Les references du label commencent toutes par `ACR` (`ACR0000002`). */
export function estAcr(reference: string | null | undefined): boolean {
  return !!reference && /^ACR\d/i.test(reference);
}

/** Colonnes telles que `acr.py::points_acr` les ecrit. */
export interface PointsAcr {
  total: number;
  geolocalises: number;
  reference: string[];
  lon: number[];
  lat: number[];
  annee: (number | null)[];
}

/** Collection GeoJSON, ou `null` si le fichier est incoherent : une couche
 *  bonus qui ne peut pas s'afficher reste simplement vide. */
export function versCollectionAcr(brut: unknown): GeoJSON.FeatureCollection | null {
  const p = brut as Partial<PointsAcr> | null;
  if (!p || !Array.isArray(p.reference)) return null;
  const n = p.reference.length;
  if ([p.lon, p.lat, p.annee].some((c) => !Array.isArray(c) || c.length !== n)) return null;
  const { reference, lon, lat, annee } = p as PointsAcr;
  const features: GeoJSON.Feature[] = new Array(n);
  for (let i = 0; i < n; i++) {
    features[i] = {
      type: 'Feature',
      id: reference[i],
      geometry: { type: 'Point', coordinates: [lon[i], lat[i]] },
      properties: { reference: reference[i], annee: annee[i] }
    };
  }
  return { type: 'FeatureCollection', features };
}

/** « Label 2000 », ou « Label 2000 · renouvelé 2026 » pour les 13 notices qui
 *  portent deux dates. */
export function libelleLabel(annees: readonly number[]): string {
  if (annees.length === 0) return 'Label ACR';
  const [premiere, ...suite] = annees;
  return suite.length
    ? `Label ${premiere} · renouvelé ${suite[suite.length - 1]}`
    : `Label ${premiere}`;
}
