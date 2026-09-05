import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    // Site 100 % statique : aucun backend, les Parquet sont servis en fichiers.
    adapter: adapter({ fallback: 'index.html', strict: false })
  }
};
