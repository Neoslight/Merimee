/**
 * Rangee de puces sous la recherche : une puce par facette courante, chacune
 * ouvrant le menu de sa section ; la zone visible ; les frises ; les filtres
 * poses a la suite. Choisir une region cadre la carte dessus.
 */
import { test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { attendre, attendreTotal, demarrer, fermerServeur, verifier, type InfosServeur } from './_soutien';

let infos: InfosServeur;
let contexte: BrowserContext;
let page: Page;
const erreursConsole: string[] = [];

const puce = (p: Page, texte: string) => p.locator('.rangee .puce', { hasText: texte });

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  infos = await demarrer();
  contexte = await browser.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: 'dark' });
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

test('puces de filtres', async () => {
  await test.step('la rangee', async () => {
    const libelles = (await page.locator('.rangee .puce').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
    verifier(
      'frises, six facettes et la zone visible',
      libelles.length === 8 && libelles[0] === 'Frises' && libelles.at(-1) === 'Zone visible',
      libelles.join(' | ')
    );
  });

  await test.step('une puce ouvre le menu de sa section', async () => {
    await puce(page, 'Domaine').click();
    await attendre(page, '.menu-puce .option', 20_000);
    verifier('le menu ne montre que sa section', (await page.locator('.menu-puce section').count()) === 1);
    verifier('le menu prend le focus', await page.evaluate(() => document.activeElement?.id === 'menu-puce'));
    await page.locator('.menu-puce .option', { hasText: 'architecture militaire' }).click();
    await attendreTotal(page, 1688);
    verifier('le filtre entre dans l’URL', /domaine=architecture\+militaire/.test(page.url()), page.url().slice(-50));
    verifier('la puce dit qu’une valeur est posee', (await puce(page, 'Domaine').locator('em').innerText()) === '1');
    verifier('le filtre pose suit dans la rangee', (await page.locator('.rangee .jetons button', { hasText: 'architecture militaire' }).count()) === 1);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    verifier('Echap referme le menu', (await page.locator('.menu-puce').count()) === 0);
    verifier('et rend le focus a la puce', await page.evaluate(() => document.activeElement?.textContent?.includes('Domaine') ?? false));
    verifier('le filtre reste pose', /domaine=/.test(page.url()));

    await page.locator('.outils button.raz').click();
    await attendreTotal(page, 46_760);
  });

  await test.step('le menu et le tiroir des filtres s’excluent', async () => {
    await puce(page, 'Architecte').click();
    await attendre(page, '.menu-puce');
    await page.getByRole('button', { name: /^Filtres/ }).click();
    await page.waitForTimeout(300);
    verifier('ouvrir les filtres ferme le menu', (await page.locator('.menu-puce').count()) === 0);
    verifier('les filtres sont ouverts', (await page.locator('.facettes.ouvert').count()) === 1);
    await puce(page, 'Protection').click();
    await attendre(page, '.menu-puce');
    verifier('ouvrir une puce ferme les filtres', (await page.locator('.facettes.ouvert').count()) === 0);
    await page.keyboard.press('Escape');
  });

  await test.step('choisir une region cadre la carte dessus', async () => {
    await puce(page, 'Région').click();
    await attendre(page, '.menu-puce .option', 20_000);
    await page.locator('.menu-puce .option', { hasText: 'Bretagne' }).click();
    await attendreTotal(page, 3235);
    await page.waitForTimeout(1500);
    const vue = await page.evaluate(() => {
      const o = (window as unknown as { __carteOutils: { centre: () => [number, number]; zoom: () => number } }).__carteOutils;
      return { centre: o.centre(), zoom: o.zoom() };
    });
    verifier(
      'la carte regarde la Bretagne',
      vue.centre[0] > -5.5 && vue.centre[0] < -0.5 && vue.centre[1] > 46.8 && vue.centre[1] < 49.2 && vue.zoom > 6.5,
      `${vue.centre.map((v) => v.toFixed(2)).join(', ')} z${vue.zoom.toFixed(1)}`
    );
    await page.keyboard.press('Escape');
    await page.locator('.outils button.raz').click();
    await attendreTotal(page, 46_760);
  });

  await test.step('la zone visible est une puce', async () => {
    await puce(page, 'Zone visible').click();
    await page.waitForTimeout(800);
    verifier('elle s’enfonce', (await puce(page, 'Zone visible').getAttribute('aria-pressed')) === 'true');
    verifier('et pose son filtre', (await page.locator('.rangee .jetons button', { hasText: 'zone visible' }).count()) === 1);
    await puce(page, 'Zone visible').click();
    await page.waitForTimeout(500);
    verifier('retouchee, elle le retire', (await page.locator('.rangee .jetons').count()) === 0);
  });

  await test.step('effacer vit a cote de Filtres', async () => {
    await page.goto(`${infos.url}?domaine=${encodeURIComponent('architecture militaire')}&statut=${encodeURIComponent('classé')}`, { waitUntil: 'domcontentloaded' });
    await attendre(page, '.chiffres b');
    const filtres = (await page.locator('.outils button.filtres').boundingBox())!;
    const raz = (await page.locator('.outils button.raz').boundingBox())!;
    verifier('la croix suit immediatement « Filtres »', raz.x > filtres.x + filtres.width && raz.x - (filtres.x + filtres.width) < 12,
      `${Math.round(raz.x - filtres.x - filtres.width)} px`);
    verifier('nommee par ce qu’elle efface', (await page.getByRole('button', { name: 'Effacer 2 filtres' }).count()) === 1);
    await page.locator('.outils button.raz').click();
    await attendreTotal(page, 46_760);
    verifier('plus de croix sans filtre', (await page.locator('.outils button.raz').count()) === 0);
  });

  verifier('aucune erreur console (puces)', erreursConsole.length === 0, erreursConsole.slice(0, 3).join(' | '));
});

test('au large, les puces se répartissent ; au doigt, la rangée défile', async ({ browser }: { browser: Browser }) => {
  const filtres = `?domaine=${encodeURIComponent('architecture militaire')}&statut=${encodeURIComponent('classé')}&region=Bretagne`;
  const large = await browser.newContext({ viewport: { width: 1000, height: 800 }, colorScheme: 'dark' });
  const p = await large.newPage();
  await p.goto(`${infos.url}${filtres}`, { waitUntil: 'domcontentloaded' });
  await attendre(p, '.chiffres b');
  await attendre(p, '.rangee .jetons button');
  await p.waitForTimeout(300);
  const bloc = (await p.locator('.haut').boundingBox())!;
  const boites = await p.locator('.rangee .puce, .rangee .jetons button').evaluateAll((els) =>
    els.map((el) => {
      const b = el.getBoundingClientRect();
      return { droite: b.right, haut: Math.round(b.top) };
    })
  );
  const lignes = new Set(boites.map((b) => b.haut)).size;
  verifier('plusieurs lignes, pas une seule longue', lignes >= 2, `${lignes} lignes`);
  verifier('tout tient dans la largeur du bloc', boites.every((b) => b.droite <= bloc.x + bloc.width + 1), JSON.stringify(boites.at(-1)));
  verifier('rien ne deborde, rien ne se fond', (await p.locator('.rangee.debord-droite').count()) === 0);
  await large.close();

  const tel = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: 'dark' });
  const q = await tel.newPage();
  await q.goto(`${infos.url}${filtres}`, { waitUntil: 'domcontentloaded' });
  await attendre(q, '.chiffres b');
  await q.waitForTimeout(300);
  const hauteur = (await q.locator('.rangee').boundingBox())!.height;
  verifier('au doigt, une seule ligne', hauteur < 44, `${Math.round(hauteur)} px`);
  verifier('le bord coupe se fond', (await q.locator('.rangee.debord-droite').count()) === 1);
  await tel.close();
});
