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
 * Le theme ne pilote que l'interface : **le fond de carte reste sombre dans
 * les deux cas**. Les points portent un lisere clair et la rampe de densite
 * monte vers le blanc — les deux supposent une carte sombre, et l'identite
 * pose des panneaux calcaire sur une carte ardoise, pas l'inverse.
 *
 * Une seule chose dement cette hypothese : un **fond historique** (Cassini,
 * etat-major) est un aplat beige clair. D'ou `carteLiseretSurClair`, que
 * `MonumentMap` substitue au lisere des que la superposition passe la moitie
 * de l'opacite.
 */
import { browser } from '$app/environment';

export type Theme = 'sombre' | 'clair';

export const CLE = 'merimee-theme';

/** Fond vectoriel sobre servi sans cle d'API. Un seul, quel que soit le
 *  theme : cf. l'en-tete. */
export const FOND = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

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
  classe: '#c85a32', inscrit: '#c9933b', mixte: '#7a5c7e', statutNul: '#9a958a',
  epoque1: '#7a5c7e', epoque2: '#4d6b74', epoque3: '#6f7f52', epoque4: '#c9933b',
  epoque5: '#c85a32',
  carteLiseret: '#fdfcfa', carteLiseretSurClair: '#2b2620', carteSelection: '#f8f7f4',
  chaleur0: 'rgba(26, 29, 32, 0)', chaleur1: '#4a3a24', chaleur2: '#c9933b',
  chaleur3: '#c85a32', chaleur4: '#f6e3cf',
  barreSourde: '#5a5347', friseTexteFaible: '#9c978c',
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
