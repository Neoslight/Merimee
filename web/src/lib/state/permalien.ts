/**
 * Serialisation de l'etat d'exploration dans l'URL.
 *
 * Sans cela le tableau de bord n'a pas d'adresse : un croisement interessant
 * se trouve mais ne se partage pas, et le retour arriere du navigateur quitte
 * l'application au lieu de refermer la fiche.
 *
 * Chaque filtre a son parametre, **repete** pour les valeurs multiples
 * (`?domaine=x&domaine=y`) plutot que joint par un separateur : 63 libelles du
 * corpus contiennent deja une virgule (`architecture judiciaire, penitentiaire
 * ou de police`, `Simon, Gabriel`), et tout separateur imprimable choisi
 * resterait une ambiguite en attente.
 *
 * `bbox` est volontairement absente. Elle est produite par les deplacements de
 * la carte : la reecrire noierait l'URL a chaque pan. Le destinataire d'un lien
 * recalcule la sienne depuis sa propre vue.
 */
import { ANNEE_MAX, ANNEE_MIN, filtresVides, type Filters } from './filters.svelte';

export interface EtatPartage {
  filtres: Filters;
  selection: string | null;
  vueListe: boolean;
}

/** Filtres textuels multivalues : cle d'etat -> nom du parametre. */
const MULTIVALUES = {
  statut: 'statut',
  periodes: 'periode',
  domaines: 'domaine',
  denominations: 'denomination',
  auteurs: 'auteur',
  regions: 'region',
  departements: 'departement',
  proprietaires: 'proprietaire'
} as const;

type CleTexte = keyof typeof MULTIVALUES;

const PAIRES = Object.entries(MULTIVALUES) as [CleTexte, string][];

/** Bornes de garde : l'URL est editable a la main, ses valeurs finissent en SQL. */
const SIECLE_MIN = 1;
const SIECLE_MAX = 21;
const REFERENCE = /^[A-Za-z0-9_-]{1,32}$/;

/** Chaine de requete correspondant a l'etat, `''` si rien n'est pose. */
export function encoder(etat: EtatPartage): string {
  const p = new URLSearchParams();
  for (const [cle, param] of PAIRES) {
    for (const valeur of etat.filtres[cle]) p.append(param, valeur);
  }
  for (const siecle of etat.filtres.siecles) p.append('siecle', String(siecle));
  if (etat.filtres.recherche) p.set('q', etat.filtres.recherche);
  if (etat.filtres.anneeProtection) p.set('annees', etat.filtres.anneeProtection.join('-'));
  if (etat.filtres.nbPalissy > 0) p.set('objets', String(etat.filtres.nbPalissy));
  if (etat.vueListe) p.set('vue', 'liste');
  if (etat.selection) p.set('ref', etat.selection);
  const chaine = p.toString();
  return chaine ? `?${chaine}` : '';
}

function entier(brut: string | null): number | null {
  const n = Number.parseInt(brut ?? '', 10);
  return Number.isInteger(n) ? n : null;
}

function borner(valeur: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, valeur));
}

/**
 * Etat decrit par une chaine de requete. Toute valeur illisible est ignoree
 * silencieusement : un lien tronque doit ouvrir un tableau de bord utilisable,
 * pas une erreur.
 */
export function decoder(chaine: string): EtatPartage {
  const p = new URLSearchParams(chaine);
  const filtres = filtresVides();

  for (const [cle, param] of PAIRES) {
    filtres[cle] = p.getAll(param).map((v) => v.trim()).filter(Boolean);
  }

  filtres.siecles = p
    .getAll('siecle')
    .map((v) => entier(v))
    .filter((n): n is number => n !== null && n >= SIECLE_MIN && n <= SIECLE_MAX);

  filtres.recherche = (p.get('q') ?? '').trim();

  const bornes = (p.get('annees') ?? '').split('-');
  if (bornes.length === 2) {
    const a = entier(bornes[0]);
    const b = entier(bornes[1]);
    if (a !== null && b !== null) {
      filtres.anneeProtection = [
        borner(Math.min(a, b), ANNEE_MIN, ANNEE_MAX),
        borner(Math.max(a, b), ANNEE_MIN, ANNEE_MAX)
      ];
    }
  }

  const objets = entier(p.get('objets'));
  if (objets !== null && objets > 0) filtres.nbPalissy = objets;

  const ref = p.get('ref');
  return {
    filtres,
    selection: ref && REFERENCE.test(ref) ? ref : null,
    vueListe: p.get('vue') === 'liste'
  };
}
