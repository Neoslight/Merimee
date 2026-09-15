/** Formats partages. Le chiffre romain etait recopie dans trois composants,
 *  chacun avec sa propre implementation. */

const TABLE: [number, string][] = [
  [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']
];

/** Siecle en chiffres romains. Le corpus va du 1er au 21e. */
export function romain(siecle: number): string {
  let reste = siecle;
  let sortie = '';
  for (const [valeur, signe] of TABLE) {
    while (reste >= valeur) {
      sortie += signe;
      reste -= valeur;
    }
  }
  return sortie;
}

export const nf = new Intl.NumberFormat('fr-FR');
export const compact = new Intl.NumberFormat('fr-FR', { notation: 'compact' });

const uneDecimale = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

/**
 * Distance lisible : « 350 m », « 1,2 km », « 38 km ».
 *
 * Le metre est arrondi a la dizaine : la precision d'un GPS de telephone en
 * ville est de cet ordre, afficher « 347 m » promettrait ce qu'on ne sait pas.
 * L'arrondi est fait **avant** le choix de l'unite, sinon 996 m s'afficherait
 * « 1000 m ».
 */
export function formaterDistance(metres: number): string {
  if (!Number.isFinite(metres) || metres < 0) return '';
  const dizaines = Math.max(10, Math.round(metres / 10) * 10);
  if (dizaines < 1000) return `${dizaines} m`;
  if (metres < 9950) return `${uneDecimale.format(metres / 1000)} km`;
  return `${nf.format(Math.round(metres / 1000))} km`;
}
