/**
 * Produit les vignettes du panneau des calques dans `static/calques/`.
 *
 *   node scripts/vignettes-calques.mjs        (apres `npm run build`)
 *
 * Pourquoi des images figees plutot qu'un apercu vivant : un apercu vivant
 * demanderait une tuile par fond a chaque ouverture du panneau — ~160 Ko pour
 * Cassini — alors que la regle du produit est qu'aucun octet IGN ne part tant
 * qu'un fond n'est pas choisi. Ces cinq fichiers pesent quelques kilo-octets
 * chacun et ne changent pas.
 *
 * Toutes cadrent le meme lieu — les Tuileries et la Seine, a z13 — pour que l'oeil
 * compare des fonds et non des endroits. Les fonds IGN viennent de leurs
 * tuiles WMTS, assemblees dans une page vide ; le plan vient de l'application
 * elle-meme (build + `tests/serveur.mjs`), dans chaque theme, pour etre le
 * plan que l'on voit, repeint compris, et non une approximation.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { demarrer } from '../tests/serveur.mjs';

const LIEU = { lon: 2.328, lat: 48.861, zoom: 13 };
/** Cote en pixels CSS ; capture a 2x pour les ecrans denses. */
const COTE = 72;
const SORTIE = new URL('../static/calques/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const IGN = [
  { cle: 'aerien', couche: 'ORTHOIMAGERY.ORTHOPHOTOS', format: 'image/jpeg' },
  { cle: 'cassini', couche: 'BNF-IGNF_GEOGRAPHICALGRIDSYSTEMS.CASSINI', format: 'image/png' },
  { cle: 'etatmajor', couche: 'GEOGRAPHICALGRIDSYSTEMS.ETATMAJOR40', format: 'image/jpeg' }
];

/** Position en pixels mondiaux (tuiles de 256) a ce zoom. */
function pixelMonde(lon, lat, zoom) {
  const n = 256 * 2 ** zoom;
  const x = ((lon + 180) / 360) * n;
  const y = ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
  return { x, y };
}

const url = (c, z, x, y) =>
  'https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile' +
  `&LAYER=${c.couche}&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX=${z}` +
  `&TILEROW=${y}&TILECOL=${x}&FORMAT=${encodeURIComponent(c.format)}`;

mkdirSync(SORTIE, { recursive: true });
const navigateur = await chromium.launch();

// --- Fonds IGN : tuiles assemblees autour du lieu ----------------------------
const page = await navigateur.newPage({ viewport: { width: COTE, height: COTE }, deviceScaleFactor: 2 });
for (const couche of IGN) {
  const centre = pixelMonde(LIEU.lon, LIEU.lat, LIEU.zoom);
  const x0 = Math.floor((centre.x - COTE / 2) / 256);
  const y0 = Math.floor((centre.y - COTE / 2) / 256);
  const x1 = Math.floor((centre.x + COTE / 2) / 256);
  const y1 = Math.floor((centre.y + COTE / 2) / 256);
  let images = '';
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const gauche = x * 256 - (centre.x - COTE / 2);
      const haut = y * 256 - (centre.y - COTE / 2);
      images += `<img src="${url(couche, LIEU.zoom, x, y)}" style="position:absolute;left:${gauche}px;top:${haut}px;width:256px;height:256px">`;
    }
  }
  await page.setContent(`<body style="margin:0;overflow:hidden;background:#eceae4">${images}</body>`);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0), undefined, {
    timeout: 30_000
  });
  await page.screenshot({ path: `${SORTIE}${couche.cle}.jpg`, type: 'jpeg', quality: 80 });
  console.log(`${couche.cle}.jpg`);
}
await page.close();

// --- Plan : l'application elle-meme, dans chaque theme -----------------------
const infos = await demarrer(new URL('../build', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
for (const [theme, schema] of [['clair', 'light'], ['sombre', 'dark']]) {
  const contexte = await navigateur.newContext({
    viewport: { width: 600, height: 600 },
    deviceScaleFactor: 2,
    colorScheme: schema
  });
  const p = await contexte.newPage();
  // Un filtre que rien ne satisfait : le fond seul, sans un point.
  await p.goto(`${infos.url}?q=zzzzzzzz&c=${LIEU.lon},${LIEU.lat},${LIEU.zoom}`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.chiffres b', { timeout: 45_000 });
  await p.addStyleTag({ content: '.scene > :not(.carte), .maplibregl-control-container { visibility: hidden !important; }' });
  await p.waitForTimeout(3000);
  const toile = await p.locator('.maplibregl-canvas').boundingBox();
  await p.screenshot({
    path: `${SORTIE}plan-${theme}.jpg`,
    type: 'jpeg',
    quality: 80,
    clip: {
      x: toile.x + toile.width / 2 - COTE / 2,
      y: toile.y + toile.height / 2 - COTE / 2,
      width: COTE,
      height: COTE
    }
  });
  console.log(`plan-${theme}.jpg`);
  await contexte.close();
}

await navigateur.close();
infos.serveur.close();
