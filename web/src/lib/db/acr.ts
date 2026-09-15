/**
 * Chargement de la couche ACR : nuage de points et fiches.
 *
 * **Rien ne part tant que la couche n'est pas affichee.** Le nuage (~20 Ko
 * gzip) est demande a la premiere activation, un fragment de fiches (~225 Ko)
 * au premier clic sur un point ACR. Aucune table n'est materialisee au
 * demarrage : `boot()` n'en sait rien.
 */
import { base } from '$app/paths';
import { versCollectionAcr } from '$lib/acr';
import { enregistrer, lit, query } from './duckdb';
import { toArray, type Detail } from './queries';
import { fragmentAcr } from './shards';

let nuage: Promise<GeoJSON.FeatureCollection | null> | null = null;

/** Nuage de la couche, une seule fois. Un echec reseau libere la promesse pour
 *  qu'une nouvelle activation puisse retenter. */
export function pointsAcr(): Promise<GeoJSON.FeatureCollection | null> {
  nuage ??= fetch(`${base}/data/acr/points.json`)
    .then((r) => (r.ok ? r.json() : null))
    .then(versCollectionAcr)
    .catch(() => {
      nuage = null;
      return null;
    });
  return nuage;
}

/**
 * Fiche d'une notice ACR, au format de `Detail`.
 *
 * Meme gabarit que les monuments historiques : les champs propres a la
 * protection (actes, mobilier, renvois) valent vide, et ce que le label ajoute
 * — annees, interet, description — passe par `acr`.
 */
export async function ficheAcr(reference: string): Promise<Detail> {
  const numero = fragmentAcr(reference);
  const nom = `acr_${numero}.parquet`;
  await enregistrer(nom, `acr/fiches/${numero}.parquet`);
  const [ligne] = await query(`
    SELECT reference, titre, commune, departement_nom, region,
           lon::DOUBLE AS lon, lat::DOUBLE AS lat, annees_label, siecle_detail,
           datation, denominations, auteurs_detail, proprietaires, adresse, lieudit,
           interet, historique, description, observations, liens_externes, commons
    FROM read_parquet('${nom}')
    WHERE reference = ${lit(reference)}
  `);
  if (!ligne) throw new Error(`Notice ${reference} introuvable`);
  return {
    reference: ligne.reference,
    titre: ligne.titre,
    commune: ligne.commune,
    departement_nom: ligne.departement_nom,
    region: ligne.region,
    statut: '',
    partiel: false,
    nature_acte: '',
    siecles: [],
    periodes: [],
    domaines: [],
    denominations: toArray<string>(ligne.denominations),
    auteurs: [],
    auteurs_detail: toArray<string>(ligne.auteurs_detail),
    proprietaires: toArray<string>(ligne.proprietaires),
    adresse: ligne.adresse ?? '',
    lieudit: ligne.lieudit ?? '',
    cadastre: '',
    historique: ligne.historique ?? '',
    precision_protection: '',
    observations: ligne.observations ?? '',
    siecle_detail: ligne.siecle_detail ?? '',
    archiv_mh: '',
    liens_externes: toArray<string>(ligne.liens_externes),
    palissy: [],
    renvois: [],
    commons: toArray<string>(ligne.commons),
    memoire: 0,
    nb_palissy: 0,
    lon: ligne.lon ?? null,
    lat: ligne.lat ?? null,
    actes: [],
    acr: {
      // Colonne `LIST<INT16>` : Arrow rend un `Int16Array`, converti en nombres.
      annees: toArray<number>(ligne.annees_label).map(Number),
      datation: ligne.datation ?? '',
      interet: ligne.interet ?? '',
      description: ligne.description ?? ''
    }
  };
}
