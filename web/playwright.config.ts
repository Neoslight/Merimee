import { defineConfig, devices } from '@playwright/test';

/**
 * Suite de bout en bout sur le build statique.
 *
 * Un seul worker, execution serie : les mesures de temps (chaine des points,
 * amorcage) et les compteurs d'octets cote serveur exigent l'absence de
 * concurrence, et chaque fichier demarre/arrete son propre serveur sur le
 * port fixe 4180 (cf. tests/e2e/_soutien.ts) — deux serveurs en parallele s'y
 * disputeraient le port. Zero reprise : une intermittence doit rester
 * visible plutot que d'etre masquee par un second essai silencieux.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  // Chaque fichier est un seul `test()` qui enchaine de nombreuses etapes
  // (amorcage DuckDB-Wasm compris) : le delai par defaut de 30 s serait
  // franchi avant la fin d'un fichier entier, pas d'une seule assertion.
  timeout: 180_000,
  expect: { timeout: 20_000 },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
