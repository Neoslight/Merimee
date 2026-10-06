/**
 * Legende : discrete au depart (une rangee de cles et un « ? »), ce qu'elle dit
 * une fois depliee (titre, gloses, definitions, effectifs), et ce qu'elle
 * fait — toucher un niveau de protection filtre la carte.
 *
 * Les effectifs sont ceux de l'oracle (`ANALYSE_MERIMEE.md`) : 12 428 classes
 * seuls, 31 322 inscrits seuls, 2 562 les deux — d'ou 14 990 classes et
 * 33 884 inscrits, sans jamais additionner les deux colonnes.
 */
import { test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { attendre, attendreTotal, demarrer, fermerServeur, total, verifier, type InfosServeur } from './_soutien';

let infos: InfosServeur;
let contexte: BrowserContext;
let page: Page;
const erreursConsole: string[] = [];

/** Effectif affiche sur la ligne d'un niveau, legende depliee. */
async function effectif(p: Page, libelle: string): Promise<number> {
  const texte = await p.locator('.legende .ligne', { hasText: libelle }).first().locator('.compte').innerText();
  return Number.parseInt(texte.replace(/\D/g, ''), 10);
}

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  infos = await demarrer();
  contexte = await browser.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: 'light' });
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

test('légende', async () => {
  await test.step('repliee au depart, depliee a la demande', async () => {
    verifier('repliee : aucune definition', (await page.locator('.legende .definition').count()) === 0);
    verifier('repliee : trois cles', (await page.locator('.legende .cle').count()) === 3);
    const boite = (await page.locator('.legende').boundingBox())!;
    verifier('repliee : une seule rangee basse', boite.height < 40, `${Math.round(boite.height)} px`);
    verifier('le groupe est nomme par son titre', (await page.getByRole('group', { name: 'Niveau de protection' }).count()) === 1);
    await page.getByRole('button', { name: 'Comprendre la légende' }).click();
    verifier('titre', /niveau de protection/i.test(await page.locator('.legende .titre-legende').innerText()));
    verifier('trois definitions', (await page.locator('.legende .definition').count()) === 3);
    await page.waitForSelector('.legende .ligne .compte', { timeout: 15_000 });
    const classes = await effectif(page, 'Classé');
    const inscrits = await effectif(page, 'Inscrit');
    const lesDeux = await effectif(page, 'Classé et inscrit');
    verifier('12 428 classes seuls', classes === 12_428, String(classes));
    verifier('31 322 inscrits seuls', inscrits === 31_322, String(inscrits));
    verifier('2 562 classes et inscrits', lesDeux === 2_562, String(lesDeux));
    verifier('« les deux » ne se dit plus', !/les deux/i.test(await page.locator('.legende').innerText()));
    verifier('les notices sans statut sont dites', (await page.locator('.legende .ligne.muette').count()) === 1);
  });

  await test.step('toucher un niveau filtre la carte, sans eteindre les autres effectifs', async () => {
    await page.locator('.legende .ligne', { hasText: 'Classé' }).first().click();
    await attendreTotal(page, 12_428);
    verifier('statut=classé dans l’URL', new URL(page.url()).searchParams.getAll('statut').includes('classé'), page.url());
    verifier('la ligne est enfoncee', (await page.locator('.legende .ligne.actif').count()) === 1);
    verifier('les autres reculent', (await page.locator('.legende .ligne.eteinte').count()) === 2);
    // Comme une facette, la legende compte sans son propre filtre.
    await page.waitForTimeout(500);
    const inscrits = await effectif(page, 'Inscrit');
    verifier('les inscrits restent comptes', inscrits === 31_322, String(inscrits));

    await page.locator('.legende .ligne', { hasText: 'Classé' }).first().click();
    await attendreTotal(page, 46_760);
    verifier('retoucher la ligne retire le filtre', !page.url().includes('statut='), page.url());
  });

  await test.step('les effectifs suivent les autres filtres', async () => {
    await page.goto(`${infos.url}?domaine=${encodeURIComponent('architecture militaire')}`, { waitUntil: 'domcontentloaded' });
    await attendre(page, '.chiffres b');
    const n = await total(page);
    verifier('un rechargement la rend repliee', (await page.locator('.legende .definition').count()) === 0);
    await page.getByRole('button', { name: 'Comprendre' }).click();
    await page.waitForSelector('.legende .ligne .compte', { timeout: 15_000 });
    await page.waitForTimeout(400);
    const somme =
      (await effectif(page, 'Classé')) +
      (await effectif(page, 'Inscrit')) +
      (await effectif(page, 'Classé et inscrit')) +
      ((await page.locator('.legende .ligne.muette').count())
        ? Number.parseInt((await page.locator('.legende .ligne.muette .compte').innerText()).replace(/\D/g, ''), 10)
        : 0);
    verifier('les quatre lignes font le total de la selection', somme === n, `${somme} pour ${n}`);
    await page.getByRole('button', { name: 'Réduire' }).click();
    verifier('Reduire replie', (await page.locator('.legende .definition').count()) === 0);
  });

  verifier('aucune erreur console (legende)', erreursConsole.length === 0, erreursConsole.slice(0, 3).join(' | '));
});
