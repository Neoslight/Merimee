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
import { readdirSync, readFileSync } from 'node:fs';
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
// Le fond de carte ne suit plus le theme : une seule feuille de style doit
// partir sur le reseau, quel que soit le nombre de bascules.
const fondsDemandes = [];
page.on('request', (r) => {
  if (r.url().includes('basemaps.cartocdn.com') && r.url().endsWith('style.json')) {
    fondsDemandes.push(r.url());
  }
});
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

  // --- Typographie ----------------------------------------------------------
  // `Inter` avait ete declaree pendant des mois sans qu'aucun `@font-face` ne
  // la serve : le site tournait dans la police du systeme, et rien ne le
  // disait. On verifie donc que les fichiers arrivent, pas que le nom est ecrit.
  await page.evaluate(() => document.fonts.ready);
  const polices = await page.evaluate(() => ({
    interface: document.fonts.check('400 14px "Plus Jakarta Sans Variable"'),
    titre: document.fonts.check('500 32px "Newsreader Variable"'),
    marque: getComputedStyle(document.querySelector('.marque strong')).fontFamily
  }));
  verifier(
    'les deux polices sont reellement servies',
    polices.interface && polices.titre && /Newsreader/.test(polices.marque),
    `${polices.interface ? 'Jakarta' : 'JAKARTA MANQUANTE'} · ${polices.titre ? 'Newsreader' : 'NEWSREADER MANQUANTE'}`
  );

  // --- Le tiroir des filtres est un calque ---------------------------------
  // Ouvert par defaut des qu'il y a la place de le poser a cote de la carte,
  // mais il ne lui prend jamais un pixel : c'est ce qui evite tout
  // redimensionnement du canevas WebGL a chaque bascule.
  const largeurCarte = (await page.locator('.maplibregl-canvas').boundingBox()).width;
  verifier(
    'tiroir ouvert par defaut au large',
    (await page.locator('.facettes.ouvert').count()) === 1
  );
  await page.getByRole('button', { name: /^Filtres/ }).click();
  await page.waitForTimeout(300);
  verifier(
    'le tiroir se referme au large',
    (await page.locator('.facettes.ouvert').count()) === 0
  );
  const largeurRepliee = (await page.locator('.maplibregl-canvas').boundingBox()).width;
  verifier(
    'le tiroir ne prend pas de largeur a la carte',
    Math.abs(largeurRepliee - largeurCarte) < 1,
    `${largeurCarte} -> ${largeurRepliee} px`
  );
  await page.getByRole('button', { name: /^Filtres/ }).click();
  await page.waitForTimeout(300);

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
    .locator('section:has(.nom-section:text("Domaine")) .option')
    .count();
  verifier('facette domaine garde ses alternatives', autresDomaines > 5, `${autresDomaines} options`);

  // --- Cardinalites ---------------------------------------------------------
  // Le panneau plafonne a 40 valeurs. Sans ce nombre, rien ne disait que
  // « architecte » en cache 7 040 : la liste avait l'air complete.
  const cardinalAuteurs = await page
    .locator('section:has(.nom-section:text("Architecte")) .cardinal')
    .textContent();
  const combienAuteurs = Number.parseInt((cardinalAuteurs ?? '').replace(/\D/g, ''), 10);
  verifier(
    'la cardinalite dit ce que les 40 valeurs cachent',
    combienAuteurs > 40,
    `${cardinalAuteurs?.trim()} auteurs distincts sous le filtre courant`
  );

  // --- Pastille de statut ---------------------------------------------------
  // Le statut est la seule facette au code couleur : la pilule « classe » prend
  // l'aplat terracotta plein, les autres restent neutres.
  const sectionStatut = page.locator('section:has(.nom-section:text("Statut"))');
  await sectionStatut.getByRole('button', { name: /^classé / }).first().click();
  await page.waitForFunction(() => document.querySelectorAll('.jetons button:not(.raz)').length === 2, null, { timeout: 20_000 });
  const pastille = await page.evaluate(() => {
    const el = document.querySelector('.option.choisi.statut-classe');
    if (!el) return null;
    const fond = getComputedStyle(el).backgroundColor;
    // Un aplat plein, pas un voile : une pilule translucide dirait « survolee »,
    // pas « posee ».
    return { fond, opaque: !/^rgba\(.*,\s*0?\.\d+\)$/.test(fond) };
  });
  verifier(
    'la pilule du statut classe est un aplat plein',
    Boolean(pastille?.opaque),
    pastille ? pastille.fond : 'aucune pilule statut-classe'
  );
  await sectionStatut.locator('.option.choisi').first().click();
  await page.waitForFunction((attendu) => {
    const el = document.querySelector('.chiffres span b');
    return el && Number.parseInt(el.textContent.replace(/\D/g, ''), 10) === attendu;
  }, militaire, { timeout: 20_000 });

  // --- Puces de filtres actifs ---------------------------------------------
  // Le nom accessible d'une puce porte l'action, pas la seule valeur : sans
  // cela elle serait indiscernable de l'option de meme libelle dans le
  // panneau de facettes, et le clic ci-dessus deviendrait ambigu.
  const puces = page.locator('.jetons button:not(.raz)');
  verifier('une puce pour le filtre pose', (await puces.count()) === 1, `${await puces.count()} puce(s)`);

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

  verifier('une puce par critere, siecle compris', (await puces.count()) === 2, `${await puces.count()} puces`);
  // L'ordre des puces suit celui de `CLAUSES` : le siecle vient avant le
  // domaine. Le retirer doit ramener au seul filtre restant, pas au corpus.
  await puces.first().click();
  await page.waitForFunction(
    (avant) => {
      const el = document.querySelector('.chiffres span b');
      return el && Number.parseInt(el.textContent.replace(/\D/g, ''), 10) !== avant;
    },
    croise,
    { timeout: 20_000 }
  );
  const apresPuce = await total(page);
  verifier('retirer une puce ne retire qu elle', apresPuce === militaire, `obtenu ${apresPuce}`);

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

  // La puce de recherche a un etat miroir hors de `filters` : le champ de la
  // barre, qui alimente le filtre par un effet retarde. Vider l'un sans
  // l'autre laisserait le texte affiche sur un corpus complet.
  await page.locator('.jetons button:not(.raz)').first().click();
  await page.waitForFunction(() => {
    const el = document.querySelector('.chiffres span b');
    return el && el.textContent.replace(/\D/g, '') === '46760';
  }, null, { timeout: 20_000 });
  const champ = await page.inputValue('.recherche');
  verifier('la puce de recherche vide aussi le champ', champ === '', `« ${champ} »`);

  // --- Recherche a l'interieur d'une facette --------------------------------
  // `Baltard Victor` (5 notices) est hors des 40 valeurs les plus frequentes
  // parmi 7 040 auteurs : le trouver prouve que la recherche descend dans
  // DuckDB au lieu de trier la liste deja rapatriee.
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

  // --- Puce de zone visible -------------------------------------------------
  // `bbox` a elle aussi un etat miroir hors de `filters` : le suivi de vue de
  // la carte. Retirer la puce sans l'eteindre laisserait le prochain
  // deplacement reposer la zone aussitot.
  await page.getByRole('button', { name: 'lier la vue' }).click();
  await page.waitForSelector('.jetons button:not(.raz)', { timeout: 20_000 });
  const puceZone = page.locator('.jetons button:not(.raz)').first();
  verifier(
    'la zone visible a sa puce',
    (await puceZone.textContent()).includes('zone visible'),
    (await puceZone.textContent()).trim()
  );
  await puceZone.click();
  await page.waitForTimeout(500);
  const libelleSuivi = (await page.locator('.legende button').last().textContent()).trim();
  verifier('la puce de zone delie la vue', libelleSuivi === 'lier la vue', libelleSuivi);

  // --- Brossage de l axe construction ---------------------------------------
  // L'echelle des siecles est **a bandes** : pas d'`invert`, le pixel se
  // retraduit en balayant les bandes. Un glissement doit poser plusieurs
  // siecles la ou le clic n'en bascule qu'un.
  const piste = await page.locator('.cliquable').boundingBox();
  await page.mouse.move(piste.x + piste.width * 0.5, piste.y + piste.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(piste.x + piste.width * 0.8, piste.y + piste.height * 0.6, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(700);
  const brosses = new URL(page.url()).searchParams.getAll('siecle');
  verifier(
    'un glissement pose une plage de siecles',
    brosses.length >= 3,
    brosses.join(', ') || 'aucun siecle'
  );
  await page.getByRole('button', { name: /effacer \d+ filtres?/ }).click();
  await page.waitForFunction(() => {
    const el = document.querySelector('.chiffres span b');
    return el && el.textContent.replace(/\D/g, '') === '46760';
  }, null, { timeout: 20_000 });

  // --- Theme clair ----------------------------------------------------------
  // `setStyle` detruit sources et couches : c'est la regression que ce lot
  // risque le plus. Un `setPaintProperty` sur une couche disparue leve, donc
  // le compteur d'erreurs console fait foi.
  const avantTheme = erreursConsole.length;

  const sombre = await page.evaluate(() => ({
    fond: getComputedStyle(document.body).backgroundColor,
    texte: getComputedStyle(document.body).color
  }));

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
  verifier('contraste du texte au moins 4,5:1 en clair', contraste >= 4.5, `${contraste.toFixed(2)}:1`);

  // Les deux themes sont des livrables, pas un seul : le sombre etait jusqu'ici
  // le seul a n'avoir jamais ete mesure.
  const lfs = luminance(sombre.fond);
  const lts = luminance(sombre.texte);
  const contrasteSombre = (Math.max(lfs, lts) + 0.05) / (Math.min(lfs, lts) + 0.05);
  verifier(
    'contraste du texte au moins 4,5:1 en sombre',
    lfs < 0.5 && contrasteSombre >= 4.5,
    `${sombre.fond} -> ${contrasteSombre.toFixed(2)}:1`
  );

  // Le theme ne pilote que l'interface : le fond de carte reste ardoise dans
  // les deux cas. Les points portent un lisere clair et la rampe de densite
  // monte vers le blanc — les deux supposent une carte sombre.
  const sceneClaire = await page.evaluate(
    () => getComputedStyle(document.querySelector('.scene')).backgroundColor
  );
  verifier(
    'la scene reste ardoise en theme clair',
    luminance(sceneClaire) < 0.1,
    sceneClaire
  );
  verifier(
    'aucun fond de carte clair demande',
    fondsDemandes.length > 0 && fondsDemandes.every((u) => u.includes('dark-matter')),
    `${fondsDemandes.length} requete(s), ${new Set(fondsDemandes.map((u) => u.split('/gl/')[1]?.split('/')[0])).size} style(s)`
  );

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

    // Le bouton de la fiche partage l'implementation de celui de la barre : le
    // lien produit porte donc aussi la vue de carte. Son nom accessible en
    // differe, sinon les deux boutons seraient indiscernables.
    await onglet.getByRole('button', { name: 'Copier le lien de la notice' }).click();
    await onglet.waitForTimeout(400);
    const lienFiche = decodeURIComponent(
      await onglet.evaluate(() => navigator.clipboard.readText())
    );
    verifier(
      'copier le lien depuis la fiche',
      /ref=PA00097411/.test(lienFiche) && /c=-?[\d.]+,-?[\d.]+,[\d.]+/.test(lienFiche),
      lienFiche.split('?')[1] ?? lienFiche
    );

    // Une notice sur six n'a pas d'image. La plaque la nomme, mais elle **dit**
    // l'absence : aucune image, aucune animation, rien qui puisse passer pour
    // un chargement en cours.
    await onglet.goto(`${BASE}/?ref=PA67000108`, { waitUntil: 'domcontentloaded' });
    await attendre(onglet, '.fiche .fermer');
    await onglet.waitForTimeout(600);
    verifier(
      'aucune section photo sans image',
      (await onglet.locator('.photo').count()) === 0,
      `${await onglet.locator('.photo').count()} figure(s)`
    );
    const plaque = onglet.locator('.plaque');
    verifier(
      'une plaque nommee remplace la photo absente',
      (await plaque.count()) === 1 && (await plaque.locator('img').count()) === 0,
      ((await plaque.textContent()) ?? '').replace(/\s+/g, ' ').trim().slice(0, 70)
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
    .locator('section:has(.nom-section:text("Domaine")) .option.choisi')
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

  // --- Aucune couleur en dur hors d'`app.css` --------------------------------
  // MapLibre et Plot lisent la palette par `getComputedStyle` : une couleur
  // ecrite dans un composant ne serait relue par personne et resterait muette
  // au changement de theme. C'est une lecture de source, pas de navigateur —
  // mais c'est ici qu'elle est jouee a chaque passe.
  //
  // `theme.svelte.ts` en est exclu : sa palette de repli **doit** porter des
  // valeurs, le rendu prealable n'ayant pas de document a interroger. C'est le
  // seul miroir volontaire d'`app.css`, et le commentaire du fichier le dit.
  const racine = new URL('../src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const fichiers = [];
  const parcourir = (dossier) => {
    for (const entree of readdirSync(dossier, { withFileTypes: true })) {
      const chemin = `${dossier}/${entree.name}`;
      if (entree.isDirectory()) parcourir(chemin);
      else if (/\.(svelte|ts)$/.test(entree.name) && entree.name !== 'theme.svelte.ts') {
        fichiers.push(chemin);
      }
    }
  };
  parcourir(racine);
  const fautifs = fichiers.filter((f) => /#[0-9a-fA-F]{6}/.test(readFileSync(f, 'utf8')));
  verifier(
    'aucune couleur en dur hors app.css',
    fautifs.length === 0,
    fautifs.map((f) => f.split('/src/')[1]).join(', ') || `${fichiers.length} fichiers relus`
  );

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
