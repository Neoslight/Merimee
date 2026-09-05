/**
 * Serveur statique de test, avec support des requetes Range et comptage des
 * octets reellement servis par fichier.
 *
 * Le comptage cote serveur est le seul fiable : les lectures Parquet partent
 * du worker DuckDB, que `page.on('response')` de Playwright n'attribue pas a
 * la page.
 */
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.parquet': 'application/vnd.apache.parquet',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
  '.ico': 'image/x-icon'
};

export function demarrer(racine, port = 4180) {
  const octets = new Map();
  const journal = [];

  const serveur = createServer((requete, reponse) => {
    const url = new URL(requete.url, 'http://localhost');

    if (url.pathname === '/__stats') {
      reponse.writeHead(200, { 'content-type': 'application/json' });
      reponse.end(JSON.stringify(Object.fromEntries(octets)));
      return;
    }
    if (url.pathname === '/__reset') {
      octets.clear();
      reponse.writeHead(204).end();
      return;
    }

    if (url.pathname.endsWith('.parquet')) {
      journal.push(`${requete.method} ${url.pathname} range=${requete.headers.range ?? '-'}`);
    }

    const relatif = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    let chemin = join(racine, relatif);
    let infos;
    try {
      infos = statSync(chemin);
      if (infos.isDirectory()) {
        chemin = join(chemin, 'index.html');
        infos = statSync(chemin);
      }
    } catch {
      // Repli SPA, comme le ferait un hebergeur statique.
      chemin = join(racine, 'index.html');
      try {
        infos = statSync(chemin);
      } catch {
        reponse.writeHead(404).end('introuvable');
        return;
      }
    }

    const type = TYPES[extname(chemin)] ?? 'application/octet-stream';

    if (requete.method === 'HEAD') {
      reponse.writeHead(200, {
        'content-type': type,
        'content-length': infos.size,
        'accept-ranges': 'bytes'
      });
      reponse.end();
      return;
    }
    const plage = requete.headers.range;
    const compter = (n) => octets.set(url.pathname, (octets.get(url.pathname) ?? 0) + n);

    if (plage) {
      const [debut, fin] = plage.replace('bytes=', '').split('-');
      const d = Number.parseInt(debut, 10) || 0;
      const f = fin ? Number.parseInt(fin, 10) : infos.size - 1;
      const taille = f - d + 1;
      compter(taille);
      reponse.writeHead(206, {
        'content-type': type,
        'content-length': taille,
        'content-range': `bytes ${d}-${f}/${infos.size}`,
        'accept-ranges': 'bytes'
      });
      createReadStream(chemin, { start: d, end: f }).pipe(reponse);
      return;
    }

    compter(infos.size);
    reponse.writeHead(200, {
      'content-type': type,
      'content-length': infos.size,
      'accept-ranges': 'bytes'
    });
    createReadStream(chemin).pipe(reponse);
  });

  return new Promise((resoudre) => {
    serveur.listen(port, () => resoudre({ serveur, octets, journal, url: `http://localhost:${port}` }));
  });
}
