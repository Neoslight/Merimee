/**
 * Commandes de la carte : densite, fonds historiques IGN (Cassini,
 * etat-major), attribution, et le module qui les replie.
 *
 * Les tuiles IGN sont interceptees, jamais telechargees : ce depot tient ses
 * tests hors reseau, et une suite qui dependrait de la Geoplateforme
 * deviendrait intermittente. Seule la **forme** des URL est verifiee.
 */
import { test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { attendre, demarrer, disjointes, fermerServeur, verifier, PNG_VIDE, type InfosServeur } from './_soutien';

let infos: InfosServeur;
let contexte: BrowserContext;
let page: Page;
const erreursConsole: string[] = [];
const tuilesIgn: string[] = [];

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  infos = await demarrer();
  contexte = await browser.newContext({ viewport: { width: 1600, height: 950 }, colorScheme: 'dark' });
  page = await contexte.newPage();
  page.on('console', (m) => m.type() === 'error' && erreursConsole.push(m.text()));
  page.on('pageerror', (e) => erreursConsole.push(String(e)));
  await page.route('**://data.geopf.fr/**', (route) => {
    tuilesIgn.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'image/png', body: PNG_VIDE });
  });
  await page.goto(infos.url, { waitUntil: 'domcontentloaded' });
  await attendre(page, '.chiffres b');
});

test.afterAll(async () => {
  await contexte.close();
  await fermerServeur(infos.serveur);
});

test('carte et fonds historiques', async () => {
  await test.step('attribution et legende ne se recouvrent pas', async () => {
    const boiteAttrib = (await page.locator('.maplibregl-ctrl-bottom-right').boundingBox())!;
    const boiteLegende = (await page.locator('.legende').boundingBox())!;
    verifier(
      'l attribution ne recouvre plus la legende',
      disjointes(boiteAttrib, boiteLegende),
      `attrib x${Math.round(boiteAttrib.x)} · legende x${Math.round(boiteLegende.x)}`
    );
  });

  await test.step('densite', async () => {
    await page.getByRole('button', { name: 'densité' }).click();
    await page.waitForTimeout(500);
    const etatDensite = await page.getByRole('button', { name: 'densité' }).getAttribute('aria-pressed');
    verifier('bascule densite active', etatDensite === 'true', String(etatDensite));
    await page.getByRole('button', { name: 'densité' }).click();
  });

  await test.step('les cartes anciennes sont repliees par defaut', async () => {
    verifier('aucune tuile IGN avant activation', tuilesIgn.length === 0, `${tuilesIgn.length} requetes`);
    verifier(
      'les cartes anciennes sont repliees au depart',
      (await page.locator('button.ouvrir-fonds').count()) === 1 && (await page.locator('.fonds').count()) === 0
    );
    await page.locator('button.ouvrir-fonds').click();
    await page.waitForTimeout(300);
  });

  await test.step('Cassini', async () => {
    await page.getByRole('button', { name: 'Cassini' }).click();
    await page.waitForTimeout(900);
    verifier('Cassini demande ses tuiles une fois active', tuilesIgn.length > 0, `${tuilesIgn.length} tuiles`);
    // Le prefixe `BNF-IGNF_` est obligatoire : l'identifiant nu renvoie 400.
    verifier(
      'la couche Cassini porte son prefixe BNF-IGNF_',
      tuilesIgn.every((u) => u.includes('LAYER=BNF-IGNF_GEOGRAPHICALGRIDSYSTEMS.CASSINI')) &&
        tuilesIgn.every((u) => u.includes('TILEMATRIXSET=PM')),
      tuilesIgn[0]?.slice(0, 120) ?? ''
    );
    const attributionAvec = await page.locator('.maplibregl-ctrl-attrib').innerText();
    verifier('attribution Cassini affichee', /Cassini/i.test(attributionAvec), attributionAvec.slice(0, 90));
  });

  await test.step('Cassini reste servie au-dela de son zoom maximal', async () => {
    // Le cadrage passe par `c=`, seul chemin fiable pour poser un zoom : la
    // carte n'a pas le focus clavier, et une molette simulee ne fait
    // qu'approcher la valeur.
    const urlAvantZoom = page.url();
    tuilesIgn.length = 0;
    await page.goto(`${infos.url}?fond=cassini&c=2.35,48.85,16`, { waitUntil: 'domcontentloaded' });
    await attendre(page, '.chiffres b');
    // Attente conditionnelle plutot qu'un delai fixe de 1500 ms : on sonde
    // jusqu'a ce qu'au moins une tuile soit interceptee, avec un delai
    // maximal — la vraie assertion porte sur le niveau demande, pas sur le
    // temps ecoule.
    const t0 = Date.now();
    while (tuilesIgn.length === 0 && Date.now() - t0 < 10_000) {
      await page.waitForTimeout(150);
    }
    const niveaux = tuilesIgn
      .map((u) => Number.parseInt(new URL(u).searchParams.get('TILEMATRIX') ?? '', 10))
      .filter((n) => Number.isInteger(n));
    verifier(
      'Cassini reste servie au-dela de son zoom maximal',
      niveaux.length > 0 && Math.max(...niveaux) === 14,
      niveaux.length ? `niveaux demandes ${[...new Set(niveaux)].sort((a, b) => a - b).join(', ')}` : 'aucune tuile'
    );
    await page.goto(urlAvantZoom, { waitUntil: 'domcontentloaded' });
    await attendre(page, '.chiffres b');
    await page.waitForTimeout(600);
  });

  await test.step('densite et fond historique s’excluent', async () => {
    await page.getByRole('button', { name: 'densité' }).click();
    await page.waitForTimeout(300);
    const cassiniApresDensite = await page.getByRole('button', { name: 'Cassini' }).getAttribute('aria-pressed');
    verifier('activer la densite eteint le fond historique', cassiniApresDensite === 'false', String(cassiniApresDensite));
    await page.getByRole('button', { name: 'densité' }).click();
  });

  await test.step('le fond dans l’URL, l’opacite hors de l’URL', async () => {
    await page.getByRole('button', { name: 'État-major' }).click();
    await page.waitForTimeout(400);
    const urlFond = new URL(page.url());
    verifier('le fond historique entre dans l URL', urlFond.searchParams.get('fond') === 'etatmajor', page.url());
    verifier('l opacite reste hors de l URL', !page.url().includes('opacite'), page.url());

    const dosage = page.getByRole('slider', { name: /Opacité du fond/ });
    verifier('le curseur d opacite apparait avec le fond', (await dosage.count()) === 1);

    const avantDosage = erreursConsole.length;
    await dosage.fill('100');
    await page.waitForTimeout(300);
    await dosage.fill('0');
    await page.waitForTimeout(300);
    verifier(
      'le dosage repeint sans erreur',
      erreursConsole.length === avantDosage,
      erreursConsole.slice(avantDosage, avantDosage + 2).join(' | ')
    );

    await page.getByRole('button', { name: 'État-major' }).click();
    await page.waitForTimeout(300);
    const attributionSans = await page.locator('.maplibregl-ctrl-attrib').innerText();
    verifier('l attribution disparait avec le fond', !/Cassini|état-major/i.test(attributionSans), attributionSans.slice(0, 90));
    verifier('le fond quitte l URL', !page.url().includes('fond='), page.url());
  });

  await test.step('legende et rail de semiologie', async () => {
    const legendeStatut = await page.locator('.legende .cle').count();
    await page.locator('.legende button.mode', { hasText: 'époque' }).click();
    await page.waitForTimeout(400);
    const legendeEpoque = await page.locator('.legende .cle').count();
    verifier('la legende suit le mode de coloration', legendeStatut === 3 && legendeEpoque === 5, `${legendeStatut} -> ${legendeEpoque}`);
    const epoqueActive = await page.locator('.legende button.mode', { hasText: 'époque' }).getAttribute('aria-pressed');
    verifier('le rail de coloration annonce l option retenue', epoqueActive === 'true', String(epoqueActive));
    await page.locator('.legende button.mode', { hasText: 'statut' }).click();
    await page.waitForTimeout(300);

    verifier(
      'les cartes anciennes ont leur boite a part',
      (await page.locator('.fonds > button').count()) === 2 && (await page.locator('.legende button', { hasText: 'Cassini' }).count()) === 0
    );
    verifier('un fond porte par l URL deplie le module', (await page.locator('.fonds').count()) === 1, page.url().split('?')[1] ?? '(aucun parametre)');
  });

  await test.step('Echap replie le module des cartes anciennes et rend le focus', async () => {
    // Une fiche ouverte au prealable ne doit pas se refermer : Echap doit
    // etre intercepte par le module (`preventDefault`) avant d'atteindre
    // l'ecouteur global qui referme la fiche.
    await page.locator('.bascule button', { hasText: 'Liste' }).click();
    await attendre(page, '.liste button');
    await page.locator('.liste button').first().click();
    await attendre(page, '.fiche .fermer');
    await page.locator('.bascule button', { hasText: 'Carte' }).click();

    if ((await page.locator('.fonds').count()) === 0) {
      await page.locator('button.ouvrir-fonds').click();
      await page.waitForTimeout(300);
    }
    await page.getByRole('button', { name: 'Cassini' }).focus();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    verifier('Echap replie le module des cartes anciennes', (await page.locator('.fonds').count()) === 0);
    const focusPastille = await page.evaluate(() => document.activeElement?.classList.contains('ouvrir-fonds'));
    verifier('le focus revient sur la pastille repliee', Boolean(focusPastille));
    verifier('la fiche ouverte au prealable n’a pas ete refermee par le meme Echap', (await page.locator('.fiche .fermer').count()) === 1);

    // Retour a l'etat neutre.
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  });

  verifier('aucune erreur console (carte et fonds)', erreursConsole.length === 0, erreursConsole.slice(0, 3).join(' | '));
});
