/**
 * Precharge le wasm DuckDB des l'analyse du HTML.
 *
 * `duckdb.ts` l'importe en `?url` : c'est une simple chaine lue a l'execution
 * du JS, donc invisible au scanner de prechargement du navigateur tant que le
 * chunk de page n'a pas fini de se telecharger *et* de s'executer. Ce script
 * post-build le retrouve dans `build/_app/immutable/assets/` et injecte un
 * `<link rel="preload" as="fetch">` dans le shell HTML (`index.html` et
 * `404.html`, qui portent tous deux le gabarit complet), pour que ses 7,7 Mo
 * gzip partent en parallele du chunk de page plutot qu'a sa suite.
 *
 * Le prechargement n'est repris que par un fetch **du document** : c'est
 * pourquoi `duckdb.ts` recupere lui-meme le binaire et le passe au worker en
 * URL `blob:`. Laisse au worker, il repartait sur le reseau — mesure au
 * compteur d'octets de `tests/serveur.mjs`, deux copies (68,5 Mo).
 *
 * Le worker JS (773 Ko) n'est **pas** precharge, et ce n'est pas un oubli.
 * Mesure sur Chromium : `as="worker"` y est refuse (« unsupported `as`
 * value », ignore, avertissement en console) ; `as="script"` est accepte mais
 * sa destination ne correspond pas a celle de `new Worker()`, et le fichier
 * part deux fois (1,5 Mo servis). Ne pas le rajouter sans remesurer.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';

const racine = new URL('../build/', import.meta.url);
const assets = new URL('_app/immutable/assets/', racine);

function trouver(motif) {
  const fichiers = readdirSync(assets);
  const trouve = fichiers.find((f) => motif.test(f));
  if (!trouve) throw new Error(`precharger.mjs : aucun fichier ne correspond a ${motif} dans ${assets.pathname}`);
  return trouve;
}

const wasm = trouver(/^duckdb-eh\..+\.wasm$/);

function injecter(url) {
  if (!existsSync(url)) return;
  let html = readFileSync(url, 'utf8');

  // Le prefixe (`./`, `/`, ou `/Merimee/` sous `build:pages`) suit celui deja
  // pose par SvelteKit sur ses propres `modulepreload` : le lire evite de
  // redupliquer ici la logique de base path de `svelte.config.js`, et
  // fonctionne aussi bien pour `build` que pour `build:pages`.
  const prefixe = html.match(/href="([^"]*?)_app\/immutable\/entry\/start\.[^"]+\.js"/)?.[1];
  if (prefixe === undefined) {
    throw new Error(`precharger.mjs : prefixe introuvable dans ${url} — le gabarit a-t-il change ?`);
  }

  const hrefWasm = `${prefixe}_app/immutable/assets/${wasm}`;

  if (html.includes(hrefWasm)) return; // deja injecte (script relance sur un build inchange)

  // Juste apres le dernier `modulepreload` : le lien rejoint la meme rafale de
  // requetes que le reste du chemin critique, avant les feuilles de style et
  // le script de demarrage. `crossorigin` doit correspondre au mode du
  // `fetch()` de `duckdb.ts` (cors, credentials same-origin), sinon le
  // prechargement n'est pas repris et le binaire part deux fois.
  const modulepreloads = [...html.matchAll(/<link[^>]*rel="modulepreload"[^>]*>\n/g)];
  const dernier = modulepreloads.at(-1);
  if (!dernier) throw new Error(`precharger.mjs : aucun modulepreload dans ${url}`);
  const position = dernier.index + dernier[0].length;
  const lien = `\t\t<link href="${hrefWasm}" rel="preload" as="fetch" crossorigin="anonymous">\n`;

  html = html.slice(0, position) + lien + html.slice(position);
  writeFileSync(url, html);
}

injecter(new URL('index.html', racine));
injecter(new URL('404.html', racine));

console.log(`precharger.mjs : ${wasm} precharge dans index.html et 404.html`);
