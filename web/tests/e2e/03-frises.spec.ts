/**
 * Les deux frises (epoque de construction, annee de protection) : gestes a la
 * souris (clic, glissement) et au clavier, repli/depli, et croisement avec le
 * corpus. La matrice siecle x decennie, qui vivait ici, a ete supprimee.
 */
import { test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import {
  attendre,
  attendreTotal,
  demarrer,
  fermerServeur,
  ouvrirFiltres,
  ouvrirFrises,
  verifier,
  type InfosServeur
} from './_soutien';

let infos: InfosServeur;
let contexte: BrowserContext;
let page: Page;
const erreursConsole: string[] = [];

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
  await contexte.close();
  await fermerServeur(infos.serveur);
});

test('frises', async () => {
  await test.step('brossage de l’axe construction (siecles)', async () => {
    await ouvrirFrises(page);
    const piste = (await page.locator('.piste-siecles').boundingBox())!;
    await page.mouse.move(piste.x + piste.width * 0.5, piste.y + piste.height * 0.6);
    await page.mouse.down();
    await page.mouse.move(piste.x + piste.width * 0.8, piste.y + piste.height * 0.6, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(700);
    const brosses = new URL(page.url()).searchParams.getAll('siecle');
    verifier('un glissement pose une plage de siecles', brosses.length >= 3, brosses.join(', ') || 'aucun siecle');
    await page.getByRole('button', { name: /effacer \d+ filtres?/ }).click();
    await attendreTotal(page, 46760);
  });

  await test.step('l’axe des protections repond aux memes gestes', async () => {
    const pisteAnnees = (await page.locator('.piste-annees').boundingBox())!;
    await page.mouse.click(pisteAnnees.x + pisteAnnees.width * 0.6, pisteAnnees.y + pisteAnnees.height * 0.5);
    await page.waitForFunction(() => /annees=/.test(location.search), null, { timeout: 20_000 });
    const uneAnnee = new URL(page.url()).searchParams.get('annees');
    verifier(
      'un clic sur l axe des protections pose une annee',
      /^\d{4}-\d{4}$/.test(uneAnnee ?? '') && uneAnnee!.split('-')[0] === uneAnnee!.split('-')[1],
      uneAnnee ?? 'aucune'
    );
    await page.getByRole('button', { name: /effacer \d+ filtres?/ }).click();
    await page.waitForFunction(() => !/annees=/.test(location.search), null, { timeout: 20_000 });
  });

  await test.step('chemin clavier : siecle', async () => {
    const piste = page.locator('.piste-siecles');
    await piste.focus();
    await page.waitForTimeout(150);
    const annonceInitiale = (await page.locator('.piste-siecles .lecteur-seul').textContent()) ?? '';
    verifier('la region live de l’axe des siecles annonce une valeur', annonceInitiale.trim().length > 0, annonceInitiale);

    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /[?&]siecle=/.test(location.search), null, { timeout: 10_000 });
    verifier('Entree sur la piste des siecles pose un siecle', /[?&]siecle=/.test(page.url()), page.url().split('?')[1] ?? '');

    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !/[?&]siecle=/.test(location.search), null, { timeout: 10_000 });
    verifier('Entree une seconde fois retire le meme siecle', !/[?&]siecle=/.test(page.url()), page.url().split('?')[1] ?? '(aucun)');

    await page.keyboard.press('Shift+ArrowRight');
    await page.waitForTimeout(150);
    await page.keyboard.press('Shift+ArrowRight');
    await page.waitForFunction(() => new URLSearchParams(location.search).getAll('siecle').length >= 2, null, {
      timeout: 10_000
    });
    const siecles = new URL(page.url()).searchParams.getAll('siecle').map(Number).sort((a, b) => a - b);
    const contigus = siecles.every((s, i) => i === 0 || s === siecles[i - 1] + 1);
    verifier(
      'Majuscule + fleche deux fois pose plusieurs siecles contigus',
      siecles.length >= 2 && contigus,
      siecles.join(', ')
    );

    await page.getByRole('button', { name: /effacer \d+ filtres?/ }).click();
    await attendreTotal(page, 46760);
  });

  await test.step('chemin clavier : annee de protection', async () => {
    const piste = page.locator('.piste-annees');
    await piste.focus();
    await page.waitForTimeout(150);
    const annonceInitiale = (await page.locator('.piste-annees .lecteur-seul').textContent()) ?? '';
    verifier(
      'la region live de l’axe des protections annonce une valeur',
      annonceInitiale.trim().length > 0,
      annonceInitiale
    );

    await page.keyboard.press('Shift+ArrowRight');
    await page.waitForFunction(() => /[?&]annees=/.test(location.search), null, { timeout: 10_000 });
    const bornes = new URL(page.url()).searchParams.get('annees');
    const [a, b] = (bornes ?? '').split('-').map(Number);
    verifier('Majuscule + fleche sur l’axe des protections pose une plage croissante', Number.isInteger(a) && Number.isInteger(b) && a < b, bornes ?? 'aucune');

    await page.getByRole('button', { name: /effacer \d+ filtres?/ }).click();
    await page.waitForFunction(() => !/annees=/.test(location.search), null, { timeout: 20_000 });
  });

  await test.step('repli et largeur des deux pistes', async () => {
    await page.getByRole('button', { name: 'Masquer les frises' }).click();
    await page.waitForTimeout(400);
    verifier('les frises se replient au large', (await page.locator('.frise').count()) === 0);
    await page.getByRole('button', { name: 'Afficher les frises' }).click();
    await page.waitForTimeout(600);
    verifier('les frises reviennent', (await page.locator('.frise').count()) === 1);

    // Les deux graphiques remplissent leur colonne : ils partageaient la
    // mesure du premier, et celui des annees laissait un tiers de sa place
    // vide.
    const largeurs = await page.evaluate(() => {
      const boite = (s: string) => document.querySelector(s)!.getBoundingClientRect().width;
      const svg = (s: string) => document.querySelector(`${s} svg`)!.getBoundingClientRect().width;
      return { siecles: boite('.piste-siecles') - svg('.piste-siecles'), annees: boite('.piste-annees') - svg('.piste-annees') };
    });
    verifier(
      'chaque frise remplit sa colonne',
      Math.abs(largeurs.siecles) < 4 && Math.abs(largeurs.annees) < 4,
      `restes ${largeurs.siecles.toFixed(1)} et ${largeurs.annees.toFixed(1)} px`
    );
  });

  await test.step('un ancien lien ?vue=matrice retombe sur la carte', async () => {
    // La vue a ete supprimee, pas les liens qui la portaient : ils s'ouvrent
    // sur la carte, sans erreur, et l'URL est renormalisee.
    await page.goto(`${infos.url}?vue=matrice`, { waitUntil: 'domcontentloaded' });
    await attendre(page, '.chiffres b');
    verifier('vue=matrice ouvre la carte', await page.locator('.maplibregl-canvas').isVisible());
    verifier('aucune liste ni matrice par-dessus', (await page.locator('.liste, .matrice').count()) === 0);
    verifier('deux vues dans la barre', (await page.locator('.bascule button').count()) === 2);
    await page.goto(infos.url, { waitUntil: 'domcontentloaded' });
    await attendre(page, '.chiffres b');
  });

  verifier('aucune erreur console (frises)', erreursConsole.length === 0, erreursConsole.slice(0, 3).join(' | '));
});
