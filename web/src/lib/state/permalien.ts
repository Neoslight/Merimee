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
 * la carte : la reecrire noierait l'URL a chaque pan.
 *
 * La **vue** de carte (`c=lon,lat,zoom`) suit une regle differente de tout le
 * reste : elle n'est jamais ecrite dans l'URL vivante — un simple deplacement
 * ne doit rien reecrire — mais elle est ajoutee au lien **produit** par
 * « Copier le lien ». Partager un croisement sans partager l'endroit qu'on
 * regarde revenait a renvoyer le destinataire sur la France entiere.
 */
import { ANNEE_MAX, ANNEE_MIN, filtresVides, type Filters } from './filters.svelte';

/** Vue occupant la scene centrale. `carte` est le defaut, donc absent de l'URL. */
export type Vue = 'carte' | 'matrice' | 'liste';

const VUES: readonly Vue[] = ['carte', 'matrice', 'liste'];

/**
 * Fond de carte historique superpose, `null` quand il n'y en a pas.
 *
 * **Le fond entre dans l'URL, son opacite non.** Meme partage qu'avec le
 * theme : quelle carte ancienne on regarde est un etat d'exploration, a quel
 * dosage on la lit est un confort de lecture. Un lien partage ouvre donc le
 * bon fond, a l'opacite de celui qui le recoit.
 */
export type FondHistorique = 'cassini' | 'etatmajor';

const FONDS: readonly FondHistorique[] = ['cassini', 'etatmajor'];

export interface EtatPartage {
  filtres: Filters;
  selection: string | null;
  vue: Vue;
  fond: FondHistorique | null;
}

/** Position de depart de la carte. Ce n'est pas un filtre : elle ne restreint
 *  aucun corpus, elle ne fait que cadrer le regard. */
export interface VueCarte {
  lon: number;
  lat: number;
  zoom: number;
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

/**
 * Chaine de requete correspondant a l'etat, `''` si rien n'est pose.
 *
 * `cadrage` n'est passe que par « Copier le lien » : l'URL vivante s'en passe.
 */
export function encoder(etat: EtatPartage, cadrage?: VueCarte | null): string {
  const p = new URLSearchParams();
  for (const [cle, param] of PAIRES) {
    for (const valeur of etat.filtres[cle]) p.append(param, valeur);
  }
  for (const siecle of etat.filtres.siecles) p.append('siecle', String(siecle));
  if (etat.filtres.recherche) p.set('q', etat.filtres.recherche);
  // Parametre distinct de `q` : les deux recherches ne visent pas le meme
  // corpus, et un lien doit rouvrir la bonne. Elles s'excluent a la saisie,
  // mais une URL ecrite a la main peut porter les deux — les deux s'appliquent
  // alors, sans que rien ne casse.
  if (etat.filtres.texte) p.set('texte', etat.filtres.texte);
  if (etat.filtres.anneeProtection) p.set('annees', etat.filtres.anneeProtection.join('-'));
  if (etat.filtres.nbPalissy > 0) p.set('objets', String(etat.filtres.nbPalissy));
  if (etat.vue !== 'carte') p.set('vue', etat.vue);
  if (etat.fond) p.set('fond', etat.fond);
  if (etat.selection) p.set('ref', etat.selection);
  if (cadrage) p.set('c', `${cadrage.lon},${cadrage.lat},${cadrage.zoom}`);
  const chaine = p.toString();
  return chaine ? `?${chaine}` : '';
}

function reel(brut: string): number | null {
  const n = Number.parseFloat(brut);
  return Number.isFinite(n) ? n : null;
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
export function decoder(chaine: string): EtatPartage & { cadrage: VueCarte | null } {
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
  filtres.texte = (p.get('texte') ?? '').trim();

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

  // `notice=` a circule avant `ref=` : un lien deja partage ne doit pas casser
  // sur un alias. L'encodage, lui, n'emet que `ref`.
  const ref = p.get('ref') ?? p.get('notice');
  const vue = p.get('vue') as Vue | null;
  const fond = p.get('fond') as FondHistorique | null;
  return {
    filtres,
    selection: ref && REFERENCE.test(ref) ? ref : null,
    vue: vue && VUES.includes(vue) ? vue : 'carte',
    fond: fond && FONDS.includes(fond) ? fond : null,
    cadrage: decoderVue(p.get('c'))
  };
}

/** Vue de carte lisible dans `c=lon,lat,zoom`. Bornee : l'URL s'edite a la
 *  main, et une latitude hors domaine laisse MapLibre sur un ecran vide. */
function decoderVue(brut: string | null): VueCarte | null {
  if (!brut) return null;
  const parts = brut.split(',');
  if (parts.length !== 3) return null;
  const [lon, lat, zoom] = parts.map(reel);
  if (lon === null || lat === null || zoom === null) return null;
  if (Math.abs(lon) > 180 || Math.abs(lat) > 90 || zoom < 0 || zoom > 20) return null;
  return { lon, lat, zoom };
}
