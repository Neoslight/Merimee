/**
 * Prechargement du binaire DuckDB des l'analyse du HTML, et cache du service
 * worker : seul le binaire haché est mis en cache, et un troisieme
 * chargement ne retelecharge plus rien.
 *
 * Le premier `page.goto()` de ce fichier est un chargement veritablement a
 * froid — chaque fichier ouvre son propre `BrowserContext`, sans aucun
 * service worker enregistre au prealable.
 */
import { test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { attendre, demarrer, fermerServeur, infosWasm, verifier, type InfosServeur } from './_soutien';

let infos: InfosServeur;
let contexte: BrowserContext;
let page: Page;
const erreursConsole: string[] = [];
const messagesConsole: string[] = [];

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  infos = await demarrer();
  contexte = await browser.newContext({ viewport: { width: 1600, height: 950 }, colorScheme: 'dark' });
  page = await contexte.newPage();
  page.on('console', (m) => {
    messagesConsole.push(m.text());
    if (m.type() === 'error') erreursConsole.push(m.text());
  });
  page.on('pageerror', (e) => erreursConsole.push(String(e)));
});

test.afterAll(async () => {
  await contexte.close();
  await fermerServeur(infos.serveur);
});

test('prechargement et service worker', async () => {
  await test.step('le HTML servi precharge le wasm', async () => {
    const reponse = await page.request.get(infos.url);
    const html = await reponse.text();
    // Les attributs peuvent apparaitre dans n'importe quel ordre (`href` est
    // pose en premier par precharger.mjs) : on isole chaque balise `<link>`
    // et on verifie qu'elle porte les trois traits, plutot que d'imposer un
    // ordre precis dans une seule expression reguliere.
    const liens = html.match(/<link[^>]*>/g) ?? [];
    const lienWasm = liens.find(
      (l) => l.includes('rel="preload"') && l.includes('as="fetch"') && /duckdb-eh[^"]*\.wasm/.test(l)
    );
    verifier('index.html precharge le binaire duckdb-eh en as="fetch"', Boolean(lienWasm), lienWasm ?? liens.join(' | ').slice(0, 200));
  });

  const { chemin: nomWasm, octets: tailleWasm } = infosWasm();

  await test.step('premier chargement a froid : le wasm part une seule fois', async () => {
    await page.goto(infos.url, { waitUntil: 'domcontentloaded' });
    await attendre(page, '.chiffres b');
    await page.waitForTimeout(500);

    const cheminServi = [...infos.octets.keys()].find((c) => c.endsWith('.wasm'));
    verifier('binaire DuckDB servi', Boolean(cheminServi), cheminServi ?? 'aucun');

    const servis = cheminServi ? (infos.octets.get(cheminServi) ?? 0) : 0;
    // Tolerance large (10 Ko) : la taille exacte vient du fichier du build
    // courant, mesuree sur le disque plutot que recopiee en dur.
    verifier(
      'le wasm est integralement servi une seule fois au premier chargement',
      Math.abs(servis - tailleWasm) < 10_240,
      `${servis} o servis pour ${nomWasm} (${tailleWasm} o sur disque)`
    );

    const avertissementAs = messagesConsole.some((m) => /unsupported.*`?as`?.*value/i.test(m));
    verifier('aucun avertissement « unsupported as value » en console', !avertissementAs, messagesConsole.join(' | ').slice(0, 200));
  });

  await test.step('service worker aux commandes, wasm resservi sans reseau', async () => {
    const cheminWasm = [...infos.octets.keys()].find((c) => c.endsWith('.wasm'));
    if (!cheminWasm) return;
    await page.evaluate(() => navigator.serviceWorker.ready);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await attendre(page, '.chiffres b');
    const apresDeuxieme = infos.octets.get(cheminWasm) ?? 0;

    await page.reload({ waitUntil: 'domcontentloaded' });
    await attendre(page, '.chiffres b');
    const troisieme = (infos.octets.get(cheminWasm) ?? 0) - apresDeuxieme;

    const controle = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
    verifier('service worker aux commandes', controle);
    verifier('binaire DuckDB resservi sans reseau', troisieme === 0, `${(troisieme / 1024).toFixed(0)} Ko retelecharges`);
  });

  verifier('aucune erreur console (service worker)', erreursConsole.length === 0, erreursConsole.slice(0, 3).join(' | '));
});
