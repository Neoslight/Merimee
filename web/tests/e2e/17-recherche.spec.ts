/**
 * Recherche a suggestions : raccourcis du champ vide, lieux (une commune ou une
 * region filtrent et cadrent), edifices (la fiche), categories (un filtre),
 * clavier, ligatures. La saisie ne filtre plus a chaque frappe.
 */
import { test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { attendre, attendreTotal, chercher, demarrer, fermerServeur, total, verifier, type InfosServeur } from './_soutien';

let infos: InfosServeur;
let contexte: BrowserContext;
let page: Page;
const erreursConsole: string[] = [];

const ligne = (p: Page, texte: string) => p.locator('#suggestions .ligne', { hasText: texte }).first();

async function vider(p: Page) {
  const effacer = p.getByRole('button', { name: 'Effacer la recherche' });
  // Le champ vide rouvre ses raccourcis sous le doigt : on les referme.
  if ((await effacer.count()) === 1) {
    await effacer.click();
    await p.keyboard.press('Escape');
  }
  const raz = p.locator('.outils button.raz');
  if ((await raz.count()) === 1) await raz.click();
  await attendreTotal(p, 46_760);
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

test('recherche', async () => {
  await test.step('taper ne filtre plus : Entree applique', async () => {
    await page.fill('.recherche', 'cathédrale');
    await page.waitForTimeout(700);
    verifier('la saisie seule laisse le corpus entier', (await total(page)) === 46_760);
    verifier('la liste des suggestions est ouverte', (await page.locator('.recherche').getAttribute('aria-expanded')) === 'true');
    await page.press('.recherche', 'Enter');
    await page.waitForFunction(() => /q=cathedrale/.test(location.search), null, { timeout: 10_000 });
    await page.waitForFunction(() => {
      const el = document.querySelector('.chiffres span b');
      return el && Number.parseInt(el.textContent!.replace(/\D/g, ''), 10) < 46_760;
    }, null, { timeout: 20_000 });
    verifier('Entree filtre', (await total(page)) < 1000, String(await total(page)));
    verifier('et ouvre la liste des resultats', (await page.locator('.contenu-liste:not([hidden])').count()) === 1);
    await vider(page);
  });

  await test.step('le champ vide propose des raccourcis, qui trouvent tous', async () => {
    await page.locator('.bascule button', { hasText: 'Carte' }).click();
    // Les libelles sont lus dans la liste elle-meme : importer `lib/recherche`
    // tirerait DuckDB et son wasm dans Node.
    await page.locator('.recherche').click();
    const libelles = (await page.locator('#suggestions .ligne .libelle').allInnerTexts()).map((t) => t.trim());
    verifier('huit raccourcis au champ vide', libelles.length === 8, libelles.join(' | '));
    await page.locator('.recherche').blur();
    for (const libelle of libelles) {
      await page.locator('.recherche').click();
      await ligne(page, libelle).click();
      await page.waitForFunction(() => {
        const el = document.querySelector('.chiffres span b');
        return el && Number.parseInt(el.textContent!.replace(/\D/g, ''), 10) < 46_760;
      }, null, { timeout: 20_000 }).catch(() => {});
      const n = await total(page);
      verifier(`raccourci « ${libelle} »`, n > 0 && n < 46_760, `${n} notices`);
    }
    await vider(page);
  });

  await test.step('une commune isole ses notices et cadre la carte', async () => {
    await page.fill('.recherche', 'rouen');
    await ligne(page, 'Seine-Maritime').waitFor();
    await ligne(page, 'Seine-Maritime').click();
    // Mesure DuckDB sur monuments.parquet : 233 notices a Rouen.
    await attendreTotal(page, 233);
    verifier('commune dans l’URL, departement compris',
      new URL(page.url()).searchParams.getAll('commune').includes('Rouen (Seine-Maritime)'), page.url().slice(-60));
    verifier('la puce porte la commune', (await page.locator('.rangee .jetons button', { hasText: 'Rouen (Seine-Maritime)' }).count()) === 1);
    await page.waitForTimeout(1500);
    const vue = await page.evaluate(() => {
      const o = (window as unknown as { __carteOutils: { centre: () => [number, number]; zoom: () => number } }).__carteOutils;
      return { centre: o.centre(), zoom: o.zoom() };
    });
    verifier(
      'la carte regarde Rouen',
      Math.abs(vue.centre[0] - 1.09) < 0.2 && Math.abs(vue.centre[1] - 49.44) < 0.2 && vue.zoom > 10,
      `${vue.centre.map((v) => v.toFixed(2)).join(', ')} z${vue.zoom.toFixed(1)}`
    );
    await vider(page);
  });

  await test.step('une region pose son filtre', async () => {
    await page.fill('.recherche', 'bretagne');
    await ligne(page, 'région').waitFor();
    await ligne(page, 'région').click();
    await attendreTotal(page, 3235);
    verifier('region=Bretagne', new URL(page.url()).searchParams.getAll('region').includes('Bretagne'), page.url());
    verifier('le champ se vide : la puce porte le filtre', (await page.inputValue('.recherche')) === '');
    await vider(page);
  });

  await test.step('un edifice ouvre sa fiche', async () => {
    await page.fill('.recherche', 'nohant');
    await ligne(page, 'Domaine de Nohant').waitFor();
    await ligne(page, 'Domaine de Nohant').click();
    await attendre(page, '.fiche h2');
    verifier('la fiche de Nohant est ouverte', /ref=PA00097411/.test(page.url()), page.url().slice(-30));
    await page.locator('.fiche .fermer').click();
    await vider(page);
  });

  await test.step('une categorie pose son filtre', async () => {
    await page.fill('.recherche', 'guimard');
    await ligne(page, 'architecte').waitFor();
    await ligne(page, 'architecte').click();
    await attendreTotal(page, 86);
    verifier('auteur=Guimard Hector', new URL(page.url()).searchParams.getAll('auteur').includes('Guimard Hector'), page.url());
    await vider(page);
  });

  await test.step('clavier : fleches, Entree, Echap, et « / » pour revenir au champ', async () => {
    await page.locator('.maplibregl-canvas').click({ position: { x: 900, y: 400 } });
    await page.keyboard.press('/');
    verifier('« / » amene au champ', await page.evaluate(() => document.activeElement?.classList.contains('recherche') ?? false));
    await page.keyboard.type('abbaye');
    await ligne(page, 'Toutes les notices contenant').waitFor();
    await page.keyboard.press('ArrowDown');
    const active = await page.getAttribute('.recherche', 'aria-activedescendant');
    verifier('la fleche active la premiere ligne', active === 'suggestion-0', String(active));
    await page.keyboard.press('Escape');
    verifier('Echap ferme la liste, le champ garde sa saisie',
      (await page.getAttribute('.recherche', 'aria-expanded')) === 'false' && (await page.inputValue('.recherche')) === 'abbaye');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /q=abbaye/.test(location.search), null, { timeout: 10_000 });
    verifier('fleche puis Entree applique la ligne active', /q=abbaye/.test(page.url()));
    await vider(page);
  });

  await test.step('ligatures et accents', async () => {
    await chercher(page, 'Sacré-Cœur');
    await page.waitForFunction(() => /q=/.test(location.search), null, { timeout: 10_000 });
    await page.waitForTimeout(800);
    verifier('« Sacré-Cœur » saisi avec sa ligature trouve des notices', (await total(page)) > 0, String(await total(page)));
    await vider(page);
  });

  verifier('aucune erreur console (recherche)', erreursConsole.length === 0, erreursConsole.slice(0, 3).join(' | '));
});
