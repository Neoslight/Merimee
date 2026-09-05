/**
 * Fumigation de bout en bout sur le build statique.
 *
 * Verifie ce que la compilation ne peut pas prouver : que DuckDB-Wasm demarre
 * dans le navigateur, que les Parquet se chargent, que le filtrage croise
 * repond, et que la fiche de detail ne rapatrie qu'une fraction du fichier
 * `details.parquet` grace aux requetes HTTP Range.
 *
 * Usage : node tests/smoke.mjs [url]   (defaut http://localhost:4173)
 */
import { chromium } from 'playwright';
import { demarrer } from './serveur.mjs';

const { serveur, octets, url: BASE } = await demarrer(new URL('../build', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const resultats = [];
let echecs = 0;

function verifier(nom, condition, detail = '') {
  resultats.push({ nom, ok: Boolean(condition), detail });
  if (!condition) echecs += 1;
}

const attendre = (page, selecteur, timeout = 45_000) =>
  page.waitForSelector(selecteur, { timeout });

async function total(page) {
  const texte = await page.textContent('.chiffres span b');
  return Number.parseInt(texte.replace(/\D/g, ''), 10);
}

const navigateur = await chromium.launch();
// Chromium sans tete annonce `prefers-color-scheme: light` : sans ce reglage
// l'application demarre en clair et le test du theme n'aurait rien a basculer.
const page = await navigateur.newPage({
  viewport: { width: 1600, height: 950 },
  colorScheme: 'dark'
});

const erreursConsole = [];
page.on('console', (msg) => msg.type() === 'error' && erreursConsole.push(msg.text()));
page.on('pageerror', (e) => erreursConsole.push(String(e)));

let fatale = null;

try {
  const debut = Date.now();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await attendre(page, '.chiffres b');
  const amorce = Date.now() - debut;

  const initial = await total(page);
  verifier('46 760 notices chargees', initial === 46760, `obtenu ${initial}`);
  verifier('amorcage sous 30 s', amorce < 30_000, `${amorce} ms`);

  // --- Carte de lien --------------------------------------------------------
  // Les permaliens n'ont d'interet que si le lien colle quelque part s'affiche.
  const carte = await page.evaluate(() => ({
    image: document.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? '',
    icone: document.querySelector('link[rel="icon"]')?.getAttribute('href') ?? ''
  }));
  verifier('vignette Open Graph declaree', /^https:\/\/.+\.png$/.test(carte.image), carte.image);
  const iconeOk = await page.evaluate(
    (href) => fetch(href).then((r) => r.status),
    carte.icone
  );
  verifier('favicon servie', iconeOk === 200, `${carte.icone} -> ${iconeOk}`);

  const points = await page.evaluate(() => {
    const src = document.querySelector('.maplibregl-canvas');
    return src ? 1 : 0;
  });
  verifier('canvas MapLibre rendu', points === 1);

  // --- Filtrage croise -----------------------------------------------------
  await page.getByRole('button', { name: 'architecture militaire' }).click();
  await page.waitForFunction(
    (avant) => {
      const el = document.querySelector('.chiffres span b');
      return el && Number.parseInt(el.textContent.replace(/\D/g, ''), 10) !== avant;
    },
    initial,
    { timeout: 20_000 }
  );
  const militaire = await total(page);
  verifier('filtre domaine militaire', militaire === 1688, `obtenu ${militaire}`);

  // La facette conserve ses autres options : preuve que son propre filtre est
  // exclu de son propre comptage.
  const autresDomaines = await page
    .locator('section:has(button.titre:text("Domaine")) .option')
    .count();
  verifier('facette domaine garde ses alternatives', autresDomaines > 5, `${autresDomaines} options`);

  // Croisement avec un siecle depuis la frise.
  const avantSiecle = militaire;
  await page.locator('.cliquable rect').nth(9).click();
  await page.waitForFunction(
    (avant) => {
      const el = document.querySelector('.chiffres span b');
      return el && Number.parseInt(el.textContent.replace(/\D/g, ''), 10) !== avant;
    },
    avantSiecle,
    { timeout: 20_000 }
  );
  const croise = await total(page);
  verifier('croisement domaine x siecle', croise > 0 && croise < militaire, `obtenu ${croise}`);

  await page.getByRole('button', { name: /effacer \d+ filtres?/ }).click();
  await page.waitForFunction(() => {
    const el = document.querySelector('.chiffres span b');
    return el && el.textContent.replace(/\D/g, '') === '46760';
  }, null, { timeout: 20_000 });
  verifier('remise a zero des filtres', (await total(page)) === 46760);

  // --- Recherche sans accents ---------------------------------------------
  await page.fill('.recherche', 'chateau bordeaux');
  await page.waitForFunction(() => {
    const el = document.querySelector('.chiffres span b');
    return el && Number.parseInt(el.textContent.replace(/\D/g, ''), 10) < 46760;
  }, null, { timeout: 20_000 });
  const recherche = await total(page);
  verifier('recherche sans accents ni casse', recherche > 0 && recherche < 200, `${recherche} resultats`);
  await page.fill('.recherche', '');
  await page.waitForFunction(() => {
    const el = document.querySelector('.chiffres span b');
    return el && el.textContent.replace(/\D/g, '') === '46760';
  }, null, { timeout: 20_000 });

  // --- Recherche a l'interieur d'une facette --------------------------------
  // `Baltard Victor` (5 notices) est hors des 40 valeurs les plus frequentes
  // parmi 7 040 auteurs : le trouver prouve que la recherche descend dans
  // DuckDB au lieu de trier la liste deja rapatriee.
  const sectionAuteurs = page.locator('section:has(button.titre:text("Architecte"))');
  await sectionAuteurs.locator('button.titre').click();
  await sectionAuteurs.locator('input.filtre').fill('baltard');
  await page.waitForTimeout(1000);
  const trouves = await sectionAuteurs.locator('.option .etiquette').allTextContents();
  verifier(
    'la recherche de facette atteint la longue traine',
    trouves.some((t) => t.startsWith('Baltard')),
    trouves.slice(0, 3).join(' | ') || 'aucune option'
  );

  // Sans accent ni casse : `Viollet-le-Duc Eugene` porte un accent en base.
  await sectionAuteurs.locator('input.filtre').fill('viollet');
  await page.waitForTimeout(1000);
  const sansAccent = await sectionAuteurs.locator('.option .etiquette').allTextContents();
  verifier(
    'recherche de facette insensible aux accents',
    sansAccent.some((t) => t.startsWith('Viollet')),
    sansAccent.slice(0, 2).join(' | ') || 'aucune option'
  );

  // Une valeur cochee doit rester listee, sinon on ne peut plus la decocher.
  await sectionAuteurs.locator('.option', { hasText: 'Viollet-le-Duc' }).first().click();
  await page.waitForFunction(
    () => {
      const el = document.querySelector('.chiffres span b');
      return el && Number.parseInt(el.textContent.replace(/\D/g, ''), 10) < 46760;
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
  await page.waitForFunction(() => {
    const el = document.querySelector('.chiffres span b');
    return el && el.textContent.replace(/\D/g, '') === '46760';
  }, null, { timeout: 20_000 });
  await sectionAuteurs.locator('button.titre').click();

  // --- Fiche de detail et lecture partielle de details.parquet -------------
  const cumulDetails = () =>
    [...octets].filter(([c]) => c.startsWith('/data/details/'))
               .reduce((somme, [, n]) => somme + n, 0);
  const avantFiche = cumulDetails();
  await page.locator('.bascule button', { hasText: 'Liste' }).click();
  await attendre(page, '.liste button');
  await page.locator('.liste button').first().click();
  await attendre(page, '.fiche .fermer');
  const titre = await page.textContent('.fiche h2');
  verifier('fiche ouverte', titre !== 'Fiche du monument', titre ?? '');
  const actes = await page.locator('.actes li').count();
  verifier('actes de protection affiches', actes > 0, `${actes} actes`);

  await page.waitForTimeout(1200);
  const apresFiche = cumulDetails() - avantFiche;
  verifier(
    'un seul fragment de details telecharge',
    apresFiche > 0 && apresFiche < 600_000,
    `${(apresFiche / 1024).toFixed(0)} Ko transferes`
  );
  verifier(
    'aucun fragment de details charge avant le premier clic',
    avantFiche === 0,
    `${(avantFiche / 1024).toFixed(0)} Ko`
  );

  // --- Passerelle Palissy ---------------------------------------------------
  // Une notice porte jusqu'a 2 225 objets : le depliage par paquets evite de
  // rendre 2 225 ancres d'un coup. On ouvre la notice la plus riche du corpus,
  // premiere de la liste puisqu'elle est triee par nb_palissy decroissant.
  // Deux sections rendent des jetons (objets, notices liees) : ne compter que
  // la premiere, celle des objets Palissy.
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

  // --- Densite --------------------------------------------------------------
  await page.locator('.bascule button', { hasText: 'Carte' }).click();
  await page.getByRole('button', { name: 'densité' }).click();
  await page.waitForTimeout(500);
  // Viser le bouton par son nom : `.legende button[aria-pressed]` attrapait le
  // premier venu, et la legende en compte trois.
  const etatDensite = await page
    .getByRole('button', { name: 'densité' })
    .getAttribute('aria-pressed');
  verifier('bascule densite active', etatDensite === 'true', String(etatDensite));
  await page.getByRole('button', { name: 'densité' }).click();

  // --- Semiologie par epoque ------------------------------------------------
  const legendeStatut = await page.locator('.legende span').count();
  await page.locator('.legende button.mode').click();
  await page.waitForTimeout(400);
  const legendeEpoque = await page.locator('.legende span').count();
  verifier(
    'la legende suit le mode de coloration',
    legendeStatut === 3 && legendeEpoque === 5,
    `${legendeStatut} -> ${legendeEpoque}`
  );
  await page.locator('.legende button.mode').click();
  await page.waitForTimeout(300);

  // --- Theme clair ----------------------------------------------------------
  // `setStyle` detruit sources et couches : c'est la regression que ce lot
  // risque le plus. Un `setPaintProperty` sur une couche disparue leve, donc
  // le compteur d'erreurs console fait foi.
  const avantTheme = erreursConsole.length;
  await page.getByRole('button', { name: 'Clair' }).click();
  await page.waitForTimeout(1500);

  const clair = await page.evaluate(() => ({
    marque: document.documentElement.dataset.theme,
    fond: getComputedStyle(document.body).backgroundColor,
    texte: getComputedStyle(document.body).color
  }));
  verifier('bascule en theme clair', clair.marque === 'clair', String(clair.marque));

  const luminance = (couleur) => {
    const [r, v, b] = couleur.match(/\d+/g).slice(0, 3).map(Number);
    const lin = [r, v, b]
      .map((c) => c / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  };
  const lf = luminance(clair.fond);
  const lt = luminance(clair.texte);
  const contraste = (Math.max(lf, lt) + 0.05) / (Math.min(lf, lt) + 0.05);
  verifier('fond effectivement clair', lf > 0.5, clair.fond);
  verifier('contraste du texte au moins 4,5:1', contraste >= 4.5, `${contraste.toFixed(2)}:1`);

  // La carte a recharge son fond : si les couches n'avaient pas ete reposees,
  // basculer la densite leverait.
  await page.getByRole('button', { name: 'densité' }).click();
  await page.waitForTimeout(500);
  const densiteApresTheme = await page
    .getByRole('button', { name: 'densité' })
    .getAttribute('aria-pressed');
  await page.getByRole('button', { name: 'densité' }).click();
  verifier(
    'les couches survivent au changement de fond',
    densiteApresTheme === 'true' && erreursConsole.length === avantTheme,
    erreursConsole.slice(avantTheme, avantTheme + 2).join(' | ') || 'aucune erreur'
  );

  verifier(
    'le theme reste hors de l URL',
    !/theme|clair|sombre/.test(page.url()),
    page.url().split('?')[1] ?? '(aucun parametre)'
  );

  // Il survit au rechargement : c'est une preference de lecture, elle est
  // stockee localement et non portee par le lien.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await attendre(page, '.chiffres b');
  const persiste = await page.evaluate(() => document.documentElement.dataset.theme);
  verifier('le theme survit au rechargement', persiste === 'clair', String(persiste));
  await page.getByRole('button', { name: 'Sombre' }).click();
  await page.waitForTimeout(1200);

  // --- La vue de carte voyage dans le lien, pas dans l URL vivante ---------
  // Sur un onglet a part : cette section navigue et pousse des entrees, alors
  // que les suivantes eprouvent precisement le retour arriere.
  {
    const onglet = await navigateur.newPage({
      viewport: { width: 1400, height: 900 },
      colorScheme: 'dark'
    });
    onglet.on('console', (m) => m.type() === 'error' && erreursConsole.push(m.text()));
    onglet.on('pageerror', (e) => erreursConsole.push(String(e)));
    await onglet.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
    await onglet.goto(BASE, { waitUntil: 'domcontentloaded' });
    await attendre(onglet, '.chiffres b');
    await onglet.waitForTimeout(1200);

    const urlAvantPan = onglet.url();
    const toile = await onglet.locator('.maplibregl-canvas').boundingBox();
    await onglet.mouse.move(toile.x + toile.width / 2, toile.y + toile.height / 2);
    await onglet.mouse.down();
    await onglet.mouse.move(
      toile.x + toile.width / 2 - 220,
      toile.y + toile.height / 2 - 120,
      { steps: 12 }
    );
    await onglet.mouse.up();
    await onglet.waitForTimeout(900);
    verifier(
      'un deplacement de carte ne reecrit pas l URL',
      onglet.url() === urlAvantPan,
      onglet.url().split('?')[1] ?? '(aucun parametre)'
    );

    await onglet.getByRole('button', { name: /Copier le lien|Lien copié/ }).click();
    await onglet.waitForTimeout(400);
    const lienCopie = await onglet.evaluate(() => navigator.clipboard.readText());
    // `URLSearchParams` encode les virgules : comparer sur la forme decodee.
    const cadrage = /[?&]c=(-?[\d.]+),(-?[\d.]+),([\d.]+)/.exec(decodeURIComponent(lienCopie));
    verifier(
      'le lien copie porte la vue de carte',
      Boolean(cadrage),
      lienCopie.split('?')[1] ?? lienCopie
    );
    verifier(
      'la vue copiee est celle apres deplacement',
      cadrage && (Math.abs(Number(cadrage[1]) - 2.6) > 0.05 || Math.abs(Number(cadrage[2]) - 46.6) > 0.05),
      cadrage ? `c=${cadrage[1]},${cadrage[2]},${cadrage[3]}` : 'aucun cadrage'
    );

    if (cadrage) {
      await onglet.goto(lienCopie, { waitUntil: 'domcontentloaded' });
      await attendre(onglet, '.chiffres b');
      await onglet.waitForTimeout(1200);
      // Le cadrage est consomme au chargement : le premier `replaceState` qui
      // suit ne le reecrit pas, il n'appartient pas a l'etat d'exploration.
      verifier(
        'le lien rouvre sans erreur et sans boucle',
        erreursConsole.length === 0,
        erreursConsole.slice(0, 2).join(' | ') || 'aucune erreur'
      );
    }

    // --- Photographies -------------------------------------------------
    // Les noms de fichiers viennent des fragments, pas d'une requete : seule
    // l'image elle-meme et son credit partent sur le reseau.
    await onglet.goto(`${BASE}/?ref=PA00097411`, { waitUntil: 'domcontentloaded' });
    await attendre(onglet, '.fiche .fermer');
    await onglet.waitForTimeout(600);
    const source = await onglet.getAttribute('.photo > img', 'src');
    verifier(
      'la fiche illustree porte une image Commons',
      /commons\.wikimedia\.org\/wiki\/Special:FilePath\//.test(source ?? ''),
      source ?? 'aucune image'
    );
    // Le credit peut venir du reseau ou non : le lien de repli, lui, est
    // toujours rendu. C'est lui qui rend la licence atteignable.
    const legende = await onglet.textContent('.photo figcaption');
    verifier(
      'le credit ou son repli est affiche',
      Boolean(legende && legende.trim()),
      (legende ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
    );

    // Une notice sur six n'a pas d'image : la section disparait, elle ne
    // laisse pas un cadre vide qui ferait croire a un chargement.
    await onglet.goto(`${BASE}/?ref=PA67000108`, { waitUntil: 'domcontentloaded' });
    await attendre(onglet, '.fiche .fermer');
    await onglet.waitForTimeout(600);
    verifier(
      'aucune section photo sans image',
      (await onglet.locator('.photo').count()) === 0,
      `${await onglet.locator('.photo').count()} figure(s)`
    );

    // `?notice=` a circule avant `?ref=` : l'alias doit encore ouvrir la fiche.
    await onglet.goto(`${BASE}/?notice=PA00097411`, { waitUntil: 'domcontentloaded' });
    await attendre(onglet, '.fiche .fermer');
    const titreAlias = await onglet.textContent('.fiche h2');
    verifier('l alias notice= ouvre la fiche', Boolean(titreAlias), titreAlias ?? 'aucun titre');

    await onglet.close();
  }

  await page.locator('.bascule button', { hasText: 'Liste' }).click();
  await attendre(page, '.liste header p');


  // --- Notices sans coordonnees, absentes de la carte ----------------------
  const mention = await page.textContent('.liste header p');
  verifier('notices sans coordonnees signalees', /2\s?276/.test(mention ?? ''), mention ?? '');

  // --- Permalien -----------------------------------------------------------
  // L'ouverture d'une fiche empile une entree d'historique : le retour arriere
  // doit la refermer, pas quitter l'application.
  const urlFiche = page.url();
  verifier('reference portee par l URL', /[?&]ref=/.test(urlFiche), urlFiche.slice(-60));
  verifier('vue liste portee par l URL', /[?&]vue=liste/.test(urlFiche));

  await page.goBack();
  await page.waitForTimeout(900);
  verifier(
    'retour arriere referme la fiche',
    (await page.locator('.fiche .fermer').count()) === 0 && !/[?&]ref=/.test(page.url()),
    page.url().slice(-60)
  );

  // Un filtre s'ecrit par remplacement : l'historique ne doit pas gonfler.
  await page.getByRole('button', { name: 'architecture militaire' }).click();
  await page.waitForFunction(
    () => {
      const el = document.querySelector('.chiffres span b');
      return el && Number.parseInt(el.textContent.replace(/\D/g, ''), 10) === 1688;
    },
    null,
    { timeout: 20_000 }
  );
  const urlFiltre = page.url();
  verifier('filtre porte par l URL', /domaine=architecture\+militaire/.test(urlFiltre), urlFiltre.slice(-60));

  await page.goto(urlFiltre, { waitUntil: 'domcontentloaded' });
  await attendre(page, '.chiffres b');
  const restaure = await total(page);
  verifier('permalien restaure le filtre', restaure === 1688, `obtenu ${restaure}`);
  const facetteCochee = await page
    .locator('section:has(button.titre:text("Domaine")) .option.choisi')
    .count();
  verifier('facette rouverte cochee', facetteCochee === 1, `${facetteCochee} option(s)`);

  await page.getByRole('button', { name: /effacer \d+ filtres?/ }).click();
  await page.waitForFunction(() => !/[?&]domaine=/.test(location.search), null, { timeout: 20_000 });
  verifier('remise a zero nettoie l URL', page.url().split('?')[1] === undefined || !/domaine/.test(page.url()));

  // --- Matrice siecle x decennie --------------------------------------------
  await page.locator('.bascule button', { hasText: 'Matrice' }).click();
  await attendre(page, '.matrice svg rect');
  const cellules = await page.locator('.matrice svg rect').count();
  verifier('matrice rendue', cellules > 100, `${cellules} cellules`);

  // Les siecles anterieurs au 10e sont ecartes de l'axe : ils doivent etre
  // annonces, pas tus.
  const note = await page.locator('.matrice .note').textContent();
  verifier('occurrences ecartees signalees', /\d/.test(note ?? ''), (note ?? 'absente').trim());

  // Un clic pose les deux axes d'un coup, et le permalien les transporte.
  await page.locator('.matrice svg rect').nth(60).click();
  await page.waitForFunction(
    () => /siecle=/.test(location.search) && /annees=/.test(location.search),
    null,
    { timeout: 20_000 }
  );
  verifier(
    'un clic dans la matrice pose siecle et plage d annees',
    /siecle=/.test(page.url()) && /annees=/.test(page.url()),
    page.url().split('?')[1] ?? ''
  );
  // L'URL est ecrite des le changement de filtre, bien avant que les requetes
  // aient repondu : attendre le compteur, pas l'adresse.
  await page.waitForFunction(
    () => {
      const el = document.querySelector('.chiffres span b');
      return el && Number.parseInt(el.textContent.replace(/\D/g, ''), 10) < 46760;
    },
    null,
    { timeout: 20_000 }
  );
  const croise2 = await total(page);
  verifier('la matrice restreint le corpus', croise2 > 0 && croise2 < 46760, `obtenu ${croise2}`);

  await page.getByRole('button', { name: /effacer \d+ filtres?/ }).click();
  await page.waitForFunction(() => {
    const el = document.querySelector('.chiffres span b');
    return el && el.textContent.replace(/\D/g, '') === '46760';
  }, null, { timeout: 20_000 });

  // --- Gabarit telephone ----------------------------------------------------
  // Un lien partage s'ouvre le plus souvent sur un telephone : la grille a
  // trois colonnes doit y ceder la place a des calques.
  await page.locator('.bascule button', { hasText: 'Carte' }).click();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(600);

  verifier('carte visible sur gabarit etroit', await page.locator('.maplibregl-canvas').isVisible());
  const debordement = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  verifier('aucun debordement horizontal', debordement <= 0, `${debordement} px`);

  await page.getByRole('button', { name: /^Filtres/ }).click();
  await page.waitForTimeout(400);
  verifier('tiroir des filtres ouvert', await page.locator('.facettes.ouvert').count() === 1);
  await page.locator('.fermer-tiroir').click();
  await page.waitForTimeout(400);
  verifier('tiroir des filtres referme', await page.locator('.facettes.ouvert').count() === 0);

  await page.locator('.bascule button', { hasText: 'Liste' }).click();
  await attendre(page, '.liste button');
  await page.locator('.liste button').first().click();
  await attendre(page, '.fiche .fermer');
  verifier('fiche en feuille remontante', await page.locator('.fiche-hote.ouvert').count() === 1);
  await page.goBack();
  await page.waitForTimeout(900);
  verifier(
    'retour arriere referme la feuille',
    (await page.locator('.fiche-hote.ouvert').count()) === 0,
    page.url().slice(-40)
  );

  await page.setViewportSize({ width: 1600, height: 950 });
  await page.waitForTimeout(500);

  // --- Service worker -------------------------------------------------------
  // Trois chargements sont necessaires pour observer le cache : au premier la
  // page n'est pas encore controlee, au deuxieme le worker intercepte et
  // remplit son cache, au troisieme seulement il resert sans reseau.
  const cheminWasm = [...octets.keys()].find((chemin) => chemin.endsWith('.wasm'));
  verifier('binaire DuckDB servi', Boolean(cheminWasm), cheminWasm ?? 'aucun');

  if (cheminWasm) {
    await page.evaluate(() => navigator.serviceWorker.ready);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await attendre(page, '.chiffres b');
    const apresDeuxieme = octets.get(cheminWasm) ?? 0;

    await page.reload({ waitUntil: 'domcontentloaded' });
    await attendre(page, '.chiffres b');
    const troisieme = (octets.get(cheminWasm) ?? 0) - apresDeuxieme;

    const controle = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
    verifier('service worker aux commandes', controle);
    verifier(
      'binaire DuckDB resservi sans reseau',
      troisieme === 0,
      `${(troisieme / 1024).toFixed(0)} Ko retelecharges`
    );
  }

  verifier('aucune erreur console', erreursConsole.length === 0, erreursConsole.slice(0, 3).join(' | '));

  // Capture en vue carte, l'ecran par defaut de l'application.
  await page.locator('.bascule button', { hasText: 'Carte' }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'tests/apercu.png', fullPage: false });
} catch (e) {
  // Une etape qui echoue ne doit pas masquer le resultat des precedentes.
  fatale = e;
  await page.screenshot({ path: 'tests/echec.png' }).catch(() => {});
} finally {
  await navigateur.close();
  serveur.close();
}

console.log('Transferts /data (mesures cote serveur) :');
for (const [chemin, taille] of octets) {
  if (chemin.startsWith('/data/')) {
    console.log(`  ${chemin.replace('/data/', '').padEnd(22)} ${(taille / 1024).toFixed(0)} Ko`);
  }
}
console.log('');

for (const { nom, ok, detail } of resultats) {
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${nom}${detail ? `  (${detail})` : ''}`);
}
if (fatale) {
  console.log(`\nInterrompu : ${String(fatale.message ?? fatale).split('\n')[0]}`);
  if (erreursConsole.length) console.log(`Console : ${erreursConsole.slice(0, 5).join(' | ')}`);
}
console.log(`\n${resultats.length - echecs}/${resultats.length} verifications passees`);
process.exit(echecs || fatale ? 1 : 0);
