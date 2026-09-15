/**
 * Chaine des points : ou passe le temps, sur trois regimes distincts — corpus
 * entier, filtre serre, filtre plein texte. Dernier fichier de la suite : la
 * capture d'ecran finale (`tests/apercu.png`) et les tableaux de mesure
 * imprimes reprennent la place qu'ils occupaient a la fin de l'ancien
 * smoke.mjs.
 */
import { test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import {
  attendre,
  demarrer,
  effacerTout,
  fermerServeur,
  imprimerReleves,
  imprimerTransferts,
  ouvrirFiltres,
  releve,
  verifier,
  type InfosServeur,
  type Releve
} from './_soutien';

let infos: InfosServeur;
let contexte: BrowserContext;
let page: Page;
const erreursConsole: string[] = [];
const mesuresRelevees: Releve[] = [];

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  infos = await demarrer();
  contexte = await browser.newContext({ viewport: { width: 1600, height: 950 }, colorScheme: 'dark' });
  page = await contexte.newPage();
  page.on('console', (m) => m.type() === 'error' && erreursConsole.push(m.text()));
  page.on('pageerror', (e) => erreursConsole.push(String(e)));
  await page.goto(infos.url, { waitUntil: 'domcontentloaded' });
  await attendre(page, '.chiffres b');
});

test.afterAll(async () => {
  imprimerReleves(mesuresRelevees);
  imprimerTransferts(infos.octets);
  await contexte.close();
  await fermerServeur(infos.serveur);
});

test('chaîne des points', async () => {
  await test.step('corpus entier', async () => {
    await page.locator('.bascule button', { hasText: 'Carte' }).click();
    await effacerTout(page);
    await page.waitForTimeout(900);
    const pleinCorpus = await releve(page, 'corpus entier');
    mesuresRelevees.push(pleinCorpus);
    verifier(
      'la chaine des points repond sur le corpus entier',
      pleinCorpus.total < 4000 && pleinCorpus.n > 40000,
      `${pleinCorpus.n} points en ${pleinCorpus.total.toFixed(0)} ms`
    );
  });

  await test.step('filtre serre (Corse)', async () => {
    const pleinCorpus = mesuresRelevees[0];
    await ouvrirFiltres(page);
    await page.locator('.nom-section', { hasText: 'Région' }).click();
    await page.waitForTimeout(250);
    await page.locator('.option', { hasText: 'Corse' }).first().click();
    await page.waitForTimeout(900);
    const filtre = await releve(page, 'filtre serré');
    mesuresRelevees.push(filtre);
    verifier(
      'un filtre serre allege la fabrication des points',
      filtre.n < pleinCorpus.n && filtre.collection < pleinCorpus.collection,
      `${filtre.n} points, GeoJSON ${filtre.collection.toFixed(1)} ms contre ${pleinCorpus.collection.toFixed(0)} ms`
    );
  });

  await test.step('filtre plein texte (machicoulis)', async () => {
    await effacerTout(page);
    await page.waitForTimeout(600);
    await page.locator('button.cible').click();
    await page.fill('.recherche', 'machicoulis');
    await page.waitForTimeout(1600);
    const texte = await releve(page, 'plein texte');
    mesuresRelevees.push(texte);
    verifier(
      'le balayage des postings reste sous la seconde',
      texte.total < 1000 && texte.n > 400,
      `${texte.n} points en ${texte.total.toFixed(0)} ms`
    );
    await page.locator('button.cible').click();
    await page.fill('.recherche', '');
    await page.waitForTimeout(600);
  });

  await test.step('capture finale', async () => {
    await page.locator('.bascule button', { hasText: 'Carte' }).click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: 'tests/apercu.png', fullPage: false });
  });

  verifier('aucune erreur console (performance)', erreursConsole.length === 0, erreursConsole.slice(0, 3).join(' | '));
});
