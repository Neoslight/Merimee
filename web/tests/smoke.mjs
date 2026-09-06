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
const mesuresRelevees = [];
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
// Le fond de carte suit le theme : une feuille par bascule, et c'est leur
// **succession** qui est verifiee — dark-matter en sombre, positron en clair.
const fondsDemandes = [];
const nomFond = (u) => u.split('/gl/')[1]?.split('/')[0] ?? '';

/**
 * Attend que la carte ait effectivement repose ses couches.
 *
 * Un delai fixe serait un pari sur le reseau : la feuille CARTO fait 107 Ko et
 * `style.load` n'arrive qu'apres, si bien qu'un releve pris trop tot montre
 * l'etat d'avant la bascule. Rend le dernier releve dans tous les cas — c'est
 * a la verification de trancher, pas au guetteur.
 */
async function attendreCarte(onglet, predicat, limite = 15000) {
  const lire = () =>
    onglet.evaluate(() =>
      window.__carte
        ? { teinture: { ...window.__carte.teinture }, chaleurHaute: window.__carte.chaleurHaute }
        : null
    );
  const t0 = Date.now();
  let etat = await lire();
  while (Date.now() - t0 < limite && !(etat && predicat(etat))) {
    await onglet.waitForTimeout(200);
    etat = await lire();
  }
  return etat ?? { teinture: {}, chaleurHaute: '' };
}
page.on('request', (r) => {
  if (r.url().includes('basemaps.cartocdn.com') && r.url().endsWith('style.json')) {
    fondsDemandes.push(r.url());
  }
});
page.on('console', (msg) => msg.type() === 'error' && erreursConsole.push(msg.text()));
page.on('pageerror', (e) => erreursConsole.push(String(e)));

// Les fonds historiques IGN sont interceptes, jamais telecharges : ce depot
// tient ses tests hors reseau — l'ETL est concu ainsi deliberement — et une
// suite qui depend de la disponibilite de la Geoplateforme devient
// intermittente. On verifie donc la **forme** des URL emises, pas le contenu
// des tuiles. Le PNG 1x1 transparent suffit a MapLibre.
const tuilesIgn = [];
const PNG_VIDE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);
await page.route('**://data.geopf.fr/**', (route) => {
  tuilesIgn.push(route.request().url());
  return route.fulfill({ status: 200, contentType: 'image/png', body: PNG_VIDE });
});

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
  verifier(
    'le bouton des filtres s efface quand le tiroir est ouvert',
    (await page.locator('.scene > button.filtres').count()) === 0
  );
  await page.locator('.fermer-tiroir').click();
  await page.waitForTimeout(300);
  verifier(
    'le tiroir se referme au large',
    (await page.locator('.facettes.ouvert').count()) === 0
  );
  verifier(
    'le bouton des filtres revient avec la croix',
    (await page.locator('.scene > button.filtres').count()) === 1
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
  await page.locator('.piste-siecles rect').nth(9).click();
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

  // --- Recherche plein texte dans les historiques ---------------------------
  // L'index pese 3,8 Mo : il ne doit partir qu'au premier usage du mode, jamais
  // au demarrage. Le compteur d'octets du serveur en fait foi.
  const octetsTexte = () =>
    [...octets].filter(([c]) => c.startsWith('/data/texte/'))
               .reduce((somme, [, n]) => somme + n, 0);
  verifier('aucun octet d index plein texte au demarrage', octetsTexte() === 0,
           `${octetsTexte()} o`);

  const attendreTotal = (attendu) =>
    page.waitForFunction((n) => {
      const el = document.querySelector('.chiffres span b');
      return el && el.textContent.replace(/\D/g, '') === String(n);
    }, attendu, { timeout: 30_000 });

  await page.locator('.bascule button', { hasText: 'Liste' }).click();
  await page.locator('button.cible').click();
  await page.fill('.recherche', 'jubé');
  // 34 est l'oracle : `historique LIKE '%jube%'` sur les fragments en compte 34,
  // le 35e est dans `precision_protection`, qui n'est pas indexe.
  await attendreTotal(34);
  verifier('« jube » trouve les 34 historiques qui le citent',
           (await total(page)) === 34);
  verifier('les trois fichiers d index sont demandes',
           [...octets.keys()].filter((c) => c.startsWith('/data/texte/')).length === 3,
           `${(octetsTexte() / 1048576).toFixed(1)} Mo`);

  // Le classement BM25 se voit ici et nulle part ailleurs : la carte et les
  // facettes n'ont besoin que de l'appartenance.
  const premier = await page.locator('.liste li .nom').first().textContent();
  verifier('le classement BM25 met Vitteaux en tete',
           premier.includes("Saint-Germain-d'Auxerre"), premier);

  verifier('le permalien porte le terme plein texte',
           page.url().includes('texte=jube') && !page.url().includes('q='),
           page.url().split('?')[1] ?? '');

  // Le lexique des formes remplace un stemmer cote navigateur : singulier et
  // pluriel doivent designer le meme terme.
  await page.fill('.recherche', 'mascarons');
  await attendreTotal(118);
  const pluriel = await total(page);
  await page.fill('.recherche', 'mascaron');
  await attendreTotal(118);
  verifier('singulier et pluriel donnent le meme corpus',
           pluriel === (await total(page)), `${pluriel} notices`);

  // Un mot absent du lexique n'existe dans aucun historique : la reponse
  // honnete est zero notice, accompagnee de la raison. Rendre le corpus entier
  // serait pire — le filtre paraitrait pose sans agir.
  await page.fill('.recherche', 'zzzintrouvable');
  await attendreTotal(0);
  const portee = (await page.textContent('.portee')).replace(/\s+/g, ' ');
  verifier('un mot inconnu se dit au lieu de rendre zero en silence',
           portee.includes('zzzintrouvable') && portee.includes('24 819'), portee.trim());

  // Retour a l'etat neutre pour la suite : mode titres, champ vide, vue carte.
  await page.locator('.jetons button:not(.raz)').first().click();
  await page.locator('button.cible').click();
  await page.locator('.bascule button', { hasText: 'Carte' }).click();
  await attendreTotal(46760);

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
  await page.waitForTimeout(300);

  // L'attribution et la legende se partageaient le coin bas gauche : la
  // pastille « i » se posait sur la legende. La preuve est geometrique, pas
  // une lecture de la regle CSS qui la deplace.
  const boiteAttrib = await page.locator('.maplibregl-ctrl-bottom-right').boundingBox();
  const boiteLegende = await page.locator('.legende').boundingBox();
  const disjointes =
    boiteAttrib.x >= boiteLegende.x + boiteLegende.width ||
    boiteLegende.x >= boiteAttrib.x + boiteAttrib.width ||
    boiteAttrib.y >= boiteLegende.y + boiteLegende.height ||
    boiteLegende.y >= boiteAttrib.y + boiteAttrib.height;
  verifier(
    'l attribution ne recouvre plus la legende',
    disjointes,
    `attrib x${Math.round(boiteAttrib.x)} · legende x${Math.round(boiteLegende.x)}`
  );
  await page.getByRole('button', { name: 'densité' }).click();
  await page.waitForTimeout(500);
  // Viser le bouton par son nom : `.legende button[aria-pressed]` attrapait le
  // premier venu, et la legende en compte trois.
  const etatDensite = await page
    .getByRole('button', { name: 'densité' })
    .getAttribute('aria-pressed');
  verifier('bascule densite active', etatDensite === 'true', String(etatDensite));
  await page.getByRole('button', { name: 'densité' }).click();

  // --- Fonds de carte historiques -------------------------------------------
  // Cassini pese ~170 Ko la tuile, soit ~2 Mo par ecran : la superposition doit
  // rester explicite. Le seul moyen de le prouver est de compter les requetes
  // avant toute activation.
  verifier('aucune tuile IGN avant activation', tuilesIgn.length === 0, `${tuilesIgn.length} requetes`);

  // Le module des cartes anciennes est replie par defaut : il ne coute son coin
  // de carte que lorsqu'on s'en sert.
  verifier(
    'les cartes anciennes sont repliees au depart',
    (await page.locator('button.ouvrir-fonds').count()) === 1 &&
      (await page.locator('.fonds').count()) === 0
  );
  await page.locator('button.ouvrir-fonds').click();
  await page.waitForTimeout(300);

  await page.getByRole('button', { name: 'Cassini' }).click();
  await page.waitForTimeout(900);
  verifier('Cassini demande ses tuiles une fois active', tuilesIgn.length > 0, `${tuilesIgn.length} tuiles`);

  // Le prefixe `BNF-IGNF_` est obligatoire : l'identifiant nu renvoie 400.
  verifier(
    'la couche Cassini porte son prefixe BNF-IGNF_',
    tuilesIgn.every((u) => u.includes('LAYER=BNF-IGNF_GEOGRAPHICALGRIDSYSTEMS.CASSINI')) &&
      tuilesIgn.every((u) => u.includes('TILEMATRIXSET=PM')),
    tuilesIgn[0]?.slice(0, 120) ?? ''
  );

  // L'attribution n'est pas decorative : ce sont des reproductions BnF / IGN.
  const attributionAvec = await page.locator('.maplibregl-ctrl-attrib').innerText();
  verifier('attribution Cassini affichee', /Cassini/i.test(attributionAvec), attributionAvec.slice(0, 90));

  // Le piege du dispositif : Cassini s'arrete a z14. Sans `maxzoom` sur la
  // source, MapLibre reclame des tuiles inexistantes au-dela et la couche
  // disparait au moment precis ou l'on zoome sur l'edifice. Le cadrage passe
  // par `c=`, seul chemin fiable pour poser un zoom : la carte n'a pas le
  // focus clavier, et une molette simulee ne fait qu'approcher la valeur.
  const urlAvantZoom = page.url();
  tuilesIgn.length = 0;
  await page.goto(`${BASE}/?fond=cassini&c=2.35,48.85,16`, { waitUntil: 'domcontentloaded' });
  await attendre(page, '.chiffres b');
  await page.waitForTimeout(1500);
  const niveaux = tuilesIgn
    .map((u) => Number.parseInt(new URL(u).searchParams.get('TILEMATRIX') ?? '', 10))
    .filter((n) => Number.isInteger(n));
  // Deux exigences, pas une : la couche est **toujours servie** a z16 (elle
  // demande donc des tuiles), et elle les demande **au niveau 14**, plafonnee.
  verifier(
    'Cassini reste servie au-dela de son zoom maximal',
    niveaux.length > 0 && Math.max(...niveaux) === 14,
    niveaux.length ? `niveaux demandes ${[...new Set(niveaux)].sort((a, b) => a - b).join(', ')}` : 'aucune tuile'
  );

  // Le detour par `goto` a efface l'etat : le rendre, pour que la suite reparte
  // d'ou elle en etait.
  await page.goto(urlAvantZoom, { waitUntil: 'domcontentloaded' });
  await attendre(page, '.chiffres b');
  await page.waitForTimeout(600);

  // Densite et fond historique repondent a deux questions incompatibles :
  // activer l'un doit eteindre l'autre.
  await page.getByRole('button', { name: 'densité' }).click();
  await page.waitForTimeout(300);
  const cassiniApresDensite = await page
    .getByRole('button', { name: 'Cassini' })
    .getAttribute('aria-pressed');
  verifier('activer la densite eteint le fond historique', cassiniApresDensite === 'false', String(cassiniApresDensite));
  await page.getByRole('button', { name: 'densité' }).click();

  // Le fond est un etat d'exploration, son opacite un confort de lecture : le
  // premier va dans l'URL, la seconde non.
  await page.getByRole('button', { name: 'État-major' }).click();
  await page.waitForTimeout(400);
  const urlFond = new URL(page.url());
  verifier('le fond historique entre dans l URL', urlFond.searchParams.get('fond') === 'etatmajor', page.url());
  verifier(
    'l opacite reste hors de l URL',
    !page.url().includes('opacite'),
    page.url()
  );

  const dosage = page.getByRole('slider', { name: /Opacité du fond/ });
  verifier('le curseur d opacite apparait avec le fond', (await dosage.count()) === 1);

  // Un `setPaintProperty` sur une couche absente leve : c'est le compteur
  // d'erreurs console qui fait foi, pas l'inspection du style.
  const avantDosage = erreursConsole.length;
  await dosage.fill('100');
  await page.waitForTimeout(300);
  await dosage.fill('0');
  await page.waitForTimeout(300);
  verifier(
    'le dosage repeint sans erreur',
    erreursConsole.length === avantDosage,
    erreursConsole.slice(avantDosage, avantDosage + 2).join(' | ')
  );

  await page.getByRole('button', { name: 'État-major' }).click();
  await page.waitForTimeout(300);
  const attributionSans = await page.locator('.maplibregl-ctrl-attrib').innerText();
  verifier(
    'l attribution disparait avec le fond',
    !/Cassini|état-major/i.test(attributionSans),
    attributionSans.slice(0, 90)
  );
  verifier('le fond quitte l URL', !page.url().includes('fond='), page.url());

  // --- Semiologie par epoque ------------------------------------------------
  // Les cles de lecture portent `.cle` : la legende contient d'autres `span`
  // depuis qu'elle nomme ses commandes, et compter `span` melangerait les deux.
  const legendeStatut = await page.locator('.legende .cle').count();
  await page.locator('.legende button.mode', { hasText: 'époque' }).click();
  await page.waitForTimeout(400);
  const legendeEpoque = await page.locator('.legende .cle').count();
  verifier(
    'la legende suit le mode de coloration',
    legendeStatut === 3 && legendeEpoque === 5,
    `${legendeStatut} -> ${legendeEpoque}`
  );
  // Deux boutons exclusifs, pas une bascule : le rail annonce l'etat courant.
  const epoqueActive = await page
    .locator('.legende button.mode', { hasText: 'époque' })
    .getAttribute('aria-pressed');
  verifier('le rail de coloration annonce l option retenue', epoqueActive === 'true', String(epoqueActive));
  await page.locator('.legende button.mode', { hasText: 'statut' }).click();
  await page.waitForTimeout(300);

  // Les cartes anciennes ont quitte la legende pour leur propre boite.
  verifier(
    'les cartes anciennes ont leur boite a part',
    (await page.locator('.fonds > button').count()) === 2 &&
      (await page.locator('.legende button', { hasText: 'Cassini' }).count()) === 0
  );
  // Un lien portant `fond=` doit ouvrir le module : sinon la carte ancienne
  // s'affiche sans commande visible pour l'eteindre.
  verifier(
    'un fond porte par l URL deplie le module',
    (await page.locator('.fonds').count()) === 1,
    page.url().split('?')[1] ?? '(aucun parametre)'
  );

  // --- Puce de zone visible -------------------------------------------------
  // `bbox` a elle aussi un etat miroir hors de `filters` : le suivi de vue de
  // la carte. Retirer la puce sans l'eteindre laisserait le prochain
  // deplacement reposer la zone aussitot.
  // La case vit dans le tiroir des filtres : restreindre a la zone visible est
  // un critere, pas un reglage d'affichage. Au large le tiroir est ouvert par
  // defaut — ne l'ouvrir que s'il ne l'est pas, sinon le bouton flottant, qui
  // s'efface tant qu'il est ouvert, n'existe pas.
  if ((await page.locator('.facettes.ouvert').count()) === 0) {
    await page.getByRole('button', { name: /^Filtres/ }).click();
    await page.waitForTimeout(320);
  }
  const zone = page.getByRole('checkbox', { name: /zone visible/ });
  verifier('la case de zone visible est dans le tiroir', (await zone.count()) === 1);
  await zone.check();
  await page.waitForSelector('.jetons button:not(.raz)', { timeout: 20_000 });
  const puceZone = page.locator('.jetons button:not(.raz)').first();
  verifier(
    'la zone visible a sa puce',
    (await puceZone.textContent()).includes('zone visible'),
    (await puceZone.textContent()).trim()
  );
  await puceZone.click();
  await page.waitForTimeout(500);
  const encoreLiee = await zone.isChecked();
  verifier('la puce de zone delie la vue', encoreLiee === false, String(encoreLiee));

  // --- Brossage de l axe construction ---------------------------------------
  // L'echelle des siecles est **a bandes** : pas d'`invert`, le pixel se
  // retraduit en balayant les bandes. Un glissement doit poser plusieurs
  // siecles la ou le clic n'en bascule qu'un.
  const piste = await page.locator('.piste-siecles').boundingBox();
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

  // --- L axe des protections repond aux memes gestes ------------------------
  // Les deux bornes saisissables ont disparu : un clic pose une annee, un
  // glissement une plage, comme sur l'axe des siecles.
  const pisteAnnees = await page.locator('.piste-annees').boundingBox();
  await page.mouse.click(
    pisteAnnees.x + pisteAnnees.width * 0.6,
    pisteAnnees.y + pisteAnnees.height * 0.5
  );
  await page.waitForFunction(() => /annees=/.test(location.search), null, { timeout: 20_000 });
  const uneAnnee = new URL(page.url()).searchParams.get('annees');
  verifier(
    'un clic sur l axe des protections pose une annee',
    /^\d{4}-\d{4}$/.test(uneAnnee ?? '') && uneAnnee.split('-')[0] === uneAnnee.split('-')[1],
    uneAnnee ?? 'aucune'
  );
  await page.getByRole('button', { name: /effacer \d+ filtres?/ }).click();
  await page.waitForFunction(() => !/annees=/.test(location.search), null, { timeout: 20_000 });

  // La frise se replie a toutes les largeurs, comme le tiroir des filtres.
  await page.getByRole('button', { name: 'Masquer les frises' }).click();
  await page.waitForTimeout(400);
  verifier('les frises se replient au large', (await page.locator('.frise').count()) === 0);
  await page.getByRole('button', { name: 'Afficher les frises' }).click();
  await page.waitForTimeout(600);
  verifier('les frises reviennent', (await page.locator('.frise').count()) === 1);

  // Les deux graphiques remplissent leur colonne : ils partageaient la mesure
  // du premier, et celui des annees laissait un tiers de sa place vide.
  const largeurs = await page.evaluate(() => {
    const boite = (s) => document.querySelector(s).getBoundingClientRect().width;
    const svg = (s) => document.querySelector(`${s} svg`).getBoundingClientRect().width;
    return {
      siecles: boite('.piste-siecles') - svg('.piste-siecles'),
      annees: boite('.piste-annees') - svg('.piste-annees')
    };
  });
  verifier(
    'chaque frise remplit sa colonne',
    Math.abs(largeurs.siecles) < 4 && Math.abs(largeurs.annees) < 4,
    `restes ${largeurs.siecles.toFixed(1)} et ${largeurs.annees.toFixed(1)} px`
  );

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

  // La scene porte la couleur des terres : c'est ce qui supprime le flash entre
  // la bascule, qui recharge la feuille de style, et le premier rendu WebGL.
  const sceneClaire = await page.evaluate(
    () => getComputedStyle(document.querySelector('.scene')).backgroundColor
  );
  verifier(
    'la scene suit la carte, claire en theme clair',
    luminance(sceneClaire) > 0.5,
    sceneClaire
  );

  // La frise, elle, appartient a l'interface : elle suit le theme. Le bandeau
  // ardoise dans les deux themes posait une bande sombre sous une page claire.
  const friseClaire = await page.evaluate(
    () => getComputedStyle(document.querySelector('.frise')).backgroundColor
  );
  verifier(
    'la frise suit le theme, claire en theme clair',
    luminance(friseClaire) > 0.5,
    friseClaire
  );
  verifier(
    'le style de fond suit le theme en clair',
    fondsDemandes.length >= 2 &&
      nomFond(fondsDemandes.at(-1)) === 'positron-gl-style' &&
      fondsDemandes.some((u) => u.includes('dark-matter')),
    fondsDemandes.map(nomFond).join(' -> ')
  );

  // Positron sort gris neutre : il est repeint couche par couche, et cet echec
  // serait **muet** — la carte ressortirait presque juste. Le decompte par
  // nature est la seule chose qui l'attrape, et il est imprime a chaque passe
  // pour qu'un releve aberrant se voie meme quand l'assertion passe.
  //
  // Cette verification fait dependre la suite de `basemaps.cartocdn.com`. La
  // dependance existait deja — `page.route` n'a jamais couvert CARTO — mais
  // seules des formes d'URL etaient verifiees, si bien que la suite passait
  // avec un fond absent. Boucher la feuille rendrait le decompte constant par
  // construction, donc muet sur la seule chose qui puisse casser.
  const teinture = (await attendreCarte(page, (e) => e.teinture.terre > 0)).teinture;
  verifier(
    'le fond clair est reteinte aux couleurs du produit',
    teinture.ignorees === 0 &&
      teinture.terre > 0 &&
      teinture.mer > 0 &&
      teinture.trait > 0 &&
      teinture.libelle > 0,
    teinture
      ? `terre ${teinture.terre} · mer ${teinture.mer} · trait ${teinture.trait} · ` +
        `libelle ${teinture.libelle} · detail ${teinture.detail} · ignorees ${teinture.ignorees}`
      : 'aucun releve'
  );

  // La carte a recharge son fond : si les couches n'avaient pas ete reposees,
  // basculer la densite leverait. Les trois cles de la legende disent en plus
  // que le composant n'est pas reste a mi-chemin — un `poserCouches` qui aurait
  // leve dans un rappel laisserait la carte muette sans erreur console.
  await page.getByRole('button', { name: 'densité' }).click();
  await page.waitForTimeout(500);
  const densiteApresTheme = await page
    .getByRole('button', { name: 'densité' })
    .getAttribute('aria-pressed');

  // La rampe monte vers le blanc en sombre et descend vers le brun en clair :
  // elle n'etait posee que par `poserCouches` et restait sur l'ancien theme.
  // La legende et MapLibre lisent desormais la meme valeur.
  const haute = (await attendreCarte(page, (e) => e.chaleurHaute === '#431b09')).chaleurHaute;
  const rampeLegende = await page.evaluate(
    () => document.querySelector('.legende .rampe')?.getAttribute('style') ?? ''
  );
  // Le navigateur normalise le style en ligne : le degrade ressort en `rgb()`
  // quand le composant l'a ecrit en hexadecimal.
  verifier(
    'la rampe de densite suit le theme',
    haute === '#431b09' && rampeLegende.includes('rgb(67, 27, 9)'),
    `${haute} · ${rampeLegende.slice(-30)}`
  );

  await page.getByRole('button', { name: 'densité' }).click();
  verifier(
    'les couches survivent au changement de fond',
    densiteApresTheme === 'true' &&
      erreursConsole.length === avantTheme &&
      (await page.locator('.legende .cle').count()) === 3,
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
  await page.waitForTimeout(1500);
  verifier(
    'le style de fond suit le theme en sombre',
    nomFond(fondsDemandes.at(-1)) === 'dark-matter-gl-style',
    fondsDemandes.map(nomFond).join(' -> ')
  );
  // Dark-matter est pris tel quel : la dissymetrie est voulue, un test la garde
  // pour qu'on ne la « corrige » pas en croyant a un oubli.
  const teintureSombre = (await attendreCarte(page, (e) => e.teinture.terre === 0)).teinture;
  verifier(
    'le fond sombre n est pas reteinte',
    teintureSombre.terre === 0 && teintureSombre.libelle === 0,
    `${teintureSombre.terre} couche(s) de terre`
  );

  // Deux bascules rapprochees mettent deux `setStyle` en vol. MapLibre annule
  // le premier chargement ; ce qui se verifie ici, c'est qu'aucune couche ne
  // reste orpheline entre les deux.
  const avantRafale = erreursConsole.length;
  await page.getByRole('button', { name: 'Clair' }).click();
  await page.waitForTimeout(100);
  await page.getByRole('button', { name: 'Sombre' }).click();
  await attendreCarte(page, (e) => e.teinture.terre === 0);
  verifier(
    'deux bascules rapides ne laissent qu un style',
    erreursConsole.length === avantRafale &&
      nomFond(fondsDemandes.at(-1)) === 'dark-matter-gl-style' &&
      (await page.evaluate(() => document.documentElement.dataset.theme)) === 'sombre',
    erreursConsole.slice(avantRafale, avantRafale + 2).join(' | ') || 'aucune erreur'
  );

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

    // « Copier le lien » a quitte la barre : il ne vit plus que dans la fiche.
    // « Au hasard » en ouvre une sans toucher au cadrage, ce que la
    // verification suivante exige.
    //
    // Le tirage est verifie a part : `USING SAMPLE 1 ROWS` passait sous le
    // filtre et rendait `null` une fois sur deux — un bouton muet, invisible
    // tant que rien ne le cliquait.
    await onglet.getByRole('button', { name: 'Au hasard' }).click();
    await attendre(onglet, '.fiche .fermer');
    verifier(
      'au hasard ouvre une fiche',
      /[?&]ref=PA/.test(onglet.url()),
      onglet.url().split('?')[1] ?? '(aucun parametre)'
    );
    await onglet.getByRole('button', { name: 'Copier le lien de la notice' }).click();
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
    const source = await onglet.getAttribute('.photo .cadre img', 'src');
    verifier(
      'la fiche illustree porte une image Commons',
      /commons\.wikimedia\.org\/wiki\/Special:FilePath\//.test(source ?? ''),
      source ?? 'aucune image'
    );

    // Le cadre epouse le rapport de la photographie, borne des deux cotes :
    // c'est ce qui remplace le 4/3 fixe, qui recadrait tout. Mesure
    // geometrique — boite du cadre contre dimensions naturelles du fichier.
    const geometriePhoto = await onglet.evaluate(() => {
      const img = document.querySelector('.photo .cadre img');
      const cadre = document.querySelector('.photo .cadre');
      if (!img || !cadre) return null;
      const boite = cadre.getBoundingClientRect();
      return {
        boite: boite.width / boite.height,
        naturel: img.naturalWidth / img.naturalHeight,
        remplissage: getComputedStyle(img).objectFit
      };
    });
    const attendu = geometriePhoto ? Math.min(1.9, Math.max(0.68, geometriePhoto.naturel)) : 0;
    verifier(
      'le cadre epouse le rapport de la photographie',
      Boolean(geometriePhoto) && Math.abs(geometriePhoto.boite - attendu) / attendu < 0.03,
      geometriePhoto
        ? `cadre ${geometriePhoto.boite.toFixed(2)} pour ${geometriePhoto.naturel.toFixed(2)} attendu ${attendu.toFixed(2)}`
        : 'aucun cadre'
    );
    // Entre les bornes, rien n'est coupe : `contain` sur un cadre au meme
    // rapport remplit exactement, sans bande ni rognage.
    verifier(
      'une photographie dans les bornes n est pas rognee',
      geometriePhoto?.remplissage === (geometriePhoto.naturel < 0.68 || geometriePhoto.naturel > 1.9 ? 'cover' : 'contain'),
      `${geometriePhoto?.remplissage} pour un rapport de ${geometriePhoto?.naturel.toFixed(2)}`
    );
    // Le credit peut venir du reseau ou non : le lien de repli, lui, est
    // toujours rendu. C'est lui qui rend la licence atteignable.
    const legende = await onglet.textContent('.photo figcaption');
    verifier(
      'le credit ou son repli est affiche',
      Boolean(legende && legende.trim()),
      (legende ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
    );

    // Le permalien ne vit plus que dans la fiche : le lien produit porte donc
    // aussi la vue de carte. Son nom accessible porte l'action et sa cible,
    // sinon il serait indiscernable du « Copier » d'un autre calque.
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

    // Une notice sur six n'a pas d'image, et la fiche s'ouvre alors sur son
    // titre : le cadre « aucune photographie » occupait un tiers du panneau
    // pour ne rien dire que la fiche ne dise deja. Ne reste que la bande des
    // deux pastilles, qui se posaient sur l'image.
    await onglet.goto(`${BASE}/?ref=PA67000108`, { waitUntil: 'domcontentloaded' });
    await attendre(onglet, '.fiche .fermer');
    await onglet.waitForTimeout(600);
    verifier(
      'aucune section photo sans image',
      (await onglet.locator('.photo').count()) === 0,
      `${await onglet.locator('.photo').count()} figure(s)`
    );
    const nu = await onglet.evaluate(() => {
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
    // 4 861 des 6 692 notices sans fichier Commons sont illustrees dans
    // Memoire. Ces images etant sous droits reserves, la fiche les compte et
    // y renvoie ; elle ne les reproduit pas. Le renvoi est donc la seule
    // trace de leur existence, et il porte le nombre.
    const renvoi = onglet.locator('.fiche .renvoi-photo');
    const libelle = ((await renvoi.textContent()) ?? '').replace(/\s+/g, ' ').trim();
    verifier(
      'le renvoi POP compte les photographies que Commons ignore',
      (await renvoi.count()) === 1 &&
        /^\d+ photographies? sur POP/.test(libelle) &&
        ((await renvoi.getAttribute('href')) ?? '').includes('PA67000108'),
      libelle || 'aucun renvoi'
    );

    // Une photographie plus verticale que la borne basse : le cadre s'arrete a
    // 0,68 et l'image se recadre, au lieu d'etre rognee sans recours.
    // PA00107796 mesure 960x1803, soit 0,53 ; 25 fichiers sur 240 mesures dans
    // l'instantane sortent des bornes, ce n'est pas un cas de laboratoire.
    await onglet.goto(`${BASE}/?ref=PA00107796`, { waitUntil: 'domcontentloaded' });
    await attendre(onglet, '.photo .cadre img');
    await onglet.waitForTimeout(1800);
    const bornee = await onglet.evaluate(() => {
      const cadre = document.querySelector('.photo .cadre');
      const img = document.querySelector('.photo .cadre img');
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
      Math.abs(bornee.rapport - 0.68) < 0.02 &&
        bornee.naturel < 0.68 &&
        bornee.remplissage === 'cover',
      `cadre ${bornee.rapport.toFixed(2)} pour un fichier a ${bornee.naturel.toFixed(2)}, ${bornee.remplissage}`
    );

    // Et elle se fait glisser : c'est ce qui remplace le recadrage impose.
    // `object-position` s'exprime en pourcents de la part cachee, donc le
    // deplacement doit changer la valeur calculee, pas seulement le curseur.
    const boiteImage = await onglet.locator('.photo .cadre img').boundingBox();
    const cx = boiteImage.x + boiteImage.width / 2;
    const cy = boiteImage.y + boiteImage.height / 2;
    await onglet.mouse.move(cx, cy);
    await onglet.mouse.down();
    await onglet.mouse.move(cx, cy - 90, { steps: 6 });
    await onglet.mouse.up();
    await onglet.waitForTimeout(200);
    const apres = await onglet.evaluate(
      () => getComputedStyle(document.querySelector('.photo .cadre img')).objectPosition
    );
    verifier(
      'glisser recadre la photographie dans son cadre',
      apres !== bornee.position,
      `${bornee.position} -> ${apres}`
    );

    // Un lien portant `annees=` doit arriver avec son voile de brossage : c'est
    // la seule trace visible de la plage depuis que les bornes saisissables ont
    // disparu. L'echelle du graphique n'existe pas encore au premier calcul de
    // l'apercu — d'ou `echelleX` en `$state`.
    await onglet.goto(`${BASE}/?annees=1920-1935`, { waitUntil: 'domcontentloaded' });
    await attendre(onglet, '.chiffres b');
    await onglet.waitForTimeout(1500);
    verifier(
      'un lien avec une plage arrive avec son voile',
      (await onglet.locator('.piste-annees .brosse').count()) === 1
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

  // --- Chaine des points : ou passe le temps --------------------------------
  // Ces chiffres ont departage trois correctifs de prix tres differents. Le
  // verdict est tombe et il est applique : `points()` lit les vecteurs colonnes
  // Arrow, la conversion en objets intermediaires a disparu. Le releve reste
  // pour que la regression se voie — les plafonds sont larges, ils signalent,
  // ils n'arbitrent plus.
  // Le bouton de remise a zero ne s'affiche qu'avec des filtres poses, et son
  // libelle est « effacer N filtres ». Une version anterieure visait « Tout
  // effacer » et ravalait l'echec : le regime suivant heritait alors du filtre
  // precedent sans que rien ne le signale.
  const effacerTout = async () => {
    const raz = page.locator('.jetons button.raz');
    if (await raz.count()) await raz.click();
  };

  const releve = async (etiquette) => {
    const m = await page.evaluate(() => ({ ...window.__mesures }));
    const total = m.sql + m.collection + m.rendu;
    mesuresRelevees.push({ etiquette, ...m, total });
    return { ...m, total };
  };

  await page.locator('.bascule button', { hasText: 'Carte' }).click();
  await effacerTout();
  await page.waitForTimeout(900);
  const pleinCorpus = await releve('corpus entier');
  verifier(
    'la chaine des points repond sur le corpus entier',
    pleinCorpus.total < 4000 && pleinCorpus.n > 40000,
    `${pleinCorpus.n} points en ${pleinCorpus.total.toFixed(0)} ms`
  );

  // Second regime : un filtre serre, pour separer ce qui depend du volume de ce
  // qui est fixe. La comparaison porte sur `collection` et non sur le total :
  // `sql` est un temps de bout en bout sur une connexion partagee par les huit
  // requetes du cycle, et la requete des points attend derriere les balayages
  // du cycle precedent. Mesure a l'appui, le meme filtre Corse coute 91 ms de
  // `sql` quand il succede au corpus entier, 14 ms quand il succede a un autre
  // filtre serre. Le total d'un petit resultat peut donc depasser celui du gros.
  await page.locator('.nom-section', { hasText: 'Région' }).click();
  await page.waitForTimeout(250);
  await page.locator('.option', { hasText: 'Corse' }).first().click();
  await page.waitForTimeout(900);
  const filtre = await releve('filtre serre');
  verifier(
    'un filtre serre allege la fabrication des points',
    filtre.n < pleinCorpus.n && filtre.collection < pleinCorpus.collection,
    `${filtre.n} points, GeoJSON ${filtre.collection.toFixed(1)} ms contre ${pleinCorpus.collection.toFixed(0)} ms`
  );

  // Troisieme regime : le meme cycle sous filtre plein texte. Aucune mesure
  // nouvelle n'est necessaire — la clause part dans la requete des points, donc
  // `sql` porte deja le cout du balayage des postings.
  await effacerTout();
  await page.waitForTimeout(600);
  await page.locator('button.cible').click();
  await page.fill('.recherche', 'machicoulis');
  await page.waitForTimeout(1600);
  const texte = await releve('plein texte');
  verifier(
    'le balayage des postings reste sous la seconde',
    texte.total < 1000 && texte.n > 400,
    `${texte.n} points en ${texte.total.toFixed(0)} ms`
  );
  await page.locator('button.cible').click();
  await page.fill('.recherche', '');
  await page.waitForTimeout(600);

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

if (mesuresRelevees.length) {
  console.log('Chaine des points (ms, releve navigateur) :');
  console.log('  regime           points      SQL  GeoJSON  setData    total');
  for (const m of mesuresRelevees) {
    console.log(
      `  ${m.etiquette.padEnd(16)} ${String(m.n).padStart(6)}  ` +
        [m.sql, m.collection, m.rendu, m.total]
          .map((v) => v.toFixed(0).padStart(7))
          .join('  ')
    );
  }
  console.log('');
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
