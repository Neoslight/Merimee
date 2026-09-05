/**
 * Vignette Open Graph, capturee sur l'application elle-meme.
 *
 * Une image dessinee a la main cesse d'etre vraie au premier changement
 * d'interface ; une capture scriptee se refait en une commande.
 *
 * Usage : npm run apercu   (exige un `npm run build` prealable)
 */
import { chromium } from 'playwright';
import { demarrer } from './serveur.mjs';

const { serveur, url } = await demarrer(
  new URL('../build', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
);
const navigateur = await chromium.launch();
// Format impose par les cartes de lien : 1200 x 630.
const page = await navigateur.newPage({ viewport: { width: 1200, height: 630 } });

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.chiffres b', { timeout: 90_000 });
// Laisser la carte finir son rendu WebGL, sinon la vignette montre un fond nu.
await page.waitForTimeout(3000);
await page.screenshot({ path: 'static/apercu-social.png' });

await navigateur.close();
serveur.close();
console.log('static/apercu-social.png ecrite (1200 x 630)');
