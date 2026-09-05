/**
 * Phase du demarrage, partagee entre le bootstrap DuckDB et l'ecran d'attente.
 *
 * Le premier chargement pese une dizaine de megaoctets, dominee par le binaire
 * du moteur SQL. Afficher « Chargement de la base… » pendant plusieurs secondes
 * sans rien dire de plus laisse croire a un blocage.
 *
 * Il n'y a volontairement pas de progression en octets. duckdb-wasm accepte un
 * rappel de progression sur `instantiate`, mais le binaire est telecharge par
 * son web worker : le rappel n'a jamais ete observe cote page, ni en local ni
 * sur le site publie. Une barre qui ne s'affiche jamais est pire qu'aucune.
 */
export type Phase = 'moteur' | 'corpus' | 'pret';

export const amorcage = $state({ phase: 'moteur' as Phase });

// Les points de suspension font partie du libelle : « Prêt… » suggererait
// qu'il reste quelque chose a attendre.
export const LIBELLES: Record<Phase, string> = {
  moteur: 'Téléchargement du moteur SQL…',
  corpus: 'Lecture du corpus…',
  pret: 'Prêt'
};
