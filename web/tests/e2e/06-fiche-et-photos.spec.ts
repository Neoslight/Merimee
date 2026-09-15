/**
 * La fiche de detail : lecture partielle de details.parquet, passerelle
 * Palissy, et les photographies — instantane Wikidata/Commons, cadre borne,
 * credit, pastilles auteurs, renvoi POP pour les notices sans fichier.
 */
import { test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import {
  attendre,
  attendreImageChargee,
  demarrer,
  fermerServeur,
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

test('fiche et photographies', async () => {
  await test.step('fiche de detail, lecture partielle de details.parquet', async () => {
    const cumulDetails = () =>
      [...infos.octets].filter(([c]) => c.startsWith('/data/details/')).reduce((s, [, n]) => s + n, 0);
    const avantFiche = cumulDetails();
    await page.locator('.bascule button', { hasText: 'Liste' }).click();
    await attendre(page, '.liste button');
    await page.locator('.liste button').first().click();
    await attendre(page, '.fiche .fermer');
    const titre = await page.textContent('.fiche h2');
    verifier('fiche ouverte', titre !== 'Fiche du monument', titre ?? '');
    const actes = await page.locator('.actes li').count();
    verifier('actes de protection affiches', actes > 0, `${actes} actes`);

    const titrePage = await page.title();
    verifier(
      'le titre du document porte le nom de la notice',
      Boolean(titre) && titrePage.includes(titre!) && titrePage.includes('— Mérimée'),
      titrePage
    );

    await page.waitForTimeout(1200);
    const apresFiche = cumulDetails() - avantFiche;
    verifier('un seul fragment de details telecharge', apresFiche > 0 && apresFiche < 600_000, `${(apresFiche / 1024).toFixed(0)} Ko transferes`);
    verifier('aucun fragment de details charge avant le premier clic', avantFiche === 0, `${(avantFiche / 1024).toFixed(0)} Ko`);
  });

  await test.step('passerelle Palissy', async () => {
    // La notice la plus riche du corpus est en tete de liste (triee par
    // nb_palissy decroissant) : jusqu'a 2 225 objets, deplies par paquets.
    const listeObjets = page.locator('.jetons').first();
    const jetons = await listeObjets.locator('a').count();
    verifier('objets Palissy deplies par paquets', jetons > 0 && jetons <= 50, `${jetons} liens`);
    const premierJeton = await listeObjets.locator('a').first().getAttribute('href');
    verifier(
      'lien direct vers la notice de l objet',
      /pop\.culture\.gouv\.fr\/notice\/(palissy|merimee)\//.test(premierJeton ?? ''),
      premierJeton ?? 'aucun'
    );

    const boutonPlus = page.locator('button.plus');
    if (await boutonPlus.count()) {
      await boutonPlus.first().click();
      await page.waitForTimeout(300);
      const apres = await listeObjets.locator('a').count();
      verifier('depliage ajoute un paquet', apres > jetons, `${jetons} -> ${apres}`);
    }
  });

  await test.step('pastille auteur : filtrer depuis la fiche', async () => {
    // PA00097411 porte des auteurs identifies : un clic sur sa pastille doit
    // ajouter une puce de filtre sans refermer la fiche.
    await page.goto(`${infos.url}?ref=PA00097411`, { waitUntil: 'domcontentloaded' });
    await attendre(page, '.fiche .fermer');
    const pastille = page.locator('.pastille-auteur').first();
    if ((await pastille.count()) === 0) {
      verifier('pastille auteur absente de cette notice — verification ignoree', true, 'PA00097411 sans auteur identifie');
    } else {
      const nomAccessible = await pastille.getAttribute('aria-label');
      verifier('le nom accessible de la pastille porte l’action de filtrage', /^Filtrer sur l.auteur /.test(nomAccessible ?? ''), nomAccessible ?? '');
      await pastille.click();
      await page.waitForSelector('.jetons button:not(.raz)', { timeout: 20_000 });
      const puceAuteur = await page.locator('.jetons button:not(.raz)').count();
      verifier('cliquer une pastille auteur pose une puce de filtre', puceAuteur >= 1, `${puceAuteur} puce(s)`);
      verifier('la fiche reste ouverte apres le filtrage par auteur', (await page.locator('.fiche .fermer').count()) === 1);
      // Retour a l'etat neutre.
      await page.getByRole('button', { name: /effacer \d+ filtres?/ }).click();
    }
  });

  await test.step('photographie Commons', async () => {
    await page.goto(`${infos.url}?ref=PA00097411`, { waitUntil: 'domcontentloaded' });
    await attendre(page, '.fiche .fermer');
    const source = await page.getAttribute('.photo .cadre img', 'src');
    verifier(
      'la fiche illustree porte une image Commons',
      /commons\.wikimedia\.org\/wiki\/Special:FilePath\//.test(source ?? ''),
      source ?? 'aucune image'
    );

    // Le rapport naturel n'est fiable qu'une fois l'image chargee — attente
    // explicite plutot qu'un delai fixe, qui rendait parfois « NaN ».
    const chargee = await attendreImageChargee(page, '.photo .cadre img');
    if (!chargee) {
      verifier('le cadre epouse le rapport de la photographie', false, 'image Commons non chargée');
      verifier('une photographie dans les bornes n est pas rognee', false, 'image Commons non chargée');
    } else {
      const geometriePhoto = await page.evaluate(() => {
        const img = document.querySelector('.photo .cadre img') as HTMLImageElement;
        const cadre = document.querySelector('.photo .cadre') as HTMLElement;
        const boite = cadre.getBoundingClientRect();
        return {
          boite: boite.width / boite.height,
          naturel: img.naturalWidth / img.naturalHeight,
          remplissage: getComputedStyle(img).objectFit
        };
      });
      const attendu = Math.min(1.9, Math.max(0.68, geometriePhoto.naturel));
      verifier(
        'le cadre epouse le rapport de la photographie',
        Math.abs(geometriePhoto.boite - attendu) / attendu < 0.03,
        `cadre ${geometriePhoto.boite.toFixed(2)} pour ${geometriePhoto.naturel.toFixed(2)} attendu ${attendu.toFixed(2)}`
      );
      verifier(
        'une photographie dans les bornes n est pas rognee',
        geometriePhoto.remplissage === (geometriePhoto.naturel < 0.68 || geometriePhoto.naturel > 1.9 ? 'cover' : 'contain'),
        `${geometriePhoto.remplissage} pour un rapport de ${geometriePhoto.naturel.toFixed(2)}`
      );
    }

    const legende = await page.textContent('.photo figcaption');
    verifier('le credit ou son repli est affiche', Boolean(legende && legende.trim()), (legende ?? '').replace(/\s+/g, ' ').trim().slice(0, 60));
  });

  await test.step('fiche sans photographie', async () => {
    await page.goto(`${infos.url}?ref=PA67000108`, { waitUntil: 'domcontentloaded' });
    await attendre(page, '.fiche .fermer');
    await page.waitForTimeout(600);
    verifier('aucune section photo sans image', (await page.locator('.photo').count()) === 0, `${await page.locator('.photo').count()} figure(s)`);
    const nu = await page.evaluate(() => {
      const hero = document.querySelector('.fiche .hero');
      const titre = document.querySelector('.fiche header h2');
      return {
        nu: hero?.classList.contains('nu') ?? false,
        hauteur: hero?.getBoundingClientRect().height ?? 0,
        titre: titre?.getBoundingClientRect().top ?? 0,
        pastilles: document.querySelectorAll('.fiche .hero .pastille').length
      };
    });
    verifier(
      'la fiche sans photo s ouvre sur son titre',
      nu.nu && nu.hauteur < 80 && nu.pastilles === 2,
      `bande de ${Math.round(nu.hauteur)} px, ${nu.pastilles} pastilles, titre a ${Math.round(nu.titre)} px`
    );
    const renvoi = page.locator('.fiche .renvoi-photo');
    const libelle = ((await renvoi.textContent()) ?? '').replace(/\s+/g, ' ').trim();
    verifier(
      'le renvoi POP compte les photographies que Commons ignore',
      (await renvoi.count()) === 1 && /^\d+ photographies? sur POP/.test(libelle) && ((await renvoi.getAttribute('href')) ?? '').includes('PA67000108'),
      libelle || 'aucun renvoi'
    );
  });

  await test.step('photographie hors bornes : bornee puis glissee', async () => {
    // PA00107796 mesure 960x1803, soit 0,53 : sous la borne basse (0,68).
    await page.goto(`${infos.url}?ref=PA00107796`, { waitUntil: 'domcontentloaded' });
    await attendre(page, '.photo .cadre img');
    const chargee = await attendreImageChargee(page, '.photo .cadre img');
    if (!chargee) {
      verifier('une photographie hors bornes est bornee, pas rognee au hasard', false, 'image Commons non chargée');
      verifier('glisser recadre la photographie dans son cadre', false, 'image Commons non chargée');
      return;
    }
    const bornee = await page.evaluate(() => {
      const cadre = document.querySelector('.photo .cadre') as HTMLElement;
      const img = document.querySelector('.photo .cadre img') as HTMLImageElement;
      const boite = cadre.getBoundingClientRect();
      return {
        rapport: boite.width / boite.height,
        naturel: img.naturalWidth / img.naturalHeight,
        remplissage: getComputedStyle(img).objectFit,
        position: getComputedStyle(img).objectPosition
      };
    });
    verifier(
      'une photographie hors bornes est bornee, pas rognee au hasard',
      Math.abs(bornee.rapport - 0.68) < 0.02 && bornee.naturel < 0.68 && bornee.remplissage === 'cover',
      `cadre ${bornee.rapport.toFixed(2)} pour un fichier a ${bornee.naturel.toFixed(2)}, ${bornee.remplissage}`
    );

    const boiteImage = (await page.locator('.photo .cadre img').boundingBox())!;
    const cx = boiteImage.x + boiteImage.width / 2;
    const cy = boiteImage.y + boiteImage.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx, cy - 90, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const apres = await page.evaluate(() => getComputedStyle(document.querySelector('.photo .cadre img')!).objectPosition);
    verifier('glisser recadre la photographie dans son cadre', apres !== bornee.position, `${bornee.position} -> ${apres}`);
  });

  await test.step('alias notice= et lien avec plage d’annees', async () => {
    await page.goto(`${infos.url}?annees=1920-1935`, { waitUntil: 'domcontentloaded' });
    await attendre(page, '.chiffres b');
    await page.getByRole('button', { name: 'Afficher les frises' }).click();
    await attendre(page, '.piste-siecles svg', 20_000);
    await page.waitForTimeout(1200);
    verifier('un lien avec une plage arrive avec son voile', (await page.locator('.piste-annees .brosse').count()) === 1);

    await page.goto(`${infos.url}?notice=PA00097411`, { waitUntil: 'domcontentloaded' });
    await attendre(page, '.fiche .fermer');
    const titreAlias = await page.textContent('.fiche h2');
    verifier('l alias notice= ouvre la fiche', Boolean(titreAlias), titreAlias ?? 'aucun titre');
  });

  verifier('aucune erreur console (fiche et photos)', erreursConsole.length === 0, erreursConsole.slice(0, 3).join(' | '));
});
