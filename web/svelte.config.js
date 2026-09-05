import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// GitHub Pages sert le site sous /<depot>/ : le chemin de base doit etre connu
// a la compilation. Vide en local, `Merimee` pour le deploiement.
//
// La valeur est normalisee plutot qu'exigee sous forme `/Merimee` : sous Git
// Bash (Windows), MSYS reecrit toute variable d'environnement commencant par
// `/` en chemin Windows, ce qui rendait la configuration silencieusement
// invalide. On accepte donc `Merimee`, `/Merimee` ou `/Merimee/`.
const brut = (process.env.BASE_PATH ?? '').trim().replace(/\/+$/, '');
const base = brut === '' ? '' : brut.startsWith('/') ? brut : `/${brut}`;

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    // Site 100 % statique : aucun backend, les Parquet sont servis en fichiers.
    // La page de repli s'appelle 404.html plutot qu'index.html, sinon elle
    // ecrase la page prerendue ; GitHub Pages la sert pour tout chemin inconnu.
    adapter: adapter({ fallback: '404.html', strict: false }),
    paths: { base }
  }
};
