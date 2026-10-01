/**
 * Les niveaux de protection, dits une seule fois.
 *
 * La legende affichait `classé · inscrit · les deux` sans titre ni explication,
 * et les visiteurs n'y lisaient ni une hierarchie ni ce que « les deux »
 * designait. Le propos vit ici pour que la legende, le filtre et la fiche
 * disent la meme chose : un mot corrige l'est partout.
 *
 * `jeton` nomme la couleur dans `palette` (`theme.svelte.ts`) — la valeur
 * elle-meme reste dans `app.css`, comme toute couleur du produit.
 *
 * L'ordre est celui de la legende : du niveau le plus fort au plus faible,
 * puis le cas mixte. Les definitions reprennent les termes du code du
 * patrimoine (art. L621-1 pour le classement, L621-25 pour l'inscription).
 */
export const STATUTS = [
  {
    valeur: 'classé',
    jeton: 'classe',
    libelle: 'Classé',
    glose: 'protection la plus forte',
    definition:
      'Édifice dont la conservation présente un intérêt public pour l’histoire ou l’art. ' +
      'Décision du ministre de la Culture ; tous travaux soumis à autorisation de l’État.'
  },
  {
    valeur: 'inscrit',
    jeton: 'inscrit',
    libelle: 'Inscrit',
    glose: 'premier niveau de protection',
    definition:
      'Édifice d’un intérêt suffisant pour en rendre la préservation désirable. ' +
      'Décision du préfet de région ; travaux déclarés et suivis.'
  },
  {
    valeur: 'classé+inscrit',
    jeton: 'mixte',
    libelle: 'Classé et inscrit',
    glose: 'selon les parties de l’édifice',
    definition:
      'Certaines parties sont classées, d’autres inscrites — une façade classée, ' +
      'le reste du bâtiment inscrit, par exemple.'
  }
] as const;
