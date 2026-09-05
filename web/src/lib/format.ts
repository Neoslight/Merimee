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
