/**
 * Bascule de theme : contraste WCAG dans les deux sens, fond de carte qui
 * suit le theme et se reteinte en clair, rampe de densite, persistance, et
 * les deux bascules rapprochees qui mettent deux `setStyle` en vol.
 *
 * `deux bascules rapides ne laissent qu un style` est la seule verification
 * de toute la suite qui peut echouer par intermittence sur une `AbortError`
 * de MapLibre (cf. CLAUDE.md) : elle n'est **jamais** filtree par son texte,
 * et son echec ne doit affecter qu'elle — la verification finale du fichier
 * relit le compteur d'erreurs **depuis ce point**, pas depuis le debut.
 */
import { test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import {
  attendre,
  attendreCarte,
  demarrer,
  fermerServeur,
  luminance,
  contraste,
  nomFond,
  ouvrirFrises,
  verifier,
  type InfosServeur
} from './_soutien';

let infos: InfosServeur;
let contexte: BrowserContext;
let page: Page;
const erreursConsole: string[] = [];
const fondsDemandes: string[] = [];

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  infos = await demarrer();
  contexte = await browser.newContext({ viewport: { width: 1600, height: 950 }, colorScheme: 'dark' });
  page = await contexte.newPage();
  page.on('console', (m) => m.type() === 'error' && erreursConsole.push(m.text()));
  page.on('pageerror', (e) => erreursConsole.push(String(e)));
  page.on('request', (r) => {
    if (r.url().includes('basemaps.cartocdn.com') && r.url().endsWith('style.json')) fondsDemandes.push(r.url());
  });
  await page.goto(infos.url, { waitUntil: 'domcontentloaded' });
  await attendre(page, '.chiffres b');
});

test.afterAll(async () => {
  await contexte.close();
  await fermerServeur(infos.serveur);
});

test('theme clair et sombre', async () => {
  await test.step('bascule en clair, contraste des deux themes', async () => {
    // La frise, contrairement au tiroir des filtres, n'a pas d'autre raison
    // d'etre ouverte ici : ce fichier est isole et repart d'un chargement
    // neuf, ou elle est repliee par defaut — l'ancien smoke.mjs l'ouvrait
    // plus haut dans son script monolithique et ce test heritait de cet etat.
    await ouvrirFrises(page);
    const avantTheme = erreursConsole.length;

    const sombre = await page.evaluate(() => ({
      fond: getComputedStyle(document.body).backgroundColor,
      texte: getComputedStyle(document.body).color
    }));

    await page.getByRole('button', { name: 'Clair' }).click();
    await page.waitForTimeout(1500);

    const clair = await page.evaluate(() => ({
      marque: document.documentElement.dataset.theme,
      fond: getComputedStyle(document.body).backgroundColor,
      texte: getComputedStyle(document.body).color
    }));
    verifier('bascule en theme clair', clair.marque === 'clair', String(clair.marque));

    const lf = luminance(clair.fond);
    const lt = luminance(clair.texte);
    verifier('fond effectivement clair', lf > 0.5, clair.fond);
    verifier('contraste du texte au moins 4,5:1 en clair', contraste(lf, lt) >= 4.5, `${contraste(lf, lt).toFixed(2)}:1`);

    const lfs = luminance(sombre.fond);
    const lts = luminance(sombre.texte);
    verifier(
      'contraste du texte au moins 4,5:1 en sombre',
      lfs < 0.5 && contraste(lfs, lts) >= 4.5,
      `${sombre.fond} -> ${contraste(lfs, lts).toFixed(2)}:1`
    );

    const sceneClaire = await page.evaluate(() => getComputedStyle(document.querySelector('.scene')!).backgroundColor);
    verifier('la scene suit la carte, claire en theme clair', luminance(sceneClaire) > 0.5, sceneClaire);

    const friseClaire = await page.evaluate(() => getComputedStyle(document.querySelector('.frise')!).backgroundColor);
    verifier('la frise suit le theme, claire en theme clair', luminance(friseClaire) > 0.5, friseClaire);

    verifier(
      'le style de fond suit le theme en clair',
      fondsDemandes.length >= 2 && nomFond(fondsDemandes.at(-1)!) === 'positron-gl-style' && fondsDemandes.some((u) => u.includes('dark-matter')),
      fondsDemandes.map(nomFond).join(' -> ')
    );

    const teinture = (await attendreCarte(page, (e) => e.teinture.terre > 0)).teinture;
    verifier(
      'le fond clair est reteinte aux couleurs du produit',
      teinture.ignorees === 0 && teinture.terre > 0 && teinture.mer > 0 && teinture.trait > 0 && teinture.libelle > 0,
      `terre ${teinture.terre} · mer ${teinture.mer} · trait ${teinture.trait} · libelle ${teinture.libelle} · detail ${teinture.detail} · ignorees ${teinture.ignorees}`
    );

    await page.getByRole('button', { name: 'densité' }).click();
    await page.waitForTimeout(500);
    const densiteApresTheme = await page.getByRole('button', { name: 'densité' }).getAttribute('aria-pressed');

    const haute = (await attendreCarte(page, (e) => e.chaleurHaute === '#431b09')).chaleurHaute;
    const rampeLegende = await page.evaluate(() => document.querySelector('.legende .rampe')?.getAttribute('style') ?? '');
    verifier(
      'la rampe de densite suit le theme',
      haute === '#431b09' && rampeLegende.includes('rgb(67, 27, 9)'),
      `${haute} · ${rampeLegende.slice(-30)}`
    );

    await page.getByRole('button', { name: 'densité' }).click();
    verifier(
      'les couches survivent au changement de fond',
      densiteApresTheme === 'true' && erreursConsole.length === avantTheme && (await page.locator('.legende .cle').count()) === 3,
      erreursConsole.slice(avantTheme, avantTheme + 2).join(' | ') || 'aucune erreur'
    );

    verifier('le theme reste hors de l URL', !/theme|clair|sombre/.test(page.url()), page.url().split('?')[1] ?? '(aucun parametre)');
  });

  await test.step('persistance au rechargement, retour au sombre', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await attendre(page, '.chiffres b');
    const persiste = await page.evaluate(() => document.documentElement.dataset.theme);
    verifier('le theme survit au rechargement', persiste === 'clair', String(persiste));

    await page.getByRole('button', { name: 'Sombre' }).click();
    await page.waitForTimeout(1500);
    verifier('le style de fond suit le theme en sombre', nomFond(fondsDemandes.at(-1)!) === 'dark-matter-gl-style', fondsDemandes.map(nomFond).join(' -> '));

    const teintureSombre = (await attendreCarte(page, (e) => e.teinture.terre === 0)).teinture;
    verifier(
      'le fond sombre n est pas reteinte',
      teintureSombre.terre === 0 && teintureSombre.libelle === 0,
      `${teintureSombre.terre} couche(s) de terre`
    );
  });

  let apresRafale = erreursConsole.length;

  await test.step('deux bascules rapprochees ne laissent qu’un style', async () => {
    // Deux `setStyle` en vol : MapLibre annule le premier chargement. Ce qui
    // se verifie ici, c'est qu'aucune couche ne reste orpheline entre les
    // deux — pas que l'annulation elle-meme reste silencieuse. Ne JAMAIS
    // filtrer une `AbortError` par son texte : si elle survient ici, cette
    // verification doit echouer, et elle seule.
    const avantRafale = erreursConsole.length;
    await page.getByRole('button', { name: 'Clair' }).click();
    // Les 100 ms sont deliberees : c'est ce chevauchement qui met deux
    // `setStyle` en vol, pas une temporisation a retirer.
    await page.waitForTimeout(100);
    await page.getByRole('button', { name: 'Sombre' }).click();
    await attendreCarte(page, (e) => e.teinture.terre === 0);
    verifier(
      'deux bascules rapides ne laissent qu un style',
      erreursConsole.length === avantRafale &&
        nomFond(fondsDemandes.at(-1)!) === 'dark-matter-gl-style' &&
        (await page.evaluate(() => document.documentElement.dataset.theme)) === 'sombre',
      erreursConsole.slice(avantRafale, avantRafale + 2).join(' | ') || 'aucune erreur'
    );
    // Point de reference pour la verification finale du fichier : une
    // AbortError attrapee ci-dessus ne doit faire echouer qu'elle, jamais la
    // verification generale qui suit.
    apresRafale = erreursConsole.length;
  });

  verifier(
    'aucune erreur console (theme)',
    erreursConsole.length === apresRafale,
    erreursConsole.slice(apresRafale, apresRafale + 3).join(' | ')
  );
});
