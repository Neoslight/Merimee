/**
 * Ce que disent les couleurs des points : statut de protection, ou epoque de
 * construction. Partage entre la carte, qui les peint, la legende, qui les
 * nomme, et le panneau des calques, qui les choisit — aucun des trois ne
 * possede les deux autres.
 */

/** Semiologie des points : statut juridique, ou epoque de construction. */
export type Mode = 'statut' | 'epoque';

/** Tranches d'epoque, par siecle de debut. `cle` nomme le jeton de `palette`. */
export const TRANCHES = [
  { cle: 'epoque1', depuis: 1, titre: 'jusqu’au XIIe' },
  { cle: 'epoque2', depuis: 13, titre: 'XIIIe – XVe' },
  { cle: 'epoque3', depuis: 16, titre: 'XVIe – XVIIe' },
  { cle: 'epoque4', depuis: 18, titre: 'XVIIIe – XIXe' },
  { cle: 'epoque5', depuis: 20, titre: 'XXe et après' }
] as const;
