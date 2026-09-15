/**
 * Gestion du focus et de la touche Echap sur les deux calques (tiroir des
 * filtres, fiche de detail), et les regions live restantes apres le passage
 * en calques flottants.
 */
import { test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { attendre, demarrer, fermerServeur, verifier, type InfosServeur } from './_soutien';

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

test('clavier et focus', async () => {
  await test.step('un permalien ?ref= ne place pas le focus dans la fiche', async () => {
    await page.goto(`${infos.url}?ref=PA00097411`, { waitUntil: 'domcontentloaded' });
    await attendre(page, '.fiche .fermer');
    const focusHorsFiche = await page.evaluate(() => !document.activeElement || document.activeElement.closest('.fiche') === null);
    verifier('un permalien ref= n’place pas le focus dans la fiche', focusHorsFiche);
    // Nettoyage : repartir d'un etat sans notice selectionnee.
    await page.goto(infos.url, { waitUntil: 'domcontentloaded' });
    await attendre(page, '.chiffres b');
  });

  await test.step('cliquer une ligne place le focus dans la fiche, la croix le rend', async () => {
    await page.locator('.bascule button', { hasText: 'Liste' }).click();
    await attendre(page, '.liste button');
    await page.locator('.liste button').first().click();
    await attendre(page, '.fiche .fermer');
    const focusDansFiche = await page.evaluate(() => document.activeElement?.closest('.fiche') !== null);
    verifier('cliquer une ligne de la liste place le focus dans la fiche', Boolean(focusDansFiche));

    await page.locator('.fiche .fermer').click();
    await page.waitForTimeout(300);
    const focusRetourLigne = await page.evaluate(() => document.activeElement?.closest('.liste button') !== null);
    verifier('fermer la fiche par la croix rend le focus au bouton de ligne clique', Boolean(focusRetourLigne));
  });

  await test.step('le bouton Filtres place le focus sur le titre du tiroir, la croix le rend', async () => {
    await page.getByRole('button', { name: /^Filtres/ }).click();
    await attendre(page, '.facettes.ouvert .option', 20_000);
    const focusH2 = await page.evaluate(() => {
      const h2 = document.querySelector('.entete-tiroir h2');
      return h2 !== null && document.activeElement === h2;
    });
    verifier('ouvrir le tiroir place le focus sur son titre', focusH2);

    await page.locator('.fermer-tiroir').click();
    await page.waitForTimeout(300);
    const focusBoutonFiltres = await page.evaluate(() => document.activeElement?.classList.contains('filtres'));
    verifier('fermer le tiroir rend le focus au bouton Filtres', Boolean(focusBoutonFiltres));
  });

  await test.step('la fiche a perdu son aria-live', async () => {
    await page.locator('.liste button').first().click();
    await attendre(page, '.fiche .fermer');
    const live = await page.evaluate(() => document.querySelector('.fiche')?.hasAttribute('aria-live'));
    verifier('.fiche ne porte plus aria-live', live === false, String(live));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  });

  await test.step('Echap ferme la fiche', async () => {
    await page.locator('.liste button').first().click();
    await attendre(page, '.fiche .fermer');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    verifier('Echap ferme la fiche ouverte', (await page.locator('.fiche .fermer').count()) === 0);
  });

  await test.step('Echap ferme le tiroir quand la fiche est fermee', async () => {
    await page.getByRole('button', { name: /^Filtres/ }).click();
    await attendre(page, '.facettes.ouvert .option', 20_000);
    await page.locator('.entete-tiroir h2').focus();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    verifier('Echap ferme le tiroir quand aucune fiche n’est ouverte', (await page.locator('.facettes.ouvert').count()) === 0);
  });

  await test.step('un champ de recherche non vide absorbe le premier Echap', async () => {
    await page.getByRole('button', { name: /^Filtres/ }).click();
    await attendre(page, '.facettes.ouvert .option', 20_000);
    await page.fill('.recherche', 'abbaye');
    await page.locator('.recherche').focus();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    verifier(
      'le premier Echap sur un champ de recherche non vide ne ferme aucun calque',
      (await page.locator('.facettes.ouvert').count()) === 1
    );
  });

  verifier('aucune erreur console (clavier et focus)', erreursConsole.length === 0, erreursConsole.slice(0, 3).join(' | '));
});
