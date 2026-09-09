/**
 * Etat des filtres et construction du predicat SQL.
 *
 * Chaque cle produit sa propre clause. Cette separation permet d'evaluer une
 * facette en excluant son propre filtre : sinon toutes les options non
 * cochees tombent a zero des la premiere selection et le filtrage croise
 * devient inutilisable.
 */
import { lit, litList } from '$lib/db/duckdb';
import { clauseTexte } from '$lib/db/texte';
import { romain } from '$lib/format';

export type FacetKey =
  | 'statut'
  | 'siecles'
  | 'periodes'
  | 'domaines'
  | 'denominations'
  | 'auteurs'
  | 'regions'
  | 'departements'
  | 'proprietaires'
  | 'anneeProtection'
  | 'nbPalissy'
  | 'recherche'
  | 'texte'
  | 'bbox';

export interface Filters {
  statut: string[];
  siecles: number[];
  periodes: string[];
  domaines: string[];
  denominations: string[];
  auteurs: string[];
  regions: string[];
  departements: string[];
  proprietaires: string[];
  anneeProtection: [number, number] | null;
  nbPalissy: number;
  recherche: string;
  /** Terme cherche dans les historiques. Distinct de `recherche`, qui ne vise
   *  que titre, commune et departement : les deux n'ont ni le meme cout ni le
   *  meme sens, et le bouton de la barre choisit lequel la saisie alimente. */
  texte: string;
  bbox: [number, number, number, number] | null;
}

/** Minuscules sans accents : la forme sous laquelle `search_key` est stockee,
 *  et celle que `strip_accents(lower(...))` produit cote DuckDB. */
export function replier(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export const ANNEE_MIN = 1840;
export const ANNEE_MAX = 2026;

/** Etat neutre. Exporte pour que la lecture d'un permalien parte d'une base
 *  propre plutot que de fusionner avec les filtres deja poses. */
export function filtresVides(): Filters {
  return {
    statut: [],
    siecles: [],
    periodes: [],
    domaines: [],
    denominations: [],
    auteurs: [],
    regions: [],
    departements: [],
    proprietaires: [],
    anneeProtection: null,
    nbPalissy: 0,
    recherche: '',
    texte: '',
    bbox: null
  };
}

export const filters = $state<Filters>(filtresVides());

/**
 * Identifiants de terme du filtre plein texte.
 *
 * Troisieme etat miroir hors de `filters`, apres le champ de la barre et le
 * suivi de vue de la carte. Il vit ici plutot que dans `filters` pour deux
 * raisons : l'URL doit porter le mot saisi et non des entiers opaques, et
 * `JSON.stringify(filters)` sert de signature au cycle de requetes — les
 * identifiants derivant du terme, les y ajouter ne ferait que doubler la cle.
 *
 * **A poser avant `filters.texte`**, jamais apres : c'est l'ecriture du terme
 * qui declenche le cycle, et il doit trouver les identifiants en place.
 *
 * `null` et `[]` ne disent pas la meme chose : `null`, c'est « pas encore
 * resolu » — index en cours de chargement — et le filtre s'efface plutot que
 * de vider l'ecran le temps d'un aller-retour ; `[]`, c'est « resolu, aucun
 * mot connu », et la reponse honnete est alors zero notice.
 */
let termesResolus: number[] | null = null;

/**
 * La saisie telle qu'elle a ete tapee, pour l'affichage seul.
 *
 * `filters.recherche` et `filters.texte` portent la forme **repliee** —
 * minuscules sans accents — parce que c'est elle qui interroge `search_key` et
 * le lexique. Cette forme fuyait dans les puces : on tapait « jube » et la
 * puce annoncait « historiques : « jube » ». Elle vit hors de `filters` pour
 * la meme raison que `termesResolus` : elle en derive, et l'ajouter a
 * `JSON.stringify(filters)` doublerait la signature du cycle de requetes sans
 * rien y apporter.
 *
 * Repli volontaire sur la forme repliee quand elle est vide : un permalien
 * ouvre l'application avec un filtre mais sans saisie, et la puce doit quand
 * meme se nommer.
 */
let saisieBrute = '';

export function poserSaisie(brute: string): void {
  saisieBrute = brute.trim();
}

/** Rend la saisie d'origine quand elle correspond au filtre courant, la forme
 *  repliee sinon — cas d'un permalien, ou d'un filtre pose sans passer par le
 *  champ. Comparer les deux formes evite d'afficher une saisie perimee. */
function affichable(replie: string): string {
  return replier(saisieBrute) === replie ? saisieBrute : replie;
}

export function poserTermes(termes: readonly number[] | null): void {
  termesResolus = termes === null ? null : [...termes];
}

/** Lus par `queries.liste()`, qui en tire le classement BM25. */
export function termesTexte(): readonly number[] | null {
  return termesResolus;
}

/** Colonne `LIST` -> `list_has_any`, sans jointure ni table de liaison. */
function listeClause(colonne: string, valeurs: readonly string[]): string | null {
  return valeurs.length ? `list_has_any(${colonne}, ${litList(valeurs)})` : null;
}

const CLAUSES: Record<FacetKey, (f: Filters) => string | null> = {
  statut: (f) =>
    f.statut.length ? `statut IN (${f.statut.map(lit).join(', ')})` : null,
  siecles: (f) =>
    f.siecles.length ? `list_has_any(siecles, [${f.siecles.join(', ')}]::TINYINT[])` : null,
  periodes: (f) => listeClause('periodes', f.periodes),
  domaines: (f) => listeClause('domaines', f.domaines),
  denominations: (f) => listeClause('denominations', f.denominations),
  auteurs: (f) => listeClause('auteurs', f.auteurs),
  proprietaires: (f) => listeClause('proprietaires', f.proprietaires),
  regions: (f) => (f.regions.length ? `region IN (${f.regions.map(lit).join(', ')})` : null),
  // La facette expose le nom du departement, pas son code : le predicat doit
  // porter sur la meme colonne que les libelles affiches.
  departements: (f) =>
    f.departements.length ? `departement_nom IN (${f.departements.map(lit).join(', ')})` : null,
  // Semi-jointure sur les actes plutot que sur `annee_premiere/derniere` :
  // une notice protegee en 1925 puis en 1990 ne doit pas apparaitre pour 1960.
  anneeProtection: (f) =>
    f.anneeProtection
      ? `reference IN (SELECT reference FROM protections WHERE annee BETWEEN ${f.anneeProtection[0]} AND ${f.anneeProtection[1]})`
      : null,
  nbPalissy: (f) => (f.nbPalissy > 0 ? `nb_palissy >= ${f.nbPalissy}` : null),
  // Chaque mot est cherche separement : `search_key` concatene titre, commune
  // et departement, donc « chateau bordeaux » n'y apparait jamais d'un seul
  // tenant. Les mots doivent tous etre presents, dans n'importe quel ordre.
  recherche: (f) => {
    const mots = f.recherche.trim().split(/\s+/).filter(Boolean);
    if (!mots.length) return null;
    return mots.map((mot) => `search_key LIKE ${lit(`%${mot}%`)}`).join(' AND ');
  },
  // Le predicat ne porte pas le terme mais les identifiants que le lexique lui
  // a fait correspondre, poses par `poserTermes`. Tant qu'ils manquent — index
  // en cours de chargement, ou mot absent du corpus — la clause s'efface : un
  // terme introuvable ne doit pas vider le tableau de bord en silence, c'est la
  // vue liste qui le dit.
  texte: (f) => {
    if (!f.texte || termesResolus === null) return null;
    return termesResolus.length ? clauseTexte(termesResolus) : 'FALSE';
  },
  bbox: (f) =>
    f.bbox
      ? `lat BETWEEN ${f.bbox[1]} AND ${f.bbox[3]} AND lon BETWEEN ${f.bbox[0]} AND ${f.bbox[2]}`
      : null
};

/**
 * Predicat SQL courant. `except` retire une ou plusieurs cles : c'est ce qui
 * permet a une facette de continuer a montrer ses options alternatives. La
 * matrice en retire deux, une par axe.
 */
export function buildWhere(f: Filters, except?: FacetKey | readonly FacetKey[]): string {
  const exclues = except === undefined ? [] : typeof except === 'string' ? [except] : except;
  const clauses = (Object.keys(CLAUSES) as FacetKey[])
    .filter((key) => !exclues.includes(key))
    .map((key) => CLAUSES[key](f))
    .filter((clause): clause is string => clause !== null);
  return clauses.length ? clauses.join(' AND ') : 'TRUE';
}

export function toggle<K extends 'statut' | 'periodes' | 'domaines' | 'denominations' | 'auteurs' | 'regions' | 'departements' | 'proprietaires'>(
  cle: K,
  valeur: string
): void {
  const liste = filters[cle] as string[];
  const index = liste.indexOf(valeur);
  if (index === -1) liste.push(valeur);
  else liste.splice(index, 1);
}

export function toggleSiecle(siecle: number): void {
  const index = filters.siecles.indexOf(siecle);
  if (index === -1) filters.siecles.push(siecle);
  else filters.siecles.splice(index, 1);
}

export function reset(): void {
  Object.assign(filters, filtresVides());
  termesResolus = null;
}

/** Nombre de filtres actifs, pour l'affichage du bouton de remise a zero. */
export function countActive(f: Filters): number {
  return (Object.keys(CLAUSES) as FacetKey[]).filter((key) => CLAUSES[key](f) !== null).length;
}

/** Un critere pose, tel qu'il s'affiche en puce. */
export interface Jeton {
  cle: FacetKey;
  /** Absente pour les filtres scalaires : plage d'annees, seuil Palissy, zone. */
  valeur?: string;
  libelle: string;
}

/** Cles multivaluees : une puce par valeur cochee. */
const MULTIPLES: readonly FacetKey[] = [
  'statut', 'domaines', 'denominations', 'auteurs',
  'regions', 'departements', 'proprietaires', 'periodes'
];

/**
 * Liste aplatie des criteres poses. Les filtres actifs n'etaient jusqu'ici
 * resumes que par leur nombre : savoir *lesquels* obligeait a rouvrir chaque
 * section, et en retirer un seul a le retrouver parmi 40 valeurs.
 *
 * L'ordre suit `CLAUSES`, la meme table que `buildWhere` et `countActive` :
 * une seule liste de cles fait autorite.
 */
export function jetonsActifs(f: Filters): Jeton[] {
  const jetons: Jeton[] = [];
  for (const cle of Object.keys(CLAUSES) as FacetKey[]) {
    if (MULTIPLES.includes(cle)) {
      for (const valeur of f[cle] as string[]) jetons.push({ cle, valeur, libelle: valeur });
    } else if (cle === 'siecles') {
      for (const siecle of f.siecles) {
        jetons.push({ cle, valeur: String(siecle), libelle: `${romain(siecle)}e siècle` });
      }
    } else if (cle === 'anneeProtection' && f.anneeProtection) {
      jetons.push({ cle, libelle: `${f.anneeProtection[0]} – ${f.anneeProtection[1]}` });
    } else if (cle === 'nbPalissy' && f.nbPalissy > 0) {
      jetons.push({ cle, libelle: `≥ ${f.nbPalissy} objets` });
    } else if (cle === 'recherche' && f.recherche) {
      jetons.push({ cle, libelle: `« ${affichable(f.recherche)} »` });
    } else if (cle === 'texte' && f.texte) {
      // Libelle distinct de celui de la recherche par titre : les deux puces
      // seraient autrement indiscernables, pour un lecteur d'ecran comme pour
      // Playwright en mode strict.
      jetons.push({ cle, libelle: `historiques : « ${affichable(f.texte)} »` });
    } else if (cle === 'bbox' && f.bbox) {
      jetons.push({ cle, libelle: 'zone visible' });
    }
  }
  return jetons;
}

/**
 * Retire une valeur d'une facette, ou le filtre entier s'il est scalaire.
 *
 * Deux cles ont un etat miroir hors de `filters` — le champ de recherche de la
 * barre et le suivi de vue de la carte — que l'appelant doit remettre lui-meme :
 * les remettre ici obligerait cet etat a connaitre l'interface.
 */
export function retirer(cle: FacetKey, valeur?: string): void {
  if (cle === 'siecles') {
    const siecle = Number(valeur);
    filters.siecles = filters.siecles.filter((s) => s !== siecle);
  } else if (MULTIPLES.includes(cle)) {
    // Retrait en place, comme `toggle` : reaffecter la cle ferait perdre le
    // proxy reactif que `$state` a pose sur le tableau.
    const liste = filters[cle] as string[];
    const index = liste.indexOf(valeur ?? '');
    if (index !== -1) liste.splice(index, 1);
  } else if (cle === 'anneeProtection') {
    filters.anneeProtection = null;
  } else if (cle === 'nbPalissy') {
    filters.nbPalissy = 0;
  } else if (cle === 'recherche') {
    filters.recherche = '';
  } else if (cle === 'texte') {
    filters.texte = '';
    termesResolus = null;
  } else if (cle === 'bbox') {
    filters.bbox = null;
  }
}
