/**
 * Fiche et liste, phase 6 : rangee d'actions (voir sur la carte, itineraire,
 * copier le lien), statut glose, fleches entre photographies, voisins, retour
 * a la liste ; liste triee A–Z, paginee au-dela de 200, avec le siecle.
 */
import { test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { attendre, demarrer, fermerServeur, verifier, type InfosServeur } from './_soutien';

let infos: InfosServeur;
let contexte: BrowserContext;
let page: Page;
const erreursConsole: string[] = [];

/** Cathedrale de Nevers : photographies multiples, voisins nombreux. */
const NEVERS = 'PA00112936';

const zoom = (p: Page) =>
  p.evaluate(() => (window as unknown as { __carteOutils: { zoom: () => number } }).__carteOutils.zoom());

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  infos = await demarrer();
  contexte = await browser.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: 'dark' });
  page = await contexte.newPage();
  page.on('console', (m) => m.type() === 'error' && erreursConsole.push(m.text()));
  page.on('pageerror', (e) => erreursConsole.push(String(e)));
});

test.afterAll(async () => {
  await contexte.close();
  await fermerServeur(infos.serveur);
});

test('fiche et liste', async () => {
  await test.step('la fiche : statut glose, actions, voisins', async () => {
    await page.goto(`${infos.url}?ref=${NEVERS}&c=2.6,46.6,5`, { waitUntil: 'domcontentloaded' });
    await attendre(page, '.fiche h2');
    verifier('le statut se dit en mots', (await page.locator('.fiche .badge').first().innerText()).trim() === 'Classé');
    verifier('avec sa glose', /protection la plus forte/.test(await page.locator('.fiche .glose-statut').innerText()));

    const itineraire = await page.locator('.fiche .actions a', { hasText: 'Itinéraire' }).getAttribute('href');
    verifier('itineraire vers OpenStreetMap', /^https:\/\/www\.openstreetmap\.org\/directions\?to=46\.98\d*%2C3\.15/.test(itineraire ?? ''), itineraire ?? '');

    const avant = await zoom(page);
    await page.getByRole('button', { name: 'Voir sur la carte' }).click();
    await page.waitForTimeout(300);
    await page.waitForFunction(
      () => !(window as unknown as { __carteOutils: { enMouvement: () => boolean } }).__carteOutils.enMouvement(),
      undefined,
      { timeout: 15_000 }
    );
    verifier('voir sur la carte vole jusqu’a l’edifice', avant < 6 && (await zoom(page)) >= 14.4, `${avant.toFixed(1)} -> ${(await zoom(page)).toFixed(1)}`);

    await page.waitForSelector('.fiche .proches li', { timeout: 15_000 });
    const voisins = await page.locator('.fiche .proches li').count();
    verifier('cinq voisins', voisins === 5, String(voisins));
    const premier = (await page.locator('.fiche .proches .nom-proche').first().innerText()).trim();
    await page.locator('.fiche .proches button').first().click();
    await page.waitForFunction((r) => !location.search.includes(r), NEVERS, { timeout: 10_000 });
    await attendre(page, '.fiche h2');
    await page.waitForTimeout(800);
    verifier('un voisin ouvre sa fiche', (await page.locator('.fiche h2').innerText()).includes(premier), premier);
  });

  await test.step('les fleches parcourent les photographies', async () => {
    await page.goto(`${infos.url}?ref=${NEVERS}`, { waitUntil: 'domcontentloaded' });
    await attendre(page, '.fiche .photo img');
    const fleches = await page.getByRole('button', { name: 'Photographie suivante' }).count();
    if (fleches === 1) {
      const avant = await page.locator('.fiche .cadre img').getAttribute('src');
      await page.getByRole('button', { name: 'Photographie suivante' }).click();
      await page.waitForTimeout(300);
      const apres = await page.locator('.fiche .cadre img').getAttribute('src');
      verifier('la fleche change d’image', avant !== apres);
      await page.getByRole('button', { name: 'Photographie précédente' }).click();
      await page.waitForTimeout(300);
      verifier('et revient', (await page.locator('.fiche .cadre img').getAttribute('src')) === avant);
    } else {
      verifier('fleches presentes quand la notice a plusieurs photographies', (await page.locator('.fiche .bande button').count()) < 2);
    }
  });

  await test.step('depuis la liste, la fiche se referme sur la liste', async () => {
    await page.goto(`${infos.url}?vue=liste`, { waitUntil: 'domcontentloaded' });
    await attendre(page, '.liste li button');
    const siecles = await page.locator('.liste .meta').allInnerTexts();
    verifier('les lignes disent leur siecle', siecles.some((t) => /[IVX]+e s\./.test(t)), siecles[0] ?? '');
    await page.locator('.liste li button').first().click();
    await attendre(page, '.fiche h2');
    verifier('la fiche le dit : retour a la liste', (await page.getByRole('button', { name: 'Retour à la liste' }).count()) === 1);
    await page.getByRole('button', { name: 'Retour à la liste' }).click();
    await page.waitForTimeout(400);
    verifier('la liste revient', (await page.locator('.contenu-liste:not([hidden])').count()) === 1);
  });

  await test.step('tri A–Z et pagination', async () => {
    const premierAvant = await page.locator('.liste .nom').first().innerText();
    await page.getByRole('button', { name: 'A–Z' }).click();
    await page.waitForFunction(
      (t) => document.querySelector('.liste .nom')?.textContent !== t,
      premierAvant,
      { timeout: 15_000 }
    );
    const titres = (await page.locator('.liste .nom').allInnerTexts()).slice(0, 30);
    const plie = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    verifier('ordre alphabetique, accents et casse confondus',
      titres.every((t, i) => i === 0 || plie(titres[i - 1]).localeCompare(plie(t), 'fr') <= 0 || plie(titres[i - 1]) <= plie(t)),
      titres.slice(0, 4).join(' | '));
    const avant = await page.locator('.liste li').count();
    await page.getByRole('button', { name: /notices de plus/ }).click();
    await page.waitForFunction((n) => document.querySelectorAll('.liste li').length > n, avant, { timeout: 15_000 });
    const apres = await page.locator('.liste li').count();
    verifier('« de plus » ajoute 200 lignes', avant === 200 && apres === 400, `${avant} -> ${apres}`);
  });

  verifier('aucune erreur console (fiche et liste)', erreursConsole.length === 0, erreursConsole.slice(0, 3).join(' | '));
});
