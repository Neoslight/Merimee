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

  await test.step('la croix reste a portee en bas de la fiche', async () => {
    await page.goto(`${infos.url}?ref=${NEVERS}`, { waitUntil: 'domcontentloaded' });
    await attendre(page, '.fiche h2');
    await page.waitForTimeout(600);
    await page.locator('.fiche').evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await page.waitForTimeout(300);
    const geo = await page.evaluate(() => {
      const fiche = document.querySelector('.fiche')!;
      const croix = document.querySelector('.fiche .fermer')!.getBoundingClientRect();
      const boite = fiche.getBoundingClientRect();
      return { defile: fiche.scrollTop, haut: croix.top - boite.top, bas: boite.bottom - croix.bottom };
    });
    verifier('la fiche a defile', geo.defile > 200, String(geo.defile));
    verifier('la croix est toujours en haut du panneau', geo.haut >= 0 && geo.haut < 40, JSON.stringify(geo));
    await page.locator('.fiche .fermer').click();
    await page.waitForTimeout(300);
    verifier('et elle ferme', (await page.locator('.fiche-hote:not([hidden])').count()) === 0);
  });

  await test.step('taper une recherche ou poser un filtre libere l’ecran', async () => {
    await page.goto(`${infos.url}?ref=${NEVERS}`, { waitUntil: 'domcontentloaded' });
    await attendre(page, '.fiche h2');
    await page.locator('.recherche').click();
    await page.keyboard.type('abb');
    await page.waitForTimeout(300);
    verifier('la frappe ferme la fiche', (await page.locator('.fiche-hote:not([hidden])').count()) === 0);
    verifier('sans voler le focus du champ', await page.evaluate(() => document.activeElement?.classList.contains('recherche') ?? false));
    verifier('et la frappe continue', (await page.inputValue('.recherche')) === 'abb');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    await page.goto(`${infos.url}?ref=${NEVERS}`, { waitUntil: 'domcontentloaded' });
    await attendre(page, '.fiche h2');
    await page.waitForTimeout(500);
    await page.locator('.legende .ligne', { hasText: 'Inscrit' }).first().click();
    await page.waitForTimeout(500);
    verifier('poser un filtre ferme la fiche', (await page.locator('.fiche-hote:not([hidden])').count()) === 0);
    verifier('le filtre, lui, est pose', page.url().includes('statut='), page.url().slice(-40));

    // Un lien qui porte une notice et des filtres arrive ouvert : le
    // changement vient avec la notice, il ne la referme pas.
    await page.goto(`${infos.url}?ref=${NEVERS}&domaine=${encodeURIComponent('architecture religieuse')}`, { waitUntil: 'domcontentloaded' });
    await attendre(page, '.fiche h2');
    await page.waitForTimeout(800);
    verifier('un permalien avec fiche et filtre reste ouvert', (await page.locator('.fiche-hote:not([hidden])').count()) === 1);
  });

  verifier('aucune erreur console (fiche et liste)', erreursConsole.length === 0, erreursConsole.slice(0, 3).join(' | '));
});

/** Glissement tactile synthetique : `touchscreen` de Playwright ne sait que
 *  toucher. Les evenements sont ceux que la page ecoute, au pixel pres. */
async function glisser(p: Page, selecteur: string, dy: number): Promise<void> {
  await p.evaluate(
    ({ selecteur, dy }) => {
      const cible = document.querySelector(selecteur)!;
      const boite = cible.getBoundingClientRect();
      const x = boite.left + boite.width / 2;
      const y0 = boite.top + Math.min(60, boite.height / 2);
      const toucher = (y: number) =>
        new Touch({ identifier: 1, target: cible, clientX: x, clientY: y, pageX: x, pageY: y });
      const envoyer = (type: string, y: number) =>
        cible.dispatchEvent(
          new TouchEvent(type, {
            bubbles: true,
            cancelable: true,
            touches: type === 'touchend' ? [] : [toucher(y)],
            changedTouches: [toucher(y)]
          })
        );
      envoyer('touchstart', y0);
      for (let i = 1; i <= 10; i++) envoyer('touchmove', y0 + (dy * i) / 10);
      envoyer('touchend', y0 + dy);
    },
    { selecteur, dy }
  );
}

test('téléphone : tirer la fiche vers le bas depuis son contenu', async ({ browser }: { browser: Browser }) => {
  const tel = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    colorScheme: 'dark'
  });
  const p = await tel.newPage();
  await p.goto(`${infos.url}?ref=${NEVERS}`, { waitUntil: 'domcontentloaded' });
  await attendre(p, '.fiche h2');
  await p.waitForTimeout(700);

  // Defiler d'abord : le contenu garde son geste tant qu'il n'est pas en haut.
  await p.locator('.fiche').evaluate((el) => el.scrollTo(0, 300));
  await glisser(p, '.fiche h2', 220);
  await p.waitForTimeout(500);
  verifier('fiche defilee : le glissement ne ferme rien', (await p.locator('.fiche-hote:not([hidden])').count()) === 1);

  await p.locator('.fiche').evaluate((el) => el.scrollTo(0, 0));
  await p.waitForTimeout(200);
  // Le defilement precedent a deplie la feuille : un tiers la ramene en
  // apercu, plus loin la ferme.
  verifier('la feuille est depliee', (await p.locator('.volet.plein').count()) === 1);
  await glisser(p, '.fiche h2', 260);
  await p.waitForTimeout(600);
  verifier('un tiers vers le bas : retour a l’apercu', (await p.locator('.volet.plein').count()) === 0 && (await p.locator('.fiche-hote:not([hidden])').count()) === 1);
  await glisser(p, '.fiche h2', 260);
  await p.waitForTimeout(600);
  verifier('depuis l’apercu, tirer vers le bas ferme la fiche', (await p.locator('.fiche-hote:not([hidden])').count()) === 0);
  await tel.close();
});
