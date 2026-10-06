/**
 * Couche Architecture contemporaine remarquable : masquee et gratuite au
 * chargement, sans effet sur les compteurs une fois allumee, fiche au gabarit
 * des monuments historiques, permalien `acr=1`, survie a la bascule de theme.
 */
import { test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
  ouvrirCalques,
  attendre,
  attendreImageChargee,
  demarrer,
  fermerServeur,
  total,
  verifier,
  type InfosServeur
} from './_soutien';

let infos: InfosServeur;
let contexte: BrowserContext;
let page: Page;
const erreursConsole: string[] = [];

type Rendu = { reference: string; x: number; y: number };

const octetsSous = (prefixe: string) =>
  [...infos.octets].filter(([c]) => c.startsWith(prefixe)).reduce((s, [, n]) => s + n, 0);

const rendusAcr = (): Promise<Rendu[]> =>
  page.evaluate(() => (window as unknown as { __carteOutils: { rendusAcr: () => Rendu[] } }).__carteOutils.rendusAcr());

/** La bascule vit dans le panneau des calques, qui se referme a chaque toucher
 *  de la carte et a chaque navigation : on l'ouvre avant chaque usage. */
async function bouton() {
  await ouvrirCalques(page);
  return page.getByRole('button', { name: 'Architecture contemporaine remarquable' });
}

/** Premiere notice ACR illustree par l'instantane Wikidata, s'il existe. */
function referenceIllustree(): string | null {
  try {
    const lignes = readFileSync(new URL('../../../data/ref/wikidata_images_acr.csv', import.meta.url), 'utf-8')
      .split('\n')
      .filter((l) => l && !l.startsWith('#') && !l.startsWith('reference,'));
    return lignes[0]?.split(',')[0] ?? null;
  } catch {
    return null;
  }
}

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

test('couche architecture contemporaine remarquable', async () => {
  let totalAvant = 0;

  await test.step('masquee et gratuite au chargement', async () => {
    await page.waitForTimeout(1500);
    verifier('la bascule ACR est eteinte par defaut', (await (await bouton()).getAttribute('aria-pressed')) === 'false');
    verifier('aucun octet de la couche ACR au chargement', octetsSous('/data/acr/') === 0, `${octetsSous('/data/acr/')} octets`);
    verifier('aucun point ACR rendu', (await rendusAcr()).length === 0);
    verifier('pas de parametre acr dans l URL', !page.url().includes('acr='), page.url());
    totalAvant = await total(page);
  });

  await test.step('allumer la couche', async () => {
    await (await bouton()).click();
    await page
      .waitForFunction(
        () => (window as unknown as { __carteOutils: { rendusAcr: () => unknown[] } }).__carteOutils.rendusAcr().length > 0,
        undefined,
        { timeout: 15_000 }
      )
      .catch(() => {});
    const rendus = await rendusAcr();
    verifier('les points ACR sont rendus', rendus.length > 1_000, `${rendus.length} points`);
    verifier('acr=1 dans l URL', page.url().includes('acr=1'), page.url());
    verifier('le nuage ACR est telecharge, pas encore les fiches',
      octetsSous('/data/acr/points.json') > 0 && octetsSous('/data/acr/fiches/') === 0);
    await page.waitForTimeout(800);
    verifier('les compteurs ignorent la couche ACR', (await total(page)) === totalAvant, `${totalAvant} -> ${await total(page)}`);
    verifier('une cle de legende nomme la couche',
      (await page.locator('.legende .cle', { hasText: 'archi. contemporaine' }).count()) === 1);
  });

  await test.step('toucher un point ACR ouvre sa fiche', async () => {
    const choisi = await page.evaluate(() => {
      const outils = (window as unknown as {
        __carteOutils: { rendus: () => Rendu[]; rendusAcr: () => Rendu[] };
      }).__carteOutils;
      const mh = outils.rendus();
      const carte = document.querySelector('.carte')!.getBoundingClientRect();
      // Un point isole, loin de tout monument et des bords : la souris retient
      // le plus proche, un voisin MH l'emporterait sinon.
      return (
        outils.rendusAcr().find(
          (a) =>
            a.x > carte.left + 500 && a.x < carte.right - 300 &&
            a.y > carte.top + 200 && a.y < carte.bottom - 250 &&
            mh.every((m) => (m.x - a.x) ** 2 + (m.y - a.y) ** 2 > 20 ** 2)
        ) ?? null
      );
    });
    if (!choisi) {
      verifier('aucun point ACR isole a l ecran — verification ignoree', true);
      return;
    }
    await page.mouse.click(choisi.x, choisi.y);
    await attendre(page, '.fiche .label-acr', 20_000);
    verifier('la fiche ouverte est celle du point touche', page.url().includes(`ref=${choisi.reference}`), page.url());
    const fragments = octetsSous('/data/acr/fiches/');
    verifier('un seul fragment de fiches ACR telecharge', fragments > 0 && fragments < 450_000, `${(fragments / 1024).toFixed(0)} Ko`);
  });

  await test.step('permalien d une fiche ACR', async () => {
    await page.goto(`${infos.url}?ref=ACR0000002`, { waitUntil: 'domcontentloaded' });
    await attendre(page, '.fiche .label-acr', 45_000);
    verifier('la couche se rallume pour une fiche ACR partagee', (await (await bouton()).getAttribute('aria-pressed')) === 'true');
    const badge = await page.textContent('.fiche .label-acr');
    verifier('badge du label date', /Label 2003/.test(badge ?? ''), badge ?? '');
    verifier('titre de la notice', (await page.textContent('.fiche h2'))?.includes('Hôtel de ville'));
    verifier('pas de section actes de protection', (await page.locator('.fiche .actes').count()) === 0);
    verifier('section description presente', (await page.locator('.fiche h3', { hasText: 'Description' }).count()) === 1);
    verifier('lien POP vers la notice ACR',
      (await page.getAttribute('.fiche .actions a[href*="pop.culture.gouv.fr"]', 'href'))?.endsWith('/notice/merimee/ACR0000002'));
  });

  await test.step('photographie d une notice ACR illustree', async () => {
    const ref = referenceIllustree();
    if (!ref) {
      verifier('instantane wikidata_images_acr.csv absent — verification ignoree', true);
      return;
    }
    await page.goto(`${infos.url}?ref=${ref}`, { waitUntil: 'domcontentloaded' });
    await attendre(page, '.fiche .label-acr', 45_000);
    const source = await page.getAttribute('.photo .cadre img', 'src').catch(() => null);
    verifier('photographie Commons dans la fiche ACR', source?.includes('commons.wikimedia.org'), `${ref} : ${source ?? 'aucune'}`);
    verifier('la photographie se charge', await attendreImageChargee(page, '.photo .cadre img'), ref);
  });

  await test.step('la couche survit a la bascule de theme', async () => {
    await page.getByRole('button', { name: 'Clair' }).click();
    await page.waitForTimeout(2500);
    const apres = await rendusAcr();
    verifier('points ACR toujours rendus apres le changement de theme', apres.length > 0, `${apres.length} points`);
    await page.getByRole('button', { name: 'Sombre' }).click();
    await page.waitForTimeout(1500);
  });

  await test.step('eteindre la couche', async () => {
    await (await bouton()).click();
    await page.waitForTimeout(600);
    verifier('bascule eteinte', (await (await bouton()).getAttribute('aria-pressed')) === 'false');
    verifier('la fiche ACR se referme avec sa couche', (await page.locator('.fiche .label-acr').count()) === 0);
    verifier('acr et ref quittent l URL', !page.url().includes('acr=') && !page.url().includes('ref=ACR'), page.url());
    verifier('aucun point ACR rendu une fois eteinte', (await rendusAcr()).length === 0);
  });

  verifier('aucune erreur console (couche ACR)', erreursConsole.length === 0, erreursConsole.slice(0, 3).join(' | '));
});
