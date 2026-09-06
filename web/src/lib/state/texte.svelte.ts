/**
 * Etat de l'index plein texte : present ou non, charge ou non, et ce que le
 * lexique n'a pas reconnu.
 *
 * L'index pese 3,8 Mo. Il n'est demande qu'au premier passage en mode
 * « historiques », jamais au demarrage — meme partage que les fragments de
 * fiche, et pour la meme raison : personne ne paie une fonction qu'il n'ouvre
 * pas.
 *
 * `indisponible` n'est pas une panne. L'ETL n'ecrit l'index que si l'extension
 * `fts` de DuckDB est chargeable ; sans elle, les trois Parquet manquent et le
 * bouton disparait. Le reste du site est identique.
 */
import { chargerIndex, resoudre, type StatsTexte } from '$lib/db/texte';
import { poserTermes, replier } from './filters.svelte';

export type EtatIndex = 'repos' | 'chargement' | 'pret' | 'indisponible';

export const indexTexte = $state<{
  etat: EtatIndex;
  stats: StatsTexte | null;
  /** Mots que le lexique ne connait pas : ils n'apparaissent dans aucun
   *  historique, et la vue liste les nomme plutot que de rendre zero. */
  inconnus: string[];
}>({ etat: 'repos', stats: null, inconnus: [] });

/** Mots d'une saisie, replies comme le lexique les stocke. */
export function motsDe(saisie: string): string[] {
  return replier(saisie).split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * Charge l'index si besoin. Rend vrai quand il est utilisable.
 *
 * Deux appels concurrents ne telechargent qu'une fois : `enregistrer()` garde
 * la trace des fichiers deja poses, et l'etat `chargement` bloque le second
 * appel a l'entree.
 */
export async function charger(): Promise<boolean> {
  if (indexTexte.etat === 'pret') return true;
  if (indexTexte.etat === 'indisponible') return false;
  indexTexte.etat = 'chargement';
  try {
    indexTexte.stats = await chargerIndex();
    indexTexte.etat = 'pret';
    return true;
  } catch {
    // 404 sur les Parquet, ou lecture impossible : dans les deux cas la
    // fonction n'existe pas pour ce deploiement.
    indexTexte.etat = 'indisponible';
    indexTexte.stats = null;
    return false;
  }
}

/**
 * Traduit une saisie en identifiants de terme et les pose pour `buildWhere`.
 *
 * Rend les identifiants trouves. Un mot inconnu ne fait pas echouer la
 * resolution : il est retenu dans `inconnus`, et le predicat porte alors sur
 * les seuls mots reconnus — sauf si aucun ne l'est, auquel cas il n'y a rien a
 * chercher.
 */
export async function preparer(saisie: string): Promise<number[]> {
  const mots = motsDe(saisie);
  if (!mots.length) {
    indexTexte.inconnus = [];
    poserTermes(null);
    return [];
  }
  const resolus = await resoudre(mots);
  indexTexte.inconnus = mots.filter((_, i) => resolus[i] === null);
  const termes = resolus.filter((t): t is number => t !== null);
  poserTermes(termes);
  return termes;
}
