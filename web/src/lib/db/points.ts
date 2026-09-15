/**
 * Nuage de points precalcule par l'ETL (`static/data/points.json`).
 *
 * Il n'existe que pour le **premier ecran** : DuckDB-Wasm pese 7,5 Mo gzip et
 * 34 Mo a compiler, et sur un telephone la carte restait vide plusieurs
 * secondes, alors que 44 484 points sans filtre ne demandent aucun moteur SQL.
 * Ce fichier les pose tout de suite ; la premiere reponse de DuckDB le
 * remplace, et tout filtre passe ensuite par lui comme avant.
 *
 * Module pur, sans `$app` : Vitest le teste sans navigateur. Le `fetch` vit
 * dans la page, seule a savoir si l'URL porte des filtres.
 */

/** Colonnes telles que `build.py::points_colonnaires` les ecrit. */
export interface PointsInstantanes {
  total: number;
  geolocalises: number;
  /** Table des statuts : `statut[i]` en est un index. `null` pour une notice
   *  sans statut, comme `queries.points()` le rend. */
  statuts: (string | null)[];
  reference: string[];
  lon: number[];
  lat: number[];
  statut: number[];
  nb: number[];
  siecle: (number | null)[];
}

/**
 * Une entite de la carte. **Seul constructeur** des deux chemins — ce fichier
 * et `queries.points()` : la couche MapLibre lit `statut`, `nb` et `siecle`,
 * et un nuage instantane dont les proprietes divergeraient repeindrait la
 * carte au moment ou DuckDB le remplace.
 */
export function entite(
  reference: string,
  lon: number,
  lat: number,
  statut: string | null,
  nb: number,
  siecle: number | null
): GeoJSON.Feature {
  return {
    type: 'Feature',
    id: reference,
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: { reference, statut, nb, siecle }
  };
}

/** Collection GeoJSON, ou `null` si le fichier est incoherent — un fichier
 *  tronque ou d'un autre format ne doit rien peindre de faux : DuckDB suivra. */
export function versCollection(brut: unknown): GeoJSON.FeatureCollection | null {
  const p = brut as Partial<PointsInstantanes> | null;
  if (!p || !Array.isArray(p.reference) || !Array.isArray(p.statuts)) return null;
  const n = p.reference.length;
  const colonnes = [p.lon, p.lat, p.statut, p.nb, p.siecle];
  if (colonnes.some((c) => !Array.isArray(c) || c.length !== n)) return null;
  const { reference, lon, lat, statut, nb, siecle, statuts } = p as PointsInstantanes;
  const features: GeoJSON.Feature[] = new Array(n);
  for (let i = 0; i < n; i++) {
    features[i] = entite(reference[i], lon[i], lat[i], statuts[statut[i]] ?? null, nb[i], siecle[i]);
  }
  return { type: 'FeatureCollection', features };
}
