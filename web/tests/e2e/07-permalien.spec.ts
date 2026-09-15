/**
 * L'URL comme seule memoire partageable de l'exploration : filtres, vue,
 * fiche selectionnee, et la vue de carte qui ne voyage que dans le lien
 * produit par « Copier le lien », jamais dans l'URL vivante.
 */
import { test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { attendre, attendreTotal, demarrer, fermerServeur, total, verifier, type InfosServeur } from './_soutien';

let infos: InfosServeur;
let contexte: BrowserContext;
let page: Page;
const erreursConsole: string[] = [];

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  infos = await demarrer();
  contexte = await browser.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: 'dark' });
  await contexte.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: infos.url });
  page = await contexte.newPage();
  page.on('console', (m) => m.type() === 'error' && erreursConsole.push(m.text()));
  page.on('pageerror', (e) => erreursConsole.push(String(e)));
  await page.goto(infos.url, { waitUntil: 'domcontentloaded' });
  await attendre(page, '.chiffres b');
  await page.waitForTimeout(1200);
});

test.afterAll(async () => {
  await contexte.close();
  await fermerServeur(infos.serveur);
});

test('permalien', async () => {
  let lienCopie = '';

  await test.step('un deplacement de carte ne reecrit pas l’URL', async () => {
    const urlAvantPan = page.url();
    const toile = (await page.locator('.maplibregl-canvas').boundingBox())!;
    await page.mouse.move(toile.x + toile.width / 2, toile.y + toile.height / 2);
    await page.mouse.down();
    await page.mouse.move(toile.x + toile.width / 2 - 220, toile.y + toile.height / 2 - 120, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(900);
    verifier('un deplacement de carte ne reecrit pas l URL', page.url() === urlAvantPan, page.url().split('?')[1] ?? '(aucun parametre)');
  });

  await test.step('au hasard, copier le lien de la vue', async () => {
    await page.getByRole('button', { name: 'Au hasard' }).click();
    await attendre(page, '.fiche .fermer');
    verifier('au hasard ouvre une fiche', /[?&]ref=PA/.test(page.url()), page.url().split('?')[1] ?? '(aucun parametre)');

    await page.getByRole('button', { name: 'Copier le lien de la notice' }).click();
    await page.waitForTimeout(400);
    lienCopie = await page.evaluate(() => navigator.clipboard.readText());
    const cadrage = /[?&]c=(-?[\d.]+),(-?[\d.]+),([\d.]+)/.exec(decodeURIComponent(lienCopie));
    verifier('le lien copie porte la vue de carte', Boolean(cadrage), lienCopie.split('?')[1] ?? lienCopie);
    verifier(
      'la vue copiee est celle apres deplacement',
      Boolean(cadrage) && (Math.abs(Number(cadrage![1]) - 2.6) > 0.05 || Math.abs(Number(cadrage![2]) - 46.6) > 0.05),
      cadrage ? `c=${cadrage[1]},${cadrage[2]},${cadrage[3]}` : 'aucun cadrage'
    );
  });

  await test.step('le lien copie se rouvre sans erreur et sans boucle', async () => {
    if (!lienCopie) return;
    // Diff depuis ce point : une erreur ailleurs dans le fichier ne doit pas
    // faire echouer cette verification precise.
    const avantRelien = erreursConsole.length;
    await page.goto(lienCopie, { waitUntil: 'domcontentloaded' });
    await attendre(page, '.chiffres b');
    await page.waitForTimeout(1200);
    verifier(
      'le lien rouvre sans erreur et sans boucle',
      erreursConsole.length === avantRelien,
      erreursConsole.slice(avantRelien, avantRelien + 2).join(' | ') || 'aucune erreur'
    );
  });

  await test.step('copier le lien depuis la fiche', async () => {
    await page.goto(`${infos.url}?ref=PA00097411`, { waitUntil: 'domcontentloaded' });
    await attendre(page, '.fiche .fermer');
    await page.getByRole('button', { name: 'Copier le lien de la notice' }).click();
    await page.waitForTimeout(400);
    const lienFiche = decodeURIComponent(await page.evaluate(() => navigator.clipboard.readText()));
    verifier(
      'copier le lien depuis la fiche',
      /ref=PA00097411/.test(lienFiche) && /c=-?[\d.]+,-?[\d.]+,[\d.]+/.test(lienFiche),
      lienFiche.split('?')[1] ?? lienFiche
    );
  });

  await test.step('notices sans coordonnees, vue liste', async () => {
    // L'ouverture d'une fiche empile une entree d'historique. Les etapes
    // precedentes ont navigue par `goto` (navigation pleine) et laissent une
    // pile d'historique dans un etat incertain pour ce fichier : on repart
    // d'un chargement neuf, seule facon fiable de garantir que l'entree que
    // `goBack()` doit defaire est bien celle poussee par le clic ci-dessous.
    await page.goto(infos.url, { waitUntil: 'domcontentloaded' });
    await attendre(page, '.chiffres b');
    await page.locator('.bascule button', { hasText: 'Liste' }).click();
    await attendre(page, '.liste header p');
    const mention = await page.textContent('.liste header p');
    verifier('notices sans coordonnees signalees', /2\s?276/.test(mention ?? ''), mention ?? '');

    await page.locator('.liste button').first().click();
    await attendre(page, '.fiche .fermer');
    const urlFiche = page.url();
    verifier('reference portee par l URL', /[?&]ref=/.test(urlFiche), urlFiche.slice(-60));
    verifier('vue liste portee par l URL', /[?&]vue=liste/.test(urlFiche));

    await page.goBack();
    await page.waitForSelector('.fiche .fermer', { state: 'detached', timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(300);
    verifier(
      'retour arriere referme la fiche',
      (await page.locator('.fiche .fermer').count()) === 0 && !/[?&]ref=/.test(page.url()),
      page.url().slice(-60)
    );
  });

  await test.step('filtre porte par l’URL, permalien restaure', async () => {
    await page.getByRole('button', { name: /^Filtres/ }).click();
    await attendre(page, '.facettes.ouvert .option', 20_000);
    await page.getByRole('button', { name: 'architecture militaire' }).click();
    await page.waitForFunction(
      () => {
        const el = document.querySelector('.chiffres span b');
        return el && Number.parseInt(el.textContent!.replace(/\D/g, ''), 10) === 1688;
      },
      null,
      { timeout: 20_000 }
    );
    const urlFiltre = page.url();
    verifier('filtre porte par l URL', /domaine=architecture\+militaire/.test(urlFiltre), urlFiltre.slice(-60));

    await page.goto(urlFiltre, { waitUntil: 'domcontentloaded' });
    await attendre(page, '.chiffres b');
    const restaure = await total(page);
    verifier('permalien restaure le filtre', restaure === 1688, `obtenu ${restaure}`);

    await page.getByRole('button', { name: /^Filtres/ }).click();
    await attendre(page, '.facettes.ouvert .option', 20_000);
    const facetteCochee = await page.locator('section:has(.nom-section:text("Domaine")) .option.choisi').count();
    verifier('facette rouverte cochee', facetteCochee === 1, `${facetteCochee} option(s)`);

    await page.getByRole('button', { name: /effacer \d+ filtres?/ }).click();
    await page.waitForFunction(() => !/[?&]domaine=/.test(location.search), null, { timeout: 20_000 });
    verifier('remise a zero nettoie l URL', page.url().split('?')[1] === undefined || !/domaine/.test(page.url()));
  });

  verifier('aucune erreur console (permalien)', erreursConsole.length === 0, erreursConsole.slice(0, 3).join(' | '));
});
