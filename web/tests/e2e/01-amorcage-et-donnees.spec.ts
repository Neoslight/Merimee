/**
 * Amorcage : chargement initial, carte de lien, typographie, tiroir des
 * filtres et frise au repos, et deux points de performance du demarrage —
 * prechargement du wasm et chargement differe d'Observable Plot.
 */
import { test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import {
  attendre,
  demarrer,
  fermerServeur,
  total,
  trouverChunkPlot,
  verifier,
  type InfosServeur
} from './_soutien';

let infos: InfosServeur;
let contexte: BrowserContext;
let page: Page;
const erreursConsole: string[] = [];

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  infos = await demarrer();
  // Chromium sans tete annonce `prefers-color-scheme: light` : sans ce
  // reglage l'application demarre en clair et le test du theme (ailleurs)
  // n'aurait rien a basculer. Le viewport large est celui de tout le reste
  // de la suite, sauf le fichier mobile.
  contexte = await browser.newContext({ viewport: { width: 1600, height: 950 }, colorScheme: 'dark' });
  page = await contexte.newPage();
  page.on('console', (m) => m.type() === 'error' && erreursConsole.push(m.text()));
  page.on('pageerror', (e) => erreursConsole.push(String(e)));
});

test.afterAll(async () => {
  await contexte.close();
  await fermerServeur(infos.serveur);
});

test('amorçage et données', async () => {
  await test.step('chargement initial', async () => {
    const debut = Date.now();
    await page.goto(infos.url, { waitUntil: 'domcontentloaded' });
    await attendre(page, '.chiffres b');
    const amorce = Date.now() - debut;

    const initial = await total(page);
    verifier('46 760 notices chargees', initial === 46760, `obtenu ${initial}`);
    verifier('amorcage sous 30 s', amorce < 30_000, `${amorce} ms`);

    const titre = await page.title();
    verifier(
      'titre par defaut sans fiche ouverte',
      titre === 'Mérimée — monuments historiques',
      titre
    );
  });

  await test.step('noscript present dans le HTML servi', async () => {
    // Lecture brute, hors navigateur : c'est le HTML tel que le serveur le
    // sert avant que le JS ne s'execute qui doit porter le message.
    const reponse = await page.request.get(infos.url);
    const html = await reponse.text();
    verifier('<noscript> present dans le HTML servi', /<noscript>/.test(html), '');
  });

  await test.step('carte de lien', async () => {
    // Les permaliens n'ont d'interet que si le lien colle quelque part s'affiche.
    const carte = await page.evaluate(() => ({
      image: document.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? '',
      icone: document.querySelector('link[rel="icon"]')?.getAttribute('href') ?? ''
    }));
    verifier('vignette Open Graph declaree', /^https:\/\/.+\.png$/.test(carte.image), carte.image);
    const iconeOk = await page.evaluate((href) => fetch(href).then((r) => r.status), carte.icone);
    verifier('favicon servie', iconeOk === 200, `${carte.icone} -> ${iconeOk}`);

    const points = await page.evaluate(() => (document.querySelector('.maplibregl-canvas') ? 1 : 0));
    verifier('canvas MapLibre rendu', points === 1);
  });

  await test.step('typographie', async () => {
    // `Inter` avait ete declaree pendant des mois sans qu'aucun `@font-face`
    // ne la serve : le site tournait dans la police du systeme, sans que
    // rien ne le dise. On verifie donc que les fichiers arrivent.
    await page.evaluate(() => document.fonts.ready);
    const polices = await page.evaluate(() => ({
      interface: document.fonts.check('400 14px "Plus Jakarta Sans Variable"'),
      titre: document.fonts.check('500 32px "Newsreader Variable"'),
      marque: getComputedStyle(document.querySelector('.marque strong') as Element).fontFamily
    }));
    verifier(
      'les deux polices sont reellement servies',
      polices.interface && polices.titre && /Newsreader/.test(polices.marque),
      `${polices.interface ? 'Jakarta' : 'JAKARTA MANQUANTE'} · ${polices.titre ? 'Newsreader' : 'NEWSREADER MANQUANTE'}`
    );
  });

  await test.step('le tiroir des filtres est un calque', async () => {
    // Referme au chargement, comme la frise : la carte est ce qu'on vient
    // voir. Ouvert, il ne lui prend jamais un pixel.
    const largeurCarte = (await page.locator('.maplibregl-canvas').boundingBox())!.width;
    verifier('tiroir referme par defaut au large', (await page.locator('.facettes.ouvert').count()) === 0);
    verifier(
      'le bouton des filtres est pose sur la carte',
      (await page.locator('.scene > button.filtres').count()) === 1
    );
    await page.getByRole('button', { name: /^Filtres/ }).click();
    await page.waitForTimeout(300);
    verifier('le bouton des filtres ouvre le tiroir', (await page.locator('.facettes.ouvert').count()) === 1);
    verifier(
      'le bouton des filtres s efface quand le tiroir est ouvert',
      (await page.locator('.scene > button.filtres').count()) === 0
    );
    const largeurOuverte = (await page.locator('.maplibregl-canvas').boundingBox())!.width;
    verifier(
      'le tiroir ne prend pas de largeur a la carte',
      Math.abs(largeurOuverte - largeurCarte) < 1,
      `${largeurCarte} -> ${largeurOuverte} px`
    );
    await page.locator('.fermer-tiroir').click();
    await page.waitForTimeout(300);
    verifier('la croix referme le tiroir au large', (await page.locator('.facettes.ouvert').count()) === 0);
    verifier(
      'le bouton des filtres revient avec la croix',
      (await page.locator('.scene > button.filtres').count()) === 1
    );
  });

  await test.step('frises repliees par defaut', async () => {
    verifier('frises repliees par defaut au large', (await page.locator('.frise').count()) === 0);
  });

  await test.step('chargement differe d’Observable Plot', async () => {
    // Timeline et Matrice importent Plot (209 Ko minifie) derriere un
    // `import()` : tant que la frise est fermee et qu'on n'est pas en vue
    // matrice, aucun octet du chunk qui le porte ne doit partir.
    const chunkPlot = trouverChunkPlot();
    const requetesChunk: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes(chunkPlot)) requetesChunk.push(r.url());
    });

    verifier(
      'aucun chunk Plot demande tant que la frise est fermee',
      requetesChunk.length === 0,
      `${requetesChunk.length} requete(s) vers ${chunkPlot}`
    );

    await page.getByRole('button', { name: 'Afficher les frises' }).click();
    await attendre(page, '.piste-siecles svg', 20_000);
    verifier(
      'ouvrir la frise charge le chunk Plot et l’affiche',
      requetesChunk.length > 0 && (await page.locator('.piste-siecles svg').count()) === 1,
      `${requetesChunk.length} requete(s)`
    );

    // Repli pour laisser la suite (les autres fichiers repartent d'une page
    // neuve de toute facon, mais ce fichier finit ici).
    await page.getByRole('button', { name: 'Masquer les frises' }).click();
    await page.waitForTimeout(300);
  });

  verifier('aucune erreur console (amorçage et données)', erreursConsole.length === 0, erreursConsole.slice(0, 3).join(' | '));
});
