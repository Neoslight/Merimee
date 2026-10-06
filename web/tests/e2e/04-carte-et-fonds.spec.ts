/**
 * Calques de la carte : vignette du coin, panneau, fonds IGN (photo aerienne,
 * Cassini, etat-major), couleur des points, densite, attribution.
 *
 * Les tuiles IGN sont interceptees, jamais telechargees : ce depot tient ses
 * tests hors reseau, et une suite qui dependrait de la Geoplateforme
 * deviendrait intermittente. Seule la **forme** des URL est verifiee.
 */
import { test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { attendre, demarrer, disjointes, fermerServeur, ouvrirCalques, verifier, PNG_VIDE, type InfosServeur } from './_soutien';

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

  await test.step('la legende tient le coin, la vignette a sa droite, le panneau est replie', async () => {
    verifier('aucune tuile IGN avant activation', tuilesIgn.length === 0, `${tuilesIgn.length} requetes`);
    const coin = (await page.locator('button.coin').boundingBox())!;
    const scene = (await page.locator('.scene').boundingBox())!;
    const legende = (await page.locator('.legende').boundingBox())!;
    verifier(
      'la legende est en bas a gauche',
      legende.x - scene.x < 30 && scene.y + scene.height - (legende.y + legende.height) < 30,
      `x ${Math.round(legende.x - scene.x)}, bas ${Math.round(scene.y + scene.height - legende.y - legende.height)}`
    );
    verifier('la vignette au pied, a droite de la legende', coin.x > legende.x + legende.width && scene.y + scene.height - (coin.y + coin.height) < 30);
    verifier('le panneau est replie au depart', (await page.locator('.panneau-calques').count()) === 0);
    verifier('vignette et legende ne se recouvrent pas', disjointes(coin, legende));
    const geoloc = (await page.locator('.maplibregl-ctrl-geolocate').boundingBox())!;
    const mentions = (await page.locator('.maplibregl-ctrl-attrib').boundingBox())!;
    verifier('le « i » des mentions ne touche pas la geolocalisation', mentions.y - (geoloc.y + geoloc.height) >= 8 && mentions.width < 40,
      `ecart ${Math.round(mentions.y - geoloc.y - geoloc.height)} px, largeur ${Math.round(mentions.width)}`);
    // La vignette propose Cassini tant qu'aucun fond n'est pose.
    verifier('la vignette montre Cassini', /cassini\.jpg$/.test((await page.locator('button.coin img').getAttribute('src')) ?? ''));
    await ouvrirCalques(page);
    verifier('le titre du panneau prend le focus', await page.evaluate(() => document.activeElement?.id === 'titre-calques'));
  });

  await test.step('densite', async () => {
    await page.getByRole('button', { name: 'densité' }).click();
    await page.waitForTimeout(500);
    const etatDensite = await page.getByRole('button', { name: 'densité' }).getAttribute('aria-pressed');
    verifier('bascule densite active', etatDensite === 'true', String(etatDensite));
    verifier('la legende passe a la rampe', (await page.locator('.legende .rampe').count()) === 1);
    await page.getByRole('button', { name: 'densité' }).click();
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
    const attributionAvec = await page.locator('.maplibregl-ctrl-attrib').evaluate((el) => el.textContent ?? '');
    verifier('attribution Cassini affichee', /Cassini/i.test(attributionAvec), attributionAvec.slice(0, 90));
    const opacite = await page.getByRole('slider', { name: /Opacité du fond/ }).inputValue();
    verifier('une carte ancienne arrive a 65 %', opacite === '65', opacite);
    verifier('la vignette dit qu’un fond est pose', (await page.locator('button.coin.actif').count()) === 1);
    verifier('et propose de revenir au plan', /plan-(clair|sombre)\.jpg$/.test((await page.locator('button.coin img').getAttribute('src')) ?? ''));
  });

  await test.step('photo aerienne', async () => {
    tuilesIgn.length = 0;
    await page.getByRole('button', { name: 'Photo aérienne' }).click();
    await page.waitForTimeout(900);
    verifier(
      'la photo aerienne demande les orthophotos IGN',
      tuilesIgn.length > 0 && tuilesIgn.every((u) => u.includes('LAYER=ORTHOIMAGERY.ORTHOPHOTOS')),
      tuilesIgn[0]?.slice(0, 120) ?? 'aucune tuile'
    );
    const opacite = await page.getByRole('slider', { name: /Opacité du fond/ }).inputValue();
    verifier('une photo arrive pleine', opacite === '100', opacite);
    verifier('un seul fond a la fois', (await page.getByRole('button', { name: 'Cassini' }).getAttribute('aria-pressed')) === 'false');
    verifier('le fond aerien entre dans l URL', new URL(page.url()).searchParams.get('fond') === 'aerien', page.url());
    await page.getByRole('button', { name: 'Plan', exact: true }).click();
    await page.waitForTimeout(300);
    verifier('Plan retire le fond', !page.url().includes('fond='), page.url());
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
    verifier('un fond porte par l URL allume la vignette', (await page.locator('button.coin.actif').count()) === 1);
    await page.goto(urlAvantZoom, { waitUntil: 'domcontentloaded' });
    await attendre(page, '.chiffres b');
    await page.waitForTimeout(600);
  });

  await test.step('densite et fond historique s’excluent', async () => {
    await ouvrirCalques(page);
    await page.getByRole('button', { name: 'Cassini' }).click();
    await page.getByRole('button', { name: 'densité' }).click();
    await page.waitForTimeout(300);
    const cassiniApresDensite = await page.getByRole('button', { name: 'Cassini' }).getAttribute('aria-pressed');
    verifier('activer la densite eteint le fond historique', cassiniApresDensite === 'false', String(cassiniApresDensite));
    await page.getByRole('button', { name: 'Cassini' }).click();
    const densiteApresFond = await page.getByRole('button', { name: 'densité' }).getAttribute('aria-pressed');
    verifier('choisir un fond eteint la densite', densiteApresFond === 'false', String(densiteApresFond));
    await page.getByRole('button', { name: 'Plan', exact: true }).click();
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

    await page.getByRole('button', { name: 'Plan', exact: true }).click();
    await page.waitForTimeout(300);
    const attributionSans = await page.locator('.maplibregl-ctrl-attrib').evaluate((el) => el.textContent ?? '');
    verifier('l attribution disparait avec le fond', !/Cassini|état-major/i.test(attributionSans), attributionSans.slice(0, 90));
    verifier('le fond quitte l URL', !page.url().includes('fond='), page.url());
    verifier('le curseur part avec le fond', (await dosage.count()) === 0);
  });

  await test.step('couleur des points et legende', async () => {
    const legendeStatut = await page.locator('.legende .cle').count();
    await page.locator('.panneau-calques button.mode', { hasText: 'Époque' }).click();
    await page.waitForTimeout(400);
    const legendeEpoque = await page.locator('.legende .cle').count();
    verifier('la legende suit le mode de coloration', legendeStatut === 3 && legendeEpoque === 5, `${legendeStatut} -> ${legendeEpoque}`);
    verifier('la legende titre l’epoque', /époque de construction/i.test(await page.locator('.legende .titre-legende').innerText()));
    const epoqueActive = await page.locator('.panneau-calques button.mode', { hasText: 'Époque' }).getAttribute('aria-pressed');
    verifier('la tuile de coloration annonce l option retenue', epoqueActive === 'true', String(epoqueActive));
    await page.locator('.panneau-calques button.mode', { hasText: 'Statut' }).click();
    await page.waitForTimeout(300);
    verifier('la legende ne porte plus aucun reglage', (await page.locator('.legende button.mode, .legende .commandes').count()) === 0);
  });

  await test.step('toucher la carte a cote referme le panneau', async () => {
    const toile = (await page.locator('.maplibregl-canvas').boundingBox())!;
    await page.mouse.click(toile.x + toile.width - 200, toile.y + 120);
    await page.waitForTimeout(300);
    verifier('le panneau se referme', (await page.locator('.panneau-calques').count()) === 0);
  });

  await test.step('Echap replie le panneau des calques et rend le focus', async () => {
    // Une fiche ouverte au prealable ne doit pas se refermer : Echap doit
    // etre intercepte par le panneau (`preventDefault`) avant d'atteindre
    // l'ecouteur global qui referme la fiche.
    await page.locator('.bascule button', { hasText: 'Liste' }).click();
    await attendre(page, '.liste li button');
    await page.locator('.liste li button').first().click();
    await attendre(page, '.fiche .fermer');
    await page.locator('.bascule button', { hasText: 'Carte' }).click();

    await ouvrirCalques(page);
    await page.getByRole('button', { name: 'Cassini' }).focus();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    verifier('Echap replie le panneau des calques', (await page.locator('.panneau-calques').count()) === 0);
    const focusCoin = await page.evaluate(() => document.activeElement?.classList.contains('coin'));
    verifier('le focus revient sur la vignette', Boolean(focusCoin));
    verifier('la fiche ouverte au prealable n’a pas ete refermee par le meme Echap', (await page.locator('.fiche .fermer').count()) === 1);

    // Retour a l'etat neutre.
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  });

  verifier('aucune erreur console (carte et fonds)', erreursConsole.length === 0, erreursConsole.slice(0, 3).join(' | '));
});
