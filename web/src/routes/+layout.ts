// Site statique : tout est pre-rendu, mais l'application elle-meme est
// strictement cliente (DuckDB-Wasm et MapLibre n'existent pas cote serveur).
export const prerender = true;
export const ssr = false;
