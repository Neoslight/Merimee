/// <reference types="@sveltejs/kit" />
/**
 * Mise en cache des actifs compiles.
 *
 * GitHub Pages sert le `.wasm` de DuckDB gzippe (7,5 Mo pour 32,7 Mo bruts)
 * mais impose `Cache-Control: max-age=600`, non configurable. Le hachage du
 * nom de fichier ne sert donc a rien passe dix minutes : une visite espacee
 * repaie l'integralite du moteur SQL. Ce worker rend ce cout non recurrent.
 *
 * **Seuls les actifs de `build` sont mis en cache.** Ils portent un hachage :
 * un contenu different porte un nom different, ils ne peuvent pas devenir
 * perimes. Les Parquet de `data/` en sont volontairement exclus — leurs noms
 * sont stables d'un deploiement a l'autre, les mettre en cache exposerait a
 * servir d'anciennes donnees apres une nouvelle passe d'ETL. Ils restent
 * couverts par le cache HTTP ordinaire.
 *
 * Le shell HTML n'est pas mis en cache non plus, et c'est ce qui evite qu'un
 * deploiement reste colle : la page revient toujours du reseau, donc pointe
 * toujours vers les derniers actifs haches.
 */
import { build, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE = 'merimee-actifs';
const ACTIFS = new Set(build);

sw.addEventListener('install', () => {
  // Rien a precharger : precharger `build` telechargerait les 32,7 Mo du wasm
  // avant meme que l'utilisateur en ait besoin, et annulerait le chargement
  // paresseux que le reste de l'application applique.
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Les actifs disparus d'un deploiement a l'autre sont evacues ; ceux qui
      // survivent — le wasm, dont le hachage ne bouge qu'a une montee de
      // version de DuckDB — sont conserves. Purger par numero de version les
      // aurait tous fait retelecharger a chaque deploiement.
      for (const nom of await caches.keys()) {
        if (nom !== CACHE) await caches.delete(nom);
      }
      const cache = await caches.open(CACHE);
      for (const requete of await cache.keys()) {
        if (!ACTIFS.has(new URL(requete.url).pathname)) await cache.delete(requete);
      }
    })()
  );
});

sw.addEventListener('fetch', (event) => {
  const requete = event.request;
  if (requete.method !== 'GET') return;

  const url = new URL(requete.url);
  // Les tuiles CARTO viennent d'un autre domaine : ne pas s'en meler.
  if (url.origin !== location.origin) return;
  if (!ACTIFS.has(url.pathname)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const connu = await cache.match(url.pathname);
      if (connu) return connu;

      const reponse = await fetch(requete);
      // Une reponse partielle ou en erreur ne doit pas devenir la version de
      // reference : elle serait resservie indefiniment.
      if (reponse.status === 200) await cache.put(url.pathname, reponse.clone());
      return reponse;
    })()
  );
});

// `version` n'est pas lu, mais sa presence dans le module suffit a faire
// changer les octets du worker a chaque build, donc a declencher sa mise a
// jour par le navigateur.
export const _version = version;
