/**
 * Config Vitest separee de `vite.config.ts` : les deux partagent le plugin
 * `sveltekit()`, seul moyen de resoudre `$lib` et de compiler les `.svelte.ts`
 * a runes hors du serveur de dev, mais rien ici ne doit entrer dans le build
 * statique ni dans la suite e2e (`tests/e2e/`, `npm run test`), qui restent
 * inchanges.
 */
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [sveltekit()],
  test: {
    // Toute la logique testee ici (permalien, shards, teinte, buildWhere) est
    // pure JS/TS : ni DuckDB-Wasm ni navigateur ne sont instancies, un
    // environnement Node suffit et reste le plus rapide.
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'src/**/*.test.ts'],
    // Explicite plutot qu'implicite : le motif d'inclusion ci-dessus ne
    // ramasse deja pas `tests/e2e/*.spec.ts`, mais l'exclusion nommee dit
    // pourquoi sans obliger a le deduire — Playwright, lui, ne lit que
    // `tests/e2e/` (playwright.config.ts) et ignore `tests/unit/`.
    exclude: ['tests/e2e/**', 'node_modules/**']
  }
});
