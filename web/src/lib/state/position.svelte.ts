/**
 * Position de l'utilisateur, telle que le controle de geolocalisation de la
 * carte l'a obtenue.
 *
 * **Jamais dans l'URL, jamais dans `localStorage`.** Une position ne se partage
 * pas : un permalien copie depuis un jardin public ne doit pas dire ou l'on
 * habite, et une position de la veille ne dit plus rien. Elle vit le temps de
 * la page, et c'est tout.
 *
 * Module a part plutot qu'un etat de la page : la carte l'ecrit, la liste et la
 * fiche la lisent, et aucun des trois ne possede les deux autres.
 */

export interface Position {
  lon: number;
  lat: number;
  /** Rayon de confiance en metres, tel que le navigateur le rend. */
  precision: number;
}

/** Les trois codes de `GeolocationPositionError`, nommes. */
export type ErreurPosition = 'refus' | 'indisponible' | 'delai';

export const position = $state<{ courante: Position | null; erreur: ErreurPosition | null }>({
  courante: null,
  erreur: null
});

export const MESSAGES_POSITION: Record<ErreurPosition, string> = {
  refus: 'Position refusée — autorisez-la dans les réglages du navigateur.',
  indisponible: 'Position indisponible pour le moment.',
  delai: 'La position met trop de temps à arriver. Réessayez à découvert.'
};

/** `GeolocationPositionError.code` : 1 refus, 2 indisponible, 3 delai. */
export function erreurDepuisCode(code: number): ErreurPosition {
  return code === 1 ? 'refus' : code === 3 ? 'delai' : 'indisponible';
}
