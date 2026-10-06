/**
 * Camera : cadrage de depart, vol de « Au hasard », rapprochement depuis la
 * liste, lien centre sur sa notice, epingle de selection et infobulle de
 * survol. Les calculs purs (`lib/carte/camera.ts`) sont eprouves en Vitest ;
 * ici on verifie ce que la carte fait reellement de ses mouvements.
 */
import { test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { attendre, demarrer, fermerServeur, verifier, type InfosServeur } from './_soutien';

let infos: InfosServeur;
let contexte: BrowserContext;
const erreursConsole: string[] = [];

const BUREAU = { viewport: { width: 1400, height: 900 }, colorScheme: 'dark' as const };
const TELEPHONE = { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, colorScheme: 'dark' as const };

/** Emprise de la metropole, meme valeur que `METROPOLE` dans `camera.ts`. */
const METROPOLE = [-5.3, 41.2, 9.7, 51.2];
/** Domaine de Nohant : une notice situee, illustree, hors de toute grande ville. */
const NOHANT = 'PA00097411';

interface PointRendu {
  reference: string;
  x: number;
  y: number;
}

interface Outils {
  rendus: () => PointRendu[];
  zoom: () => number;
  bornes: () => number[];
  enMouvement: () => boolean;
}

function outil<C extends keyof Outils>(p: Page, cle: C): Promise<ReturnType<Outils[C]>> {
  return p.evaluate(
    (cle) => (window as unknown as { __carteOutils: Record<string, () => unknown> }).__carteOutils[cle](),
    cle
  ) as Promise<ReturnType<Outils[C]>>;
}

function journaliser(p: Page) {
  p.on('console', (m) => m.type() === 'error' && erreursConsole.push(m.text()));
  p.on('pageerror', (e) => erreursConsole.push(String(e)));
}

async function ouvrir(ctx: BrowserContext, chemin = ''): Promise<Page> {
  const p = await ctx.newPage();
  journaliser(p);
  await p.goto(`${infos.url}${chemin}`, { waitUntil: 'domcontentloaded' });
  await attendre(p, '.chiffres b');
  await p.waitForFunction(
    () => ((window as unknown as { __carteOutils?: { rendus: () => unknown[] } }).__carteOutils?.rendus().length ?? 0) > 0,
    undefined,
    { timeout: 20_000 }
  );
  return p;
}

/** Centre du pied de l'epingle, en pixels de page : la ou elle designe. */
async function pied(p: Page): Promise<{ x: number; y: number } | null> {
  const boite = await p.locator('.epingle').boundingBox();
  return boite ? { x: boite.x + boite.width / 2, y: boite.y + boite.height } : null;
}

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  infos = await demarrer();
  contexte = await browser.newContext(BUREAU);
});

test.afterAll(async () => {
  await contexte.close();
  await fermerServeur(infos.serveur);
});

test('la vue de départ cadre la métropole, à toute largeur', async ({ browser }: { browser: Browser }) => {
  const contient = ([o, s, e, n]: number[]) =>
    o <= METROPOLE[0] && s <= METROPOLE[1] && e >= METROPOLE[2] && n >= METROPOLE[3];

  const large = await ouvrir(contexte);
  const bornesLarge = await outil(large, 'bornes');
  verifier('la metropole tient dans la vue a 1400 px', contient(bornesLarge), bornesLarge.map((v) => v.toFixed(1)).join(' '));
  await large.close();

  // Le couple centre/zoom d'avant montrait l'Espagne sur un telephone : c'est
  // ici que l'emprise se justifie.
  const etroit = await browser.newContext(TELEPHONE);
  const tel = await ouvrir(etroit);
  const bornesTel = await outil(tel, 'bornes');
  verifier('la metropole tient dans la vue a 375 px', contient(bornesTel), bornesTel.map((v) => v.toFixed(1)).join(' '));
  await etroit.close();
});

test('un lien vers une notice s’ouvre sur elle', async () => {
  const p = await ouvrir(contexte, `?ref=${NOHANT}`);
  await attendre(p, '.fiche .fermer');
  await p.waitForFunction(
    () => (window as unknown as { __carteOutils: { zoom: () => number } }).__carteOutils.zoom() > 16.5,
    undefined,
    { timeout: 15_000 }
  ).catch(() => {});
  const zoom = await outil(p, 'zoom');
  verifier('ref= sans c= cadre la notice, pas la France', Math.abs(zoom - 17) < 0.05, `zoom ${zoom.toFixed(2)}`);

  await attendre(p, '.epingle');
  const ou = (await pied(p))!;
  const volet = (await p.locator('.volet').boundingBox())!;
  verifier('l’epingle est posee', Boolean(ou));
  verifier('et le volet ne la recouvre pas', ou.x > volet.x + volet.width + 20, `epingle x ${ou.x.toFixed(0)}, volet jusqu’a ${(volet.x + volet.width).toFixed(0)}`);
  await p.close();

  // La vue portee par le lien l'emporte : c'est celle que l'expediteur regardait.
  const cadre = await ouvrir(contexte, `?ref=${NOHANT}&c=2.6,46.6,5`);
  await attendre(cadre, '.fiche .fermer');
  await cadre.waitForTimeout(1200);
  const zoomCadre = await outil(cadre, 'zoom');
  verifier('c= dans le lien n’est pas ecrase', Math.abs(zoomCadre - 5) < 0.05, `zoom ${zoomCadre.toFixed(2)}`);
  await cadre.close();
});

test('au hasard : un vol, puis la fiche', async () => {
  const p = await ouvrir(contexte);
  const longueur = () => p.evaluate(() => history.length);
  const avant = await longueur();

  await p.getByRole('button', { name: 'Au hasard' }).click();
  await p.waitForTimeout(500);
  verifier('la carte vole', await outil(p, 'enMouvement'));
  verifier('la fiche attend l’arrivee', (await p.locator('.fiche .fermer').count()) === 0);

  await attendre(p, '.fiche .fermer');
  const zoom = await outil(p, 'zoom');
  verifier('arrivee au zoom d’un edifice', Math.abs(zoom - 17) < 0.05, `zoom ${zoom.toFixed(2)}`);
  verifier('la carte s’est posee', !(await outil(p, 'enMouvement')));
  const premiere = new URL(p.url()).searchParams.get('ref');
  verifier('la notice est dans l’URL', Boolean(premiere), p.url().slice(-40));
  verifier('une seule entree d’historique empilee', (await longueur()) === avant + 1, `${avant} -> ${await longueur()}`);

  await attendre(p, '.epingle');
  const ou = (await pied(p))!;
  const volet = (await p.locator('.volet').boundingBox())!;
  const scene = (await p.locator('.scene').boundingBox())!;
  const bordVolet = volet.x + volet.width;
  verifier(
    'l’edifice arrive au milieu de la part visible, pas sous le volet',
    Math.abs(ou.x - (bordVolet + scene.x + scene.width) / 2) < 40 && ou.x > bordVolet + 20,
    `epingle x ${ou.x.toFixed(0)}, part visible ${bordVolet.toFixed(0)}–${(scene.x + scene.width).toFixed(0)}`
  );
  const points = await outil(p, 'rendus');
  const sous = points.find((q) => q.reference === premiere);
  verifier(
    'l’epingle designe le point de la notice',
    Boolean(sous) && Math.hypot(sous!.x - ou.x, sous!.y - ou.y) < 3,
    sous ? `${(sous.x - ou.x).toFixed(1)}, ${(sous.y - ou.y).toFixed(1)}` : 'point non rendu'
  );

  // Second tirage, fiche ouverte : elle se referme au decollage.
  await p.getByRole('button', { name: 'Au hasard' }).click();
  await p.waitForTimeout(500);
  verifier('la fiche en cours se referme au decollage', (await p.locator('.fiche .fermer').count()) === 0);
  await attendre(p, '.fiche .fermer');
  const seconde = new URL(p.url()).searchParams.get('ref');
  verifier('le second tirage ouvre une autre notice', Boolean(seconde) && seconde !== premiere, `${premiere} puis ${seconde}`);
  await p.close();
});

test('au hasard, mouvement réduit : un saut', async ({ browser }: { browser: Browser }) => {
  const calme = await browser.newContext({ ...BUREAU, reducedMotion: 'reduce' });
  const p = await ouvrir(calme);
  await p.getByRole('button', { name: 'Au hasard' }).click();
  // Pas de vol : la fiche doit etre la bien avant la duree d'un vol (8 s).
  await p.waitForSelector('.fiche .fermer', { timeout: 2000 }).catch(() => {});
  verifier('la fiche s’ouvre sans attendre un vol', (await p.locator('.fiche .fermer').count()) === 1);
  const zoom = await outil(p, 'zoom');
  verifier('la carte est quand meme sur l’edifice', Math.abs(zoom - 17) < 0.05, `zoom ${zoom.toFixed(2)}`);
  await calme.close();
});

test('depuis la liste, la carte se rapproche de la notice', async () => {
  const p = await ouvrir(contexte);
  const depart = await outil(p, 'zoom');
  await p.locator('.bascule button', { hasText: 'Liste' }).click();
  await attendre(p, '.liste li button');

  // Hors de la carte, « Au hasard » n'a pas de vol a montrer.
  await p.getByRole('button', { name: 'Au hasard' }).click();
  await p.waitForSelector('.fiche .fermer', { timeout: 2000 }).catch(() => {});
  verifier('au hasard en vue liste ouvre la fiche tout de suite', (await p.locator('.fiche .fermer').count()) === 1);
  await p.locator('.fiche .fermer').click();

  await p.locator('.liste li button').first().click();
  await attendre(p, '.fiche .fermer');
  await p.locator('.bascule button', { hasText: 'Carte' }).click();
  await p.waitForTimeout(600);
  const zoom = await outil(p, 'zoom');
  verifier('la carte a quitte l’echelle nationale', depart < 7 && Math.abs(zoom - 17) < 0.05, `${depart.toFixed(1)} -> ${zoom.toFixed(2)}`);
  verifier('l’epingle est sur la notice choisie', (await p.locator('.epingle').count()) === 1);
  await p.close();
});

test('un point choisi sous la fiche est ramené à côté d’elle', async () => {
  // Paris, zoom 14,5 : des points partout, dont sous l'emplacement du volet.
  const p = await ouvrir(contexte, '?c=2.3499,48.853,14.5');
  await p.waitForTimeout(800);
  const points = await outil(p, 'rendus');
  // Largeur du volet ferme : il est translate hors champ, pas absent.
  const largeur = (await p.locator('.volet').boundingBox())!.width;
  const cible = points.find(
    (q) =>
      q.x > 60 && q.x < largeur - 30 && q.y > 350 && q.y < 700 &&
      points.every((r) => r.reference === q.reference || Math.hypot(q.x - r.x, q.y - r.y) > 20)
  );
  verifier('un point isole existe sous le futur volet', Boolean(cible), `${points.length} points`);
  if (cible) {
    const zoomAvant = await outil(p, 'zoom');
    await p.mouse.click(cible.x, cible.y);
    await attendre(p, '.fiche .fermer');
    await p.waitForTimeout(1200);
    const ou = (await pied(p))!;
    const volet = (await p.locator('.volet').boundingBox())!;
    verifier('la carte a glisse : le point est a droite du volet', ou.x > volet.x + volet.width + 20, `epingle x ${ou.x.toFixed(0)}, volet jusqu’a ${(volet.x + volet.width).toFixed(0)}`);
    verifier('sans changer de zoom', Math.abs((await outil(p, 'zoom')) - zoomAvant) < 0.01);
  }

  // Un point deja bien place ne deplace rien.
  await p.locator('.fiche .fermer').click();
  await p.waitForTimeout(600);
  const visibles = await outil(p, 'rendus');
  const centre = visibles.find(
    (q) =>
      q.x > 600 && q.x < 1000 && q.y > 300 && q.y < 600 &&
      visibles.every((r) => r.reference === q.reference || Math.hypot(q.x - r.x, q.y - r.y) > 20)
  );
  if (centre) {
    await p.mouse.click(centre.x, centre.y);
    await attendre(p, '.fiche .fermer');
    await p.waitForTimeout(900);
    const ou = (await pied(p))!;
    verifier('un point visible reste ou il est', Math.hypot(ou.x - centre.x, ou.y - centre.y) < 3, `${(ou.x - centre.x).toFixed(1)}, ${(ou.y - centre.y).toFixed(1)}`);
  }
  await p.close();
});

test('infobulle au survol', async () => {
  const p = await ouvrir(contexte, '?c=2.3499,48.853,14.5');
  await p.waitForTimeout(800);
  const points = await outil(p, 'rendus');
  const isole = points.find(
    (q) =>
      q.x > 300 && q.x < 900 && q.y > 250 && q.y < 650 &&
      points.every((r) => r.reference === q.reference || Math.hypot(q.x - r.x, q.y - r.y) > 30)
  );
  verifier('un point isole existe dans la vue', Boolean(isole), `${points.length} points`);
  if (isole) {
    await p.mouse.move(isole.x - 40, isole.y - 40);
    await p.mouse.move(isole.x, isole.y, { steps: 6 });
    await attendre(p, '.infobulle', 10_000);
    const texte = await p.locator('.infobulle b').innerText();
    verifier('l’infobulle nomme l’edifice survole', texte.trim().length > 2, texte);
    verifier('elle ne capte pas le pointeur', (await p.locator('.infobulle').evaluate((el) => getComputedStyle(el).pointerEvents)) === 'none');

    await p.mouse.click(isole.x, isole.y);
    await attendre(p, '.fiche .fermer');
    verifier('ouvrir la fiche retire l’infobulle', (await p.locator('.infobulle').count()) === 0);
    verifier('le point clique est bien celui qui etait nomme', p.url().includes(`ref=${isole.reference}`), p.url().slice(-30));
  }
  await p.close();
});

test('téléphone : la feuille ouverte laisse la carte dessinée', async ({ browser }: { browser: Browser }) => {
  const etroit = await browser.newContext(TELEPHONE);
  const p = await ouvrir(etroit, '?c=2.3499,48.853,14.5');
  await p.waitForTimeout(800);
  verifier('legende visible avant la fiche', await p.locator('.legende').isVisible());

  const points = await outil(p, 'rendus');
  const cible = points.find(
    (q) =>
      q.x > 80 && q.x < 290 && q.y > 250 && q.y < 420 &&
      points.every((r) => r.reference === q.reference || Math.hypot(q.x - r.x, q.y - r.y) > 40)
  );
  verifier('un point isole existe dans la vue', Boolean(cible), `${points.length} points`);
  if (cible) {
    await p.touchscreen.tap(cible.x, cible.y);
    await attendre(p, '.fiche .fermer');
    await p.waitForTimeout(700);

    // Un conteneur defilant opaque sous un parent translate fait croire au
    // compositeur de Chromium qu'il masque le canevas la ou il serait sans la
    // translation : le haut de la carte n'etait plus dessine. Le fond vit donc
    // sur le calque hote, pas sur ce qui defile.
    const fonds = await p.evaluate(() => ({
      fiche: getComputedStyle(document.querySelector('.fiche')!).backgroundColor,
      volet: getComputedStyle(document.querySelector('.volet')!).backgroundColor
    }));
    verifier('la fiche qui defile n’a pas de fond opaque', fonds.fiche === 'rgba(0, 0, 0, 0)', fonds.fiche);
    verifier('le volet hote porte le fond', fonds.volet !== 'rgba(0, 0, 0, 0)', fonds.volet);

    verifier('legende effacee sous la feuille', !(await p.locator('.legende').isVisible()));
    verifier('pas d’infobulle au doigt', (await p.locator('.infobulle').count()) === 0);
    const ou = (await pied(p))!;
    const feuille = (await p.locator('.volet').boundingBox())!;
    verifier('l’epingle est au-dessus de la feuille', ou.y < feuille.y, `epingle y ${ou.y.toFixed(0)}, feuille y ${feuille.y.toFixed(0)}`);

    await p.goBack();
    await p.waitForTimeout(600);
    verifier('legende de retour une fois la feuille fermee', await p.locator('.legende').isVisible());
    verifier('epingle retiree avec la selection', (await p.locator('.epingle').count()) === 0);
  }
  await etroit.close();

  verifier('aucune erreur console (camera)', erreursConsole.length === 0, erreursConsole.slice(0, 3).join(' | '));
});
