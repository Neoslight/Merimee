/**
 * Theme de lecture : sombre par defaut, clair au choix.
 *
 * C'est une **preference de lecture, pas un etat d'exploration** : elle ne va
 * pas dans l'URL, au meme titre que l'ouverture des tiroirs. Un lien partage
 * doit s'ouvrir dans le theme de celui qui le recoit, pas dans celui de
 * l'expediteur.
 *
 * Les deux palettes vivent dans `app.css`. MapLibre et Observable Plot ne
 * savent pas lire une `var()` : leurs couleurs sont donc **relues ici par
 * `getComputedStyle`**, une fois par bascule et non par image. Une couleur
 * ajoutee ailleurs qu'en CSS resterait muette au passage en clair.
 */
import { browser } from '$app/environment';

export type Theme = 'sombre' | 'clair';

export const CLE = 'merimee-theme';

/** Le fond vectoriel change avec le theme. Servis sans cle d'API. */
export const FONDS: Record<Theme, string> = {
  sombre: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  clair: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'
};

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
  carteSelection: '--carte-selection',
  chaleur0: '--chaleur-0',
  chaleur1: '--chaleur-1',
  chaleur2: '--chaleur-2',
  chaleur3: '--chaleur-3',
  chaleur4: '--chaleur-4',
  barreSourde: '--barre-sourde',
  matrice0: '--matrice-0',
  matrice1: '--matrice-1',
  matrice2: '--matrice-2',
  matrice3: '--matrice-3',
  matrice4: '--matrice-4',
  matriceTexte: '--matrice-texte',
  matriceCerclee: '--matrice-cerclee',
  accent: '--accent',
  bord: '--bord'
} as const;

export type Palette = Record<keyof typeof NOMS, string>;

/** Repli identique aux valeurs sombres d'`app.css` : le rendu prealable n'a
 *  pas de document a interroger, et un graphe sans couleur serait invisible. */
const SOMBRE: Palette = {
  classe: '#e0a458', inscrit: '#4ea8de', mixte: '#b07bd4', statutNul: '#7d8597',
  epoque1: '#7b5ea7', epoque2: '#4ea8de', epoque3: '#4bb89a', epoque4: '#e0a458',
  epoque5: '#e0715e',
  carteLiseret: '#0b0e14', carteSelection: '#f4f1ea',
  chaleur0: 'rgba(11, 14, 20, 0)', chaleur1: '#1d3b57', chaleur2: '#4ea8de',
  chaleur3: '#e0a458', chaleur4: '#f4f1ea',
  barreSourde: '#3a4150',
  matrice0: '#161b26', matrice1: '#2f5d7c', matrice2: '#4ea8de', matrice3: '#e0a458',
  matrice4: '#f4f1ea', matriceTexte: '#0b0e14', matriceCerclee: '#f4f1ea',
  accent: '#e0a458', bord: '#232a38'
};

function choixInitial(): Theme {
  if (!browser) return 'sombre';
  try {
    const garde = localStorage.getItem(CLE);
    if (garde === 'clair' || garde === 'sombre') return garde;
  } catch {
    // Navigation privee, stockage refuse : la preference du systeme suffit.
  }
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'clair' : 'sombre';
}

export const theme = $state({ courant: choixInitial() });
export const palette = $state<Palette>({ ...SOMBRE });

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
