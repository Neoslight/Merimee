/**
 * Filtrage croise : facettes, cardinalites, puces, recherche par titre et
 * dans les historiques, recherche a l'interieur d'une facette, zone visible,
 * et les deux etats vides (liste, carte).
 */
import { test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import {
  attendre,
  attendreTotal,
  demarrer,
  disjointes,
  fermerServeur,
  ouvrirFiltres,
  total,
  verifier,
  type InfosServeur
} from './_soutien';

let infos: InfosServeur;
let contexte: BrowserContext;
let page: Page;
const erreursConsole: string[] = [];

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

test('facettes et filtres', async () => {
  let militaire = 0;

  await test.step('filtrage croise par domaine', async () => {
    const initial = await total(page);
    await ouvrirFiltres(page);
    await page.getByRole('button', { name: 'architecture militaire' }).click();
    await page.waitForFunction(
      (avant) => {
        const el = document.querySelector('.chiffres span b');
        return el && Number.parseInt(el.textContent!.replace(/\D/g, ''), 10) !== avant;
      },
      initial,
      { timeout: 20_000 }
    );
    militaire = await total(page);
    verifier('filtre domaine militaire', militaire === 1688, `obtenu ${militaire}`);

    // La facette conserve ses autres options : preuve que son propre filtre
    // est exclu de son propre comptage.
    const autresDomaines = await page.locator('section:has(.nom-section:text("Domaine")) .option').count();
    verifier('facette domaine garde ses alternatives', autresDomaines > 5, `${autresDomaines} options`);
  });

  await test.step('cardinalites', async () => {
    // Le panneau plafonne a 40 valeurs. Sans ce nombre, rien ne disait que
    // « architecte » en cache 7 040.
    const cardinalAuteurs = await page
      .locator('section:has(.nom-section:text("Architecte")) .cardinal')
      .textContent();
    const combienAuteurs = Number.parseInt((cardinalAuteurs ?? '').replace(/\D/g, ''), 10);
    verifier(
      'la cardinalite dit ce que les 40 valeurs cachent',
      combienAuteurs > 40,
      `${cardinalAuteurs?.trim()} auteurs distincts sous le filtre courant`
    );
  });

  await test.step('pastille de statut', async () => {
    const sectionStatut = page.locator('section:has(.nom-section:text("Statut"))');
    await sectionStatut.getByRole('button', { name: /^classé / }).first().click();
    await page.waitForFunction(() => document.querySelectorAll('.jetons button:not(.raz)').length === 2, null, {
      timeout: 20_000
    });
    const pastille = await page.evaluate(() => {
      const el = document.querySelector('.option.choisi.statut-classe');
      if (!el) return null;
      const fond = getComputedStyle(el).backgroundColor;
      return { fond, opaque: !/^rgba\(.*,\s*0?\.\d+\)$/.test(fond) };
    });
    verifier(
      'la pilule du statut classe est un aplat plein',
      Boolean(pastille?.opaque),
      pastille ? pastille.fond : 'aucune pilule statut-classe'
    );
    await sectionStatut.locator('.option.choisi').first().click();
    await page.waitForFunction(
      (attendu) => {
        const el = document.querySelector('.chiffres span b');
        return el && Number.parseInt(el.textContent!.replace(/\D/g, ''), 10) === attendu;
      },
      militaire,
      { timeout: 20_000 }
    );
  });

  await test.step('puces de filtres actifs et croisement avec un siecle', async () => {
    const puces = page.locator('.jetons button:not(.raz)');
    verifier('une puce pour le filtre pose', (await puces.count()) === 1, `${await puces.count()} puce(s)`);

    await page.getByRole('button', { name: 'Afficher les frises' }).click();
    await attendre(page, '.piste-siecles svg', 20_000);
    await page.waitForTimeout(400);

    const avantSiecle = militaire;
    await page.locator('.piste-siecles rect').nth(9).click();
    await page.waitForFunction(
      (avant) => {
        const el = document.querySelector('.chiffres span b');
        return el && Number.parseInt(el.textContent!.replace(/\D/g, ''), 10) !== avant;
      },
      avantSiecle,
      { timeout: 20_000 }
    );
    const croise = await total(page);
    verifier('croisement domaine x siecle', croise > 0 && croise < militaire, `obtenu ${croise}`);
    verifier('une puce par critere, siecle compris', (await puces.count()) === 2, `${await puces.count()} puces`);

    // L'ordre des puces suit celui de `CLAUSES` : le siecle vient avant le
    // domaine. Le retirer doit ramener au seul filtre restant.
    await puces.first().click();
    await page.waitForFunction(
      (avant) => {
        const el = document.querySelector('.chiffres span b');
        return el && Number.parseInt(el.textContent!.replace(/\D/g, ''), 10) !== avant;
      },
      croise,
      { timeout: 20_000 }
    );
    const apresPuce = await total(page);
    verifier('retirer une puce ne retire qu elle', apresPuce === militaire, `obtenu ${apresPuce}`);

    await page.getByRole('button', { name: /effacer \d+ filtres?/ }).click();
    await attendreTotal(page, 46760);
    verifier('remise a zero des filtres', (await total(page)) === 46760);

    await page.getByRole('button', { name: 'Masquer les frises' }).click();
    await page.waitForTimeout(300);
  });

  await test.step('recherche sans accents ni casse', async () => {
    await page.fill('.recherche', 'chateau bordeaux');
    await page.waitForFunction(
      () => {
        const el = document.querySelector('.chiffres span b');
        return el && Number.parseInt(el.textContent!.replace(/\D/g, ''), 10) < 46760;
      },
      null,
      { timeout: 20_000 }
    );
    const recherche = await total(page);
    verifier('recherche sans accents ni casse', recherche > 0 && recherche < 200, `${recherche} resultats`);

    // La puce de recherche a un etat miroir hors de `filters` : le champ de
    // la barre. Vider l'un sans l'autre laisserait le texte affiche sur un
    // corpus complet.
    await page.locator('.jetons button:not(.raz)').first().click();
    await attendreTotal(page, 46760);
    const champ = await page.inputValue('.recherche');
    verifier('la puce de recherche vide aussi le champ', champ === '', `« ${champ} »`);
  });

  await test.step('recherche plein texte dans les historiques', async () => {
    const octetsTexte = () =>
      [...infos.octets].filter(([c]) => c.startsWith('/data/texte/')).reduce((s, [, n]) => s + n, 0);
    verifier('aucun octet d index plein texte au demarrage', octetsTexte() === 0, `${octetsTexte()} o`);

    const nomAccessibleTitres = await page.getAttribute('.recherche', 'aria-label');
    await page.locator('.bascule button', { hasText: 'Liste' }).click();
    await page.locator('button.cible').click();
    const nomAccessibleHistoriques = await page.getAttribute('.recherche', 'aria-label');
    verifier(
      'le nom accessible du champ de recherche change avec sa cible',
      Boolean(nomAccessibleTitres) &&
        Boolean(nomAccessibleHistoriques) &&
        nomAccessibleTitres !== nomAccessibleHistoriques &&
        /historique/i.test(nomAccessibleHistoriques ?? ''),
      `${nomAccessibleTitres} -> ${nomAccessibleHistoriques}`
    );
    await page.fill('.recherche', 'jubé');
    // 34 est l'oracle : `historique LIKE '%jube%'` sur les fragments en
    // compte 34, le 35e est dans `precision_protection`, non indexe.
    await attendreTotal(page, 34);
    verifier('« jube » trouve les 34 historiques qui le citent', (await total(page)) === 34);
    verifier(
      'les trois fichiers d index sont demandes',
      [...infos.octets.keys()].filter((c) => c.startsWith('/data/texte/')).length === 3,
      `${(octetsTexte() / 1048576).toFixed(1)} Mo`
    );

    const premier = await page.locator('.liste li .nom').first().textContent();
    verifier('le classement BM25 met Vitteaux en tete', (premier ?? '').includes("Saint-Germain-d'Auxerre"), premier ?? '');

    verifier(
      'le permalien porte le terme plein texte',
      page.url().includes('texte=jube') && !page.url().includes('q='),
      page.url().split('?')[1] ?? ''
    );

    await page.fill('.recherche', 'mascarons');
    await attendreTotal(page, 118);
    const pluriel = await total(page);
    await page.fill('.recherche', 'mascaron');
    await attendreTotal(page, 118);
    verifier('singulier et pluriel donnent le meme corpus', pluriel === (await total(page)), `${pluriel} notices`);

    await page.fill('.recherche', 'zzzintrouvable');
    await attendreTotal(page, 0);
    const portee = ((await page.textContent('.portee')) ?? '').replace(/\s+/g, ' ');
    verifier(
      'un mot inconnu se dit au lieu de rendre zero en silence',
      portee.includes('zzzintrouvable') && portee.includes('24 819'),
      portee.trim()
    );

    // Retour a l'etat neutre : mode titres, champ vide, vue carte.
    await page.locator('.jetons button:not(.raz)').first().click();
    await page.locator('button.cible').click();
    await page.locator('.bascule button', { hasText: 'Carte' }).click();
    await attendreTotal(page, 46760);
  });

  await test.step('recherche a l’interieur d’une facette', async () => {
    // `Baltard Victor` (5 notices) est hors des 40 valeurs les plus
    // frequentes parmi 7 040 auteurs.
    const sectionAuteurs = page.locator('section:has(.nom-section:text("Architecte"))');
    await sectionAuteurs.locator('button.titre').click();
    await sectionAuteurs.locator('input.filtre').fill('baltard');
    await page.waitForTimeout(1000);
    const trouves = await sectionAuteurs.locator('.option .etiquette').allTextContents();
    verifier(
      'la recherche de facette atteint la longue traine',
      trouves.some((t) => t.startsWith('Baltard')),
      trouves.slice(0, 3).join(' | ') || 'aucune option'
    );

    await sectionAuteurs.locator('input.filtre').fill('viollet');
    await page.waitForTimeout(1000);
    const sansAccent = await sectionAuteurs.locator('.option .etiquette').allTextContents();
    verifier(
      'recherche de facette insensible aux accents',
      sansAccent.some((t) => t.startsWith('Viollet')),
      sansAccent.slice(0, 2).join(' | ') || 'aucune option'
    );

    await sectionAuteurs.locator('.option', { hasText: 'Viollet-le-Duc' }).first().click();
    await page.waitForFunction(
      () => {
        const el = document.querySelector('.chiffres span b');
        return el && Number.parseInt(el.textContent!.replace(/\D/g, ''), 10) < 46760;
      },
      null,
      { timeout: 20_000 }
    );
    await sectionAuteurs.locator('input.filtre').fill('guimard');
    await page.waitForTimeout(1000);
    const epinglee = await sectionAuteurs.locator('.option .etiquette').allTextContents();
    verifier(
      'la valeur cochee reste listee malgre le terme',
      epinglee.some((t) => t.startsWith('Viollet')) && epinglee.some((t) => t.startsWith('Guimard')),
      epinglee.slice(0, 3).join(' | ')
    );

    await sectionAuteurs.locator('input.filtre').fill('');
    await page.getByRole('button', { name: /effacer \d+ filtres?/ }).click();
    await attendreTotal(page, 46760);
    await sectionAuteurs.locator('button.titre').click();
  });

  await test.step('zone visible sur la carte', async () => {
    await ouvrirFiltres(page);
    const zone = page.getByRole('checkbox', { name: /zone visible/ });
    verifier('la case de zone visible est dans le tiroir', (await zone.count()) === 1);
    await zone.check();
    await page.waitForSelector('.jetons button:not(.raz)', { timeout: 20_000 });
    const puceZone = page.locator('.jetons button:not(.raz)').first();
    verifier('la zone visible a sa puce', ((await puceZone.textContent()) ?? '').includes('zone visible'), ((await puceZone.textContent()) ?? '').trim());
    await puceZone.click();
    await page.waitForTimeout(500);
    const encoreLiee = await zone.isChecked();
    verifier('la puce de zone delie la vue', encoreLiee === false, String(encoreLiee));
    await page.locator('.fermer-tiroir').click();
    await page.waitForTimeout(300);
  });

  await test.step('aria-live du compteur de notices', async () => {
    // Seul le compte doit etre relu au changement, pas toute la barre.
    const barre = await page.evaluate(() => {
      const el = document.querySelector('.chiffres');
      return { live: el?.getAttribute('aria-live'), atomic: el?.getAttribute('aria-atomic') };
    });
    verifier(
      '.chiffres porte aria-live polite et aria-atomic',
      barre.live === 'polite' && barre.atomic === 'true',
      JSON.stringify(barre)
    );
  });

  await test.step('etat vide en vue liste', async () => {
    // nbPalissy tres eleve : aucune notice ne porte autant d'objets.
    await page.goto(`${infos.url}?objets=999999`, { waitUntil: 'domcontentloaded' });
    await attendre(page, '.chiffres b');
    await attendreTotal(page, 0);
    await page.locator('.bascule button', { hasText: 'Liste' }).click();
    await attendre(page, '.vide-liste');
    const boutonEffacer = page.locator('.vide-liste button', { hasText: 'Effacer les filtres' });
    verifier('etat vide en liste avec un bouton pour effacer les filtres', (await boutonEffacer.count()) === 1);
    await boutonEffacer.click();
    await attendreTotal(page, 46760);
    verifier('effacer les filtres depuis l’etat vide ramene au corpus entier', (await total(page)) === 46760);
  });

  await test.step('etat vide en vue carte, geometrie disjointe des commandes', async () => {
    await page.locator('.bascule button', { hasText: 'Carte' }).click();
    await page.goto(`${infos.url}?objets=999999`, { waitUntil: 'domcontentloaded' });
    await attendre(page, '.chiffres b');
    await attendreTotal(page, 0);
    await attendre(page, '.vide-carte');
    const boiteVide = (await page.locator('.vide-carte').boundingBox())!;
    const boiteZoom = (await page.locator('.maplibregl-ctrl-top-right').boundingBox())!;
    const boiteFiltres = (await page.locator('.scene > button.filtres').boundingBox())!;
    const boiteLegende = (await page.locator('.legende').boundingBox())!;
    verifier(
      'l’etat vide en carte est visible et disjoint du zoom, des filtres et de la legende',
      disjointes(boiteVide, boiteZoom) && disjointes(boiteVide, boiteFiltres) && disjointes(boiteVide, boiteLegende),
      `vide x${Math.round(boiteVide.x)}-y${Math.round(boiteVide.y)}`
    );
    // Retour au corpus entier pour ne pas polluer un fichier suivant qui
    // partagerait par erreur cet etat (chaque fichier a sa propre page, mais
    // la propre ceinture ne coute rien).
    await page.goto(infos.url, { waitUntil: 'domcontentloaded' });
    await attendre(page, '.chiffres b');
    await attendreTotal(page, 46760);
  });

  verifier(
    'aucune erreur console (facettes et filtres)',
    erreursConsole.length === 0,
    erreursConsole.slice(0, 3).join(' | ')
  );
});
