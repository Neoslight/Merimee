/**
 * Progression du demarrage, partagee entre le bootstrap DuckDB et l'ecran
 * d'attente.
 *
 * Le premier chargement pese une dizaine de megaoctets, dominee par le binaire
 * du moteur SQL. Afficher « Chargement de la base… » pendant plusieurs secondes
 * sans rien dire de plus laisse croire a un blocage.
 */
export type Phase = 'moteur' | 'corpus' | 'pret';

export const amorcage = $state({
  phase: 'moteur' as Phase,
  octets: 0,
  /** 0 tant que la taille annoncee est inconnue. */
  total: 0
});

// Les points de suspension font partie du libelle : « Prêt… » suggererait
// qu'il reste quelque chose a attendre.
export const LIBELLES: Record<Phase, string> = {
  moteur: 'Téléchargement du moteur SQL…',
  corpus: 'Lecture du corpus…',
  pret: 'Prêt'
};
