import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  // duckdb-wasm et apache-arrow embarquent des workers : les exclure du
  // pre-bundling evite que Vite ne casse leurs imports dynamiques.
  optimizeDeps: { exclude: ['@duckdb/duckdb-wasm'] },
  worker: { format: 'es' },
  server: { fs: { allow: ['..'] } }
});
