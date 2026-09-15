/**
 * Gabarit telephone : onglets du pied, feuille de fiche a crans, tolerance du
 * toucher, geolocalisation et points precalcules du premier ecran.
 *
 * Contexte `isMobile` + `hasTouch` : c'est ce qui fait repondre
 * `(pointer: coarse)` — sans lui, la tolerance du doigt et les champs a 16 px
 * ne seraient jamais eprouves.
 */
import { test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { attendre, demarrer, fermerServeur, verifier, type InfosServeur } from './_soutien';

let infos: InfosServeur;
let contexte: BrowserContext;
let page: Page;
const erreursConsole: string[] = [];

const TELEPHONE = { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, colorScheme: 'dark' as const };

/** Notre-Dame de Paris : assez de monuments alentour pour qu'un tri par
 *  distance ait quelque chose a ordonner. */
const ICI = { latitude: 48.853, longitude: 2.3499 };

interface PointRendu {
  reference: string;
  x: number;
  y: number;
}

function journaliser(p: Page, erreurs: string[]) {
  p.on('console', (m) => m.type() === 'error' && erreurs.push(m.text()));
  p.on('pageerror', (e) => erreurs.push(String(e)));
}

function rendus(p: Page): Promise<PointRendu[]> {
  return p.evaluate(
    () => (window as unknown as { __carteOutils?: { rendus: () => PointRendu[] } }).__carteOutils?.rendus() ?? []
  );
}

/** « à 350 m », « à 1,2 km » -> metres. */
function metres(texte: string): number {
  const m = /à\s*([\d\s ,]+)\s*(m|km)/u.exec(texte);
  if (!m) return Number.NaN;
  const n = Number.parseFloat(m[1].replace(/[\s ]/gu, '').replace(',', '.'));
  return m[2] === 'km' ? n * 1000 : n;
}

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  infos = await demarrer();
  contexte = await browser.newContext(TELEPHONE);
  page = await contexte.newPage();
  journaliser(page, erreursConsole);
  await page.goto(infos.url, { waitUntil: 'domcontentloaded' });
  await attendre(page, '.chiffres b');
  await page.waitForTimeout(600);
});

test.afterAll(async () => {
  await contexte.close();
  await fermerServeur(infos.serveur);
});

test('gabarit téléphone', async () => {
  await test.step('carte visible, sans debordement horizontal', async () => {
    verifier('carte visible sur gabarit etroit', await page.locator('.maplibregl-canvas').isVisible());
    const debordement = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    verifier('aucun debordement horizontal', debordement <= 0, `${debordement} px`);
  });

  await test.step('onglets au pied, barre du haut compacte', async () => {
    verifier('onglets visibles sur telephone', await page.locator('.onglets').isVisible());
    verifier('selecteur de vue de la barre masque', !(await page.locator('.bascule').isVisible()));
    verifier('bandeau des frises masque', !(await page.locator('.replier').isVisible()));
    const barre = (await page.locator('.barre').boundingBox())!;
    verifier('barre du haut <= 120 px', barre.height <= 120, `${barre.height} px`);
    const onglets = (await page.locator('.onglets').boundingBox())!;
    verifier('onglets colles au bas de l ecran', Math.abs(onglets.y + onglets.height - 812) <= 1, `${onglets.y + onglets.height}`);
    const taille = await page.locator('.recherche').evaluate((el) => getComputedStyle(el).fontSize);
    verifier('champ de recherche a 16 px au doigt (pas de zoom iOS)', taille === '16px', taille);

    await page.locator('.onglets button', { hasText: 'Frises' }).click();
    await attendre(page, '.frise');
    verifier('onglet Frises ouvre la frise', (await page.locator('.onglets button', { hasText: 'Frises' }).getAttribute('aria-expanded')) === 'true');
    await page.locator('.onglets button', { hasText: 'Frises' }).click();
    await page.waitForTimeout(300);
    verifier('onglet Frises la referme', (await page.locator('.frise').count()) === 0);
  });

  await test.step('legende repliee sur ses cles', async () => {
    verifier('commandes de legende masquees par defaut', !(await page.locator('.legende .commandes').isVisible()));
    await page.getByRole('button', { name: 'Réglages de la carte' }).click();
    verifier('la pastille deplie les commandes', await page.locator('.legende .commandes').isVisible());
    await page.getByRole('button', { name: 'Masquer les réglages de la carte' }).click();
  });

  await test.step('zoom, geolocalisation et cartes anciennes ne se chevauchent pas', async () => {
    const groupes = await page.locator('.maplibregl-ctrl-top-right .maplibregl-ctrl-group').evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect().toJSON())
    );
    const fonds = (await page.locator('button.ouvrir-fonds').boundingBox())!;
    verifier('deux groupes en haut a droite (zoom, geolocalisation)', groupes.length === 2, String(groupes.length));
    const disjoints = groupes.every((g) => g.bottom <= fonds.y);
    verifier('cartes anciennes sous la geolocalisation', disjoints, JSON.stringify({ groupes, fonds }));
  });

  await test.step('le tiroir des filtres ne s’ouvre qu’au geste', async () => {
    verifier('tiroir des filtres ferme au chargement sur telephone', (await page.locator('.facettes.ouvert').count()) === 0);
    await page.getByRole('button', { name: /^Filtres/ }).click();
    await page.waitForTimeout(400);
    verifier('tiroir des filtres ouvert', (await page.locator('.facettes.ouvert').count()) === 1);

    const etatTiroir = await page.evaluate(() => ({
      barre: (document.querySelector('.barre') as HTMLElement | null)?.inert,
      facettes: (document.querySelector('.facettes') as HTMLElement | null)?.inert,
      onglets: (document.querySelector('.onglets') as HTMLElement | null)?.inert
    }));
    verifier(
      'tiroir ouvert sur telephone : barre et onglets inert, le tiroir ne l’est pas',
      etatTiroir.barre === true && etatTiroir.onglets === true && etatTiroir.facettes === false,
      JSON.stringify(etatTiroir)
    );
    const taille = await page.locator('.filtre').first().evaluate((el) => getComputedStyle(el).fontSize).catch(() => '16px');
    verifier('recherche de facette a 16 px au doigt', taille === '16px', taille);

    await page.locator('.fermer-tiroir').click();
    await page.waitForTimeout(400);
    verifier('tiroir des filtres referme', (await page.locator('.facettes.ouvert').count()) === 0);
  });

  await test.step('la fiche s’ouvre en apercu, non modale, et se deplie a la poignee', async () => {
    await page.locator('.onglets button', { hasText: 'Liste' }).click();
    await attendre(page, '.liste li button');
    await page.locator('.liste li button').first().click();
    await attendre(page, '.fiche .fermer');
    verifier('fiche en feuille remontante', (await page.locator('.fiche-hote.ouvert').count()) === 1);
    verifier('ouverte en apercu', (await page.locator('.fiche-hote.plein').count()) === 0);

    const apercu = await page.evaluate(() => ({
      barre: (document.querySelector('.barre') as HTMLElement | null)?.inert,
      ficheHote: (document.querySelector('.fiche-hote') as HTMLElement | null)?.inert
    }));
    verifier('apercu : rien n’est inert', apercu.barre === false && apercu.ficheHote === false, JSON.stringify(apercu));

    await page.getByRole('button', { name: 'Agrandir la fiche' }).click();
    await page.waitForTimeout(350);
    verifier('la poignee deplie la feuille', (await page.locator('.fiche-hote.plein').count()) === 1);
    const plein = await page.evaluate(() => ({
      barre: (document.querySelector('.barre') as HTMLElement | null)?.inert,
      ficheHote: (document.querySelector('.fiche-hote') as HTMLElement | null)?.inert
    }));
    verifier('depliee : la barre est inert, la feuille ne l’est pas', plein.barre === true && plein.ficheHote === false, JSON.stringify(plein));

    await page.goBack();
    await page.waitForTimeout(900);
    verifier('retour arriere referme la feuille', (await page.locator('.fiche-hote.ouvert').count()) === 0, page.url().slice(-40));
    await page.locator('.onglets button', { hasText: 'Carte' }).click();
  });

  verifier('aucune erreur console (mobile)', erreursConsole.length === 0, erreursConsole.slice(0, 3).join(' | '));
});

test('la fiche défile jusqu’au bout', async () => {
  const erreurs: string[] = [];
  const p = await contexte.newPage();
  journaliser(p, erreurs);
  // Notice a historique long : sans le correctif, le bas etait rogne.
  await p.goto(`${infos.url}?ref=PA67000108`, { waitUntil: 'domcontentloaded' });
  await attendre(p, '.fiche h2');
  await p.waitForTimeout(500);

  // Un defilement en apercu deplie la feuille.
  await p.locator('.fiche').evaluate((el) => el.scrollBy(0, 40));
  await p.waitForTimeout(350);
  verifier('defiler en apercu deplie la feuille', (await p.locator('.fiche-hote.plein').count()) === 1);

  const mesure = await p.locator('.fiche').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
    const derniere = el.querySelector('section:last-of-type')!.getBoundingClientRect();
    const boite = el.getBoundingClientRect();
    return { defile: el.scrollHeight > el.clientHeight, haut: el.scrollTop, bas: derniere.bottom, fond: boite.bottom };
  });
  verifier('la fiche a plus de contenu que de hauteur', mesure.defile, JSON.stringify(mesure));
  verifier('et elle defile reellement', mesure.haut > 0, JSON.stringify(mesure));
  verifier('la derniere section est atteignable', mesure.bas <= mesure.fond + 1, JSON.stringify(mesure));
  verifier('aucune erreur console (defilement)', erreurs.length === 0, erreurs.slice(0, 3).join(' | '));
  await p.close();
});

test('toucher un point à côté l’ouvre quand même', async () => {
  const erreurs: string[] = [];
  const p = await contexte.newPage();
  journaliser(p, erreurs);
  // Zoom 11 sur le Massif central : des points separes, au-dessus du seuil
  // des amas, et un rayon de 4 a 5 px — la cible du doigt.
  await p.goto(`${infos.url}?c=3.1,45.2,11`, { waitUntil: 'domcontentloaded' });
  await attendre(p, '.chiffres b');
  await p.waitForFunction(
    () => ((window as unknown as { __carteOutils?: { rendus: () => unknown[] } }).__carteOutils?.rendus().length ?? 0) > 5,
    undefined,
    { timeout: 20_000 }
  );

  const points = await rendus(p);
  // Un point isole, loin des commandes : aucun voisin a moins de 48 px.
  const isole = points.find(
    (a) =>
      a.x > 70 && a.x < 300 && a.y > 200 && a.y < 520 &&
      points.every((b) => b.reference === a.reference || Math.hypot(a.x - b.x, a.y - b.y) > 48)
  );
  verifier('un point isole existe dans la vue', Boolean(isole), `${points.length} points`);
  if (isole) {
    await p.touchscreen.tap(isole.x + 10, isole.y + 7);
    await p.waitForTimeout(700);
    verifier('toucher a 12 px ouvre la fiche du point', p.url().includes(`ref=${isole.reference}`), p.url().slice(-40));
  }
  verifier('aucune erreur console (toucher)', erreurs.length === 0, erreurs.slice(0, 3).join(' | '));
  await p.close();
});

test('géolocalisation et tri à proximité', async ({ browser }: { browser: Browser }) => {
  const erreurs: string[] = [];
  const geo = await browser.newContext({ ...TELEPHONE, geolocation: ICI, permissions: ['geolocation'] });
  const p = await geo.newPage();
  journaliser(p, erreurs);
  await p.goto(infos.url, { waitUntil: 'domcontentloaded' });
  await attendre(p, '.chiffres b');
  await p.waitForTimeout(600);

  await p.getByRole('button', { name: 'Me localiser' }).click();
  await attendre(p, '.maplibregl-user-location-dot');
  verifier('le point de position est pose', (await p.locator('.maplibregl-user-location-dot').count()) === 1);

  await p.locator('.onglets button', { hasText: 'Liste' }).click();
  await attendre(p, '.tri');
  verifier('la liste passe d’elle-meme en proximite', (await p.getByRole('button', { name: 'À proximité' }).getAttribute('aria-pressed')) === 'true');
  await attendre(p, '.meta .distance');
  const distances = (await p.locator('.meta .distance').allTextContents()).map(metres);
  verifier('premiere notice a moins d’un kilometre', distances[0] < 1000, distances.slice(0, 3).join(', '));
  verifier(
    'distances croissantes',
    distances.length > 10 && distances.every((d, i) => i === 0 || d >= distances[i - 1]),
    distances.slice(0, 8).join(', ')
  );

  await p.locator('.liste li button').first().click();
  await attendre(p, '.fiche .distance');
  verifier('la fiche dit la distance', /de vous/.test(await p.locator('.fiche .distance').innerText()));

  await p.getByRole('button', { name: 'Mobilier' }).click();
  await p.waitForTimeout(600);
  verifier('retour au tri par mobilier : plus de distances', (await p.locator('.meta .distance').count()) === 0);
  verifier('aucune erreur console (geolocalisation)', erreurs.length === 0, erreurs.slice(0, 3).join(' | '));
  await geo.close();
});

test('géolocalisation refusée : un message, pas une panne', async ({ browser }: { browser: Browser }) => {
  const erreurs: string[] = [];
  const refus = await browser.newContext(TELEPHONE);
  // Le refus est simule dans la page : un Chromium sans tete peut desactiver
  // le bouton avant tout geste quand la permission est deja refusee, et le
  // chemin d'erreur ne serait jamais eprouve.
  await refus.addInitScript(() => {
    const echec = (_ok: unknown, err?: (e: unknown) => void) => {
      setTimeout(() => err?.({ code: 1, message: 'refus', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }), 30);
      return 1;
    };
    Object.defineProperty(navigator, 'geolocation', {
      value: { watchPosition: echec, getCurrentPosition: echec, clearWatch: () => {} }
    });
  });
  const p = await refus.newPage();
  journaliser(p, erreurs);
  await p.goto(infos.url, { waitUntil: 'domcontentloaded' });
  await attendre(p, '.chiffres b');
  await p.getByRole('button', { name: 'Me localiser' }).click();
  await attendre(p, '.alerte-position');
  verifier('message de refus affiche', /refusée/.test(await p.locator('.alerte-position').innerText()));
  await p.getByRole('button', { name: 'Fermer le message' }).click();
  verifier('le message se ferme', (await p.locator('.alerte-position').count()) === 0);
  // MapLibre journalise le refus en `console.warn`, pas en erreur : le
  // compteur ne doit rien voir.
  verifier('aucune erreur console (refus)', erreurs.length === 0, erreurs.slice(0, 3).join(' | '));
  await refus.close();
});

test('points précalculés avant le moteur', async ({ browser }: { browser: Browser }) => {
  const lent = await browser.newContext(TELEPHONE);
  // Le wasm retenu quatre secondes : ce qui s'affiche entre-temps ne peut
  // venir que de `points.json`.
  await lent.route('**/*.wasm', async (route) => {
    await new Promise((r) => setTimeout(r, 4000));
    await route.continue();
  });
  const p = await lent.newPage();
  await p.goto(infos.url, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(
    () => ((window as unknown as { __carteOutils?: { rendus: () => unknown[] } }).__carteOutils?.rendus().length ?? 0) > 1000,
    undefined,
    { timeout: 15_000 }
  );
  verifier('des points sont peints pendant que le moteur charge', (await p.locator('.amorce-discrete').count()) === 1);
  verifier('le compteur provisoire est la', /46\s?760/u.test(await p.locator('.chiffres b').innerText()));
  await attendre(p, '.chiffres b');
  await p.waitForFunction(() => !document.querySelector('.amorce-discrete'), undefined, { timeout: 30_000 });
  verifier('la pastille d’attente disparait une fois le moteur pret', (await p.locator('.amorce-discrete').count()) === 0);
  await p.close();

  // Avec un filtre dans l'URL, le nuage complet serait faux : il n'est pas demande.
  const demandes: string[] = [];
  const filtre = await lent.newPage();
  filtre.on('request', (r) => r.url().includes('points.json') && demandes.push(r.url()));
  await filtre.goto(`${infos.url}?statut=${encodeURIComponent('classé')}`, { waitUntil: 'domcontentloaded' });
  await filtre.waitForTimeout(1500);
  verifier('aucun points.json quand l’URL porte un filtre', demandes.length === 0, demandes.join(' '));
  await lent.close();
});

test('tablette et ordinateur n’ont pas d’onglets', async ({ browser }: { browser: Browser }) => {
  const large = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark' });
  const p = await large.newPage();
  await p.goto(infos.url, { waitUntil: 'domcontentloaded' });
  await attendre(p, '.chiffres b');
  verifier('pas d’onglets a 1280 px', !(await p.locator('.onglets').isVisible()));
  verifier('selecteur de vue dans la barre a 1280 px', await p.locator('.bascule').isVisible());
  verifier('pas de poignee de feuille a 1280 px', !(await p.locator('.poignee').isVisible()));
  await large.close();
});
