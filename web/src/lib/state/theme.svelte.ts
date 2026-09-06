/**
 * Theme de lecture : clair par defaut, sombre au choix.
 *
 * C'est une **preference de lecture, pas un etat d'exploration** : elle ne va
 * pas dans l'URL, au meme titre que l'ouverture des tiroirs. Un lien partage
 * doit s'ouvrir dans le theme de celui qui le recoit, pas dans celui de
 * l'expediteur.
 *
 * Les deux palettes vivent dans `app.css`. MapLibre et Observable Plot ne
 * savent pas lire une `var()` : leurs couleurs sont donc **relues ici par
 * `getComputedStyle`**, une fois par bascule et non par image. Une couleur
 * ajoutee ailleurs qu'en CSS resterait muette au changement de theme.
 *
 * **Le fond de carte suit le theme**, depuis que le theme clair a le sien.
 * Deux styles CARTO, un par theme ; celui du clair est repeint aux teintes du
 * produit par `teinter()` dans `MonumentMap`, d'ou les six jetons `carte*`
 * ci-dessous. Consequence a ne pas perdre de vue : `setStyle` est de nouveau
 * appele, et il **detruit** toutes les sources et couches ajoutees.
 */
import { browser } from '$app/environment';

export type Theme = 'sombre' | 'clair';

export const CLE = 'merimee-theme';

/**
 * Un fond par theme, servis tous deux par CARTO sans cle d'API.
 *
 * Positron est un gris neutre, qui n'est pas la palette du produit : il est
 * repeint apres chargement. Dark-matter, lui, est pris tel quel — c'est la
 * reference, et aplatir ses routes et ses limites sur deux teintes changerait
 * un rendu que personne n'a demande de toucher.
 */
const FONDS = {
  clair: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  sombre: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
} as const;

export const fondPour = (choix: Theme) => FONDS[choix];

/** Jeton JavaScript -> propriete personnalisee CSS. */
const NOMS = {
  classe: '--classe',
  inscrit: '--inscrit',
  mixte: '--mixte',
  statutNul: '--statut-nul',
  epoque1: '--epoque-1',
  epoque2: '--epoque-2',
  epoque3: '--epoque-3',
  epoque4: '--epoque-4',
  epoque5: '--epoque-5',
  carteLiseret: '--carte-liseret',
  carteLiseretSurClair: '--carte-liseret-sur-clair',
  carteSelection: '--carte-selection',
  carteTerre: '--carte-terre',
  carteMer: '--carte-mer',
  carteTrait: '--carte-trait',
  carteDetail: '--carte-detail',
  carteLibelle: '--carte-libelle',
  chaleur0: '--chaleur-0',
  chaleur1: '--chaleur-1',
  chaleur2: '--chaleur-2',
  chaleur3: '--chaleur-3',
  chaleur4: '--chaleur-4',
  barreSourde: '--barre-sourde',
  friseTexteFaible: '--frise-texte-faible',
  matrice0: '--matrice-0',
  matrice1: '--matrice-1',
  matrice2: '--matrice-2',
  matrice3: '--matrice-3',
  matrice4: '--matrice-4',
  matriceTexte: '--matrice-texte',
  matriceCerclee: '--matrice-cerclee',
  accent: '--accent',
  accentPlein: '--accent-plein',
  bord: '--bord'
} as const;

export type Palette = Record<keyof typeof NOMS, string>;

/** Repli identique aux valeurs claires d'`app.css`, qui sont celles de
 *  `:root` : le rendu prealable n'a pas de document a interroger, et un graphe
 *  sans couleur serait invisible. */
const REPLI: Palette = {
  classe: '#b8381d', inscrit: '#cf6910', mixte: '#542566', statutNul: '#7d7870',
  epoque1: '#7a5c7e', epoque2: '#4d6b74', epoque3: '#6f7f52', epoque4: '#c9933b',
  epoque5: '#c85a32',
  carteLiseret: '#eceae4', carteLiseretSurClair: '#2b2620',
  carteSelection: '#1a1d20',
  carteTerre: '#eceae4', carteMer: '#dce3e8', carteTrait: '#c8c4ba',
  carteDetail: '#f3f1eb', carteLibelle: '#827e75',
  chaleur0: 'rgba(236, 234, 228, 0)', chaleur1: '#e6d0a8', chaleur2: '#c9933b',
  chaleur3: '#a9531f', chaleur4: '#431b09',
  barreSourde: '#cdc6b5', friseTexteFaible: '#6e6a62',
  matrice0: '#f4efe4', matrice1: '#e6d0a8', matrice2: '#c9933b', matrice3: '#a9531f',
  matrice4: '#431b09', matriceTexte: '#f8f7f4', matriceCerclee: '#1a1d20',
  accent: '#b94723', accentPlein: '#c85a32', bord: '#eae6dc'
};

function choixInitial(): Theme {
  if (!browser) return 'clair';
  try {
    const garde = localStorage.getItem(CLE);
    if (garde === 'clair' || garde === 'sombre') return garde;
  } catch {
    // Navigation privee, stockage refuse : la preference du systeme suffit.
  }
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'clair' : 'sombre';
}

export const theme = $state({ courant: choixInitial() });
export const palette = $state<Palette>({ ...REPLI });

/**
 * Pose le theme puis relit les jetons. L'ordre compte : interroger le style
 * calcule avant d'avoir pose `data-theme` renverrait l'ancienne palette.
 */
export function appliquer(choix: Theme) {
  theme.courant = choix;
  if (!browser) return;
  document.documentElement.dataset.theme = choix;
  try {
    localStorage.setItem(CLE, choix);
  } catch {
    // Sans stockage, le theme vaut pour la session courante.
  }
  const calcule = getComputedStyle(document.documentElement);
  for (const [cle, propriete] of Object.entries(NOMS) as [keyof Palette, string][]) {
    const valeur = calcule.getPropertyValue(propriete).trim();
    if (valeur) palette[cle] = valeur;
  }
}

/** Ne fait que retourner l'etat : c'est l'effet de la page qui appelle
 *  `appliquer`, pour que la pose du theme ait un seul chemin. */
export function basculer() {
  theme.courant = theme.courant === 'clair' ? 'sombre' : 'clair';
}
