/**
 * Audit visuel et accessibilite : captures + releves chiffres.
 *
 * `smoke.mjs` verifie 127 comportements, mais aucune de ses verifications ne
 * juge le **rendu** : un texte peut passer sous 4,5:1, un panneau en recouvrir
 * un autre, une cible tomber a 26 px, sans qu'aucune ne bouge. Ce script
 * produit la matiere de cet audit-la — un PNG et un JSON par etat.
 *
 * Contrairement a `smoke.mjs`, **il laisse partir les requetes CARTO et
 * Geoplateforme**. La regle « ce depot tient ses tests hors reseau » vise la
 * suite de tests, qui doit rester deterministe ; un audit de rendu qui
 * boucherait Cassini par un PNG 1x1 transparent ne montrerait rien de ce qu'il
 * pretend juger. Ce script n'est pas branche sur `npm run test`.
 *
 * Usage : npm run audit   (exige un `npm run build` prealable)
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { demarrer } from './serveur.mjs';

const chemin = (u) => new URL(u, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SORTIE = chemin('../.audit-screenshots');
const RELEVES = `${SORTIE}/releves`;

rmSync(SORTIE, { recursive: true, force: true });
mkdirSync(RELEVES, { recursive: true });

// Port distinct de celui de `smoke.mjs` : les deux doivent pouvoir tourner cote a cote.
const { serveur, url: BASE } = await demarrer(chemin('../build'), 4181);

// `AUDIT_GABARITS` et `AUDIT_THEMES` restreignent la passe — utiles pour
// eprouver un geste sans repayer 112 captures.
const seulement = (nom, tous) => {
  const v = process.env[nom];
  return v ? tous.filter((t) => v.split(',').includes(t.cle ?? t)) : tous;
};

const VIEWPORTS = seulement('AUDIT_GABARITS', [
  { cle: 'mobile', width: 390, height: 844 },
  { cle: 'tablette', width: 768, height: 1024 },
  { cle: 'bureau', width: 1440, height: 900 },
  { cle: 'large', width: 1920, height: 1080 }
]);
const THEMES = seulement('AUDIT_THEMES', ['sombre', 'clair']);

// Deux notices fixes plutot que le bouton « Au hasard » : une notice tiree au
// sort changerait d'une passe a l'autre, et deux passes ne seraient plus
// comparables. PA00080780 porte une photographie, 264 objets Palissy et un
// titre long ; PA48000036 n'a aucun fichier Commons mais 272 illustrations
// Memoire, donc la fiche s'ouvre sur son titre et montre le renvoi POP.
const REF_AVEC_PHOTO = 'PA00080780';
const REF_SANS_PHOTO = 'PA48000036';

const attendre = (page, selecteur, timeout = 45_000) => page.waitForSelector(selecteur, { timeout });

async function ouvrirFiltres(page) {
  if ((await page.locator('.facettes.ouvert').count()) === 1) return;
  await page.getByRole('button', { name: /^Filtres/ }).click();
  await attendre(page, '.facettes.ouvert .option', 20_000);
  await page.waitForTimeout(400);
}

async function ouvrirFrises(page) {
  if ((await page.locator('.frise').count()) === 1) return;
  await page.getByRole('button', { name: 'Afficher les frises' }).click();
  await attendre(page, '.piste-siecles svg', 20_000);
  await page.waitForTimeout(600);
}

async function effacerFiltres(page) {
  const raz = page.getByRole('button', { name: /effacer \d+ filtres?/ });
  if ((await raz.count()) === 0) return;
  await raz.click();
  await page.waitForFunction(
    () => {
      const el = document.querySelector('.chiffres span b');
      return el && el.textContent.replace(/\D/g, '') === '46760';
    },
    null,
    { timeout: 25_000 }
  );
}

/**
 * Ramene l'application a son etat d'arrivee sans rechargement.
 *
 * Un `goto` couterait un reamorcage DuckDB par etat ; le defaire geste par
 * geste est le seul chemin tenable sur 112 captures. L'ordre compte : la fiche
 * d'abord (elle referme le tiroir derriere elle sur gabarit etroit), les
 * filtres ensuite, les calques en dernier.
 */
async function raz(page) {
  if ((await page.locator('.fiche .fermer').count()) === 1) {
    await page.locator('.fiche .fermer').click();
    await page.waitForTimeout(250);
  }
  const champ = page.locator('.recherche');
  if ((await champ.count()) === 1 && (await champ.inputValue()) !== '') {
    await champ.fill('');
    await page.waitForTimeout(400);
  }
  if ((await page.locator('button.cible.actif').count()) === 1) {
    await page.locator('button.cible').click();
    await page.waitForTimeout(300);
  }
  await effacerFiltres(page);
  if ((await page.locator('.facettes.ouvert').count()) === 1) {
    await page.locator('.fermer-tiroir').click();
    await page.waitForTimeout(250);
  }
  if ((await page.locator('.frise').count()) === 1) {
    await page.getByRole('button', { name: 'Masquer les frises' }).click();
    await page.waitForTimeout(300);
  }
  for (const nom of ['Cassini', 'État-major']) {
    const b = page.locator('.fonds > button', { hasText: nom }).first();
    if ((await b.count()) === 1 && ((await b.getAttribute('class')) ?? '').includes('actif')) {
      await b.click();
      await page.waitForTimeout(400);
    }
  }
  if ((await page.locator('.fonds').count()) === 1) {
    await page
      .locator('.fonds .fermer')
      .first()
      .click()
      .catch(() => {});
    await page.waitForTimeout(250);
  }
  const densite = page.getByRole('button', { name: 'densité' });
  if ((await densite.count()) === 1 && ((await densite.getAttribute('class')) ?? '').includes('actif')) {
    await densite.click();
    await page.waitForTimeout(500);
  }
  const carte = page.locator('.bascule button', { hasText: 'Carte' });
  if ((await carte.count()) === 1) {
    await carte.click();
    await page.waitForTimeout(500);
  }
}

const ETATS = [
  { cle: 'defaut', vue: 'carte', poser: async () => {} },

  { cle: 'tiroir-filtres', vue: 'carte', poser: ouvrirFiltres },

  {
    cle: 'facette-depliee',
    vue: 'carte',
    poser: async (page) => {
      await ouvrirFiltres(page);
      const section = page.locator('section:has(.nom-section:text("Architecte"))');
      await section.locator('button.titre').click();
      await section.locator('input.filtre').fill('baltard');
      await page.waitForTimeout(900);
    }
  },

  {
    // Le tiroir est referme apres coup : ce qu'on veut voir, c'est la bande de
    // puces posee sur la carte, et la hauteur qu'elle prend a la scene.
    cle: 'filtres-actifs',
    vue: 'carte',
    poser: async (page) => {
      await ouvrirFiltres(page);
      await page.getByRole('button', { name: 'architecture militaire' }).click();
      await page.waitForTimeout(800);
      const statut = page.locator('section:has(.nom-section:text("Statut"))');
      await statut
        .getByRole('button', { name: /^classé / })
        .first()
        .click();
      await page.waitForTimeout(800);
      await page.locator('.fermer-tiroir').click();
      await page.waitForTimeout(500);
    }
  },

  { cle: 'frise', vue: 'carte', poser: ouvrirFrises },

  {
    cle: 'frise-brossee',
    vue: 'carte',
    poser: async (page) => {
      await ouvrirFrises(page);
      const piste = await page.locator('.piste-annees').boundingBox();
      await page.mouse.move(piste.x + piste.width * 0.45, piste.y + piste.height * 0.55);
      await page.mouse.down();
      await page.mouse.move(piste.x + piste.width * 0.72, piste.y + piste.height * 0.55, { steps: 12 });
      await page.mouse.up();
      await page.waitForTimeout(1400);
    }
  },

  {
    cle: 'fonds-anciens',
    vue: 'carte',
    poser: async (page) => {
      await page.locator('button.ouvrir-fonds').click();
      await page.waitForTimeout(400);
      await page.getByRole('button', { name: 'Cassini' }).click();
      const dosage = page.getByRole('slider', { name: /Opacité du fond/ });
      await dosage.fill('55');
      await page.waitForTimeout(3000);
    }
  },

  {
    cle: 'densite',
    vue: 'carte',
    poser: async (page) => {
      await page.getByRole('button', { name: 'densité' }).click();
      await page.waitForTimeout(1400);
    }
  },

  {
    cle: 'fiche',
    vue: 'carte',
    poser: async (page) => {
      await page.goto(`${BASE}/?ref=${REF_AVEC_PHOTO}`, { waitUntil: 'domcontentloaded' });
      await attendre(page, '.fiche .fermer');
      await page.waitForTimeout(3000);
    }
  },

  {
    cle: 'fiche-sans-photo',
    vue: 'carte',
    poser: async (page) => {
      await page.goto(`${BASE}/?ref=${REF_SANS_PHOTO}`, { waitUntil: 'domcontentloaded' });
      await attendre(page, '.fiche .fermer');
      await page.waitForTimeout(2500);
    }
  },

  {
    cle: 'defaut',
    vue: 'liste',
    poser: async (page) => {
      await page.locator('.bascule button', { hasText: 'Liste' }).click();
      await attendre(page, '.liste header p');
      await page.waitForTimeout(900);
    }
  },

  {
    cle: 'scroll-mi-page',
    vue: 'liste',
    poser: async (page) => {
      await page.locator('.bascule button', { hasText: 'Liste' }).click();
      await attendre(page, '.liste header p');
      await page.waitForTimeout(900);
      await page.evaluate(() => {
        // La scene fait 100dvh : rien ne defile au niveau du document, c'est le
        // conteneur de la liste qui porte le defilement.
        const boites = [...document.querySelectorAll('.liste, .liste *')].filter(
          (n) => n.scrollHeight > n.clientHeight + 40
        );
        const boite = boites[0];
        if (boite) boite.scrollTop = Math.round(boite.scrollHeight / 2);
      });
      await page.waitForTimeout(600);
    }
  },

  {
    cle: 'recherche-historiques',
    vue: 'liste',
    poser: async (page) => {
      await page.locator('.bascule button', { hasText: 'Liste' }).click();
      await attendre(page, '.liste header p');
      await page.locator('button.cible').click();
      await page.fill('.recherche', 'jubé');
      await page.waitForTimeout(3500);
    }
  },

  {
    cle: 'defaut',
    vue: 'matrice',
    poser: async (page) => {
      await page.locator('.bascule button', { hasText: 'Matrice' }).click();
      await attendre(page, '.matrice svg', 25_000);
      await page.waitForTimeout(1200);
    }
  }
];

/**
 * Releve chiffre, lu dans la page.
 *
 * Un ratio de contraste ne se juge pas a l'oeil, et une cible de 41 px ne se
 * distingue pas d'une cible de 44. Ce que la capture montre, ce releve le
 * mesure. Limite connue : un texte pose **sur le canevas WebGL** n'a pas de
 * fond CSS — la remontee des ancetres rend alors le fond de la scene, ce qui
 * approche la couleur de la carte sans la lire. L'attribution MapLibre est
 * dans ce cas ; la legende et le bouton « Filtres » ont leur propre surface.
 */
const RELEVE = () => {
  const lum = ([r, g, b]) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const l1 = lum(a);
    const l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const couleur = (s) => {
    const m = /rgba?\(([^)]+)\)/.exec(s || '');
    if (!m) return null;
    const p = m[1]
      .split(/[,\s/]+/)
      .filter(Boolean)
      .map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const composer = (av, ar) => [
    av.r * av.a + ar[0] * (1 - av.a),
    av.g * av.a + ar[1] * (1 - av.a),
    av.b * av.a + ar[2] * (1 - av.a)
  ];
  const fondEffectif = (el) => {
    const pile = [];
    let n = el;
    while (n && n.nodeType === 1) {
      const c = couleur(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) {
        pile.push(c);
        if (c.a >= 1) break;
      }
      n = n.parentElement;
    }
    if (!pile.length || pile[pile.length - 1].a < 1) pile.push({ r: 255, g: 255, b: 255, a: 1 });
    const base = pile[pile.length - 1];
    let fond = [base.r, base.g, base.b];
    for (let i = pile.length - 2; i >= 0; i--) fond = composer(pile[i], fond);
    return fond;
  };
  const nommer = (el) => {
    const classes = [...el.classList]
      .slice(0, 3)
      .map((c) => `.${c}`)
      .join('');
    const texte = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 34);
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${classes}${texte ? ` « ${texte} »` : ''}`;
  };
  const boite = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };

  /**
   * Ce que le doigt touche, et non ce que l'oeil voit.
   *
   * Deux ecarts entre la pilule et sa cible reelle, et les deux comptent pour
   * WCAG 2.5.5 : une zone de frappe posee en `::after` (`.frappe-44` dans
   * `app.css`), invisible a `getBoundingClientRect` ; et une case a cocher
   * enveloppee d'un `<label>`, qui recoit le clic a sa place. Sans cette
   * fonction, le releve continuerait a signaler 19 px la ou le doigt en a 44.
   */
  const zoneFrappe = (el) => {
    let { w, h } = boite(el);
    const apres = getComputedStyle(el, '::after');
    if (apres && apres.content !== 'none' && apres.position === 'absolute') {
      const pw = Number.parseFloat(apres.width);
      const ph = Number.parseFloat(apres.height);
      if (Number.isFinite(pw)) w = Math.max(w, Math.round(pw));
      if (Number.isFinite(ph)) h = Math.max(h, Math.round(ph));
    }
    if (el.tagName === 'INPUT' && el.type === 'checkbox') {
      const label = el.closest('label');
      if (label) {
        const lb = boite(label);
        w = Math.max(w, lb.w);
        h = Math.max(h, lb.h);
      }
    }
    return { w, h };
  };
  const visible = (el) => {
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) < 0.06) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  };

  const largeur = document.documentElement.clientWidth;
  const tous = [...document.querySelectorAll('body *')].filter(visible);

  // --- Contrastes -----------------------------------------------------------
  const contrastes = [];
  for (const el of tous) {
    const propre = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
    if (!propre) continue;
    const s = getComputedStyle(el);
    const avant = couleur(s.color);
    if (!avant || avant.a === 0) continue;
    const arriere = fondEffectif(el);
    const texte = avant.a < 1 ? composer(avant, arriere) : [avant.r, avant.g, avant.b];
    const taille = Number.parseFloat(s.fontSize);
    const graisse = Number.parseInt(s.fontWeight, 10) || 400;
    const grand = taille >= 24 || (taille >= 18.66 && graisse >= 700);
    const seuil = grand ? 3 : 4.5;
    const r = ratio(texte, arriere);
    if (r < seuil) {
      contrastes.push({
        cible: nommer(el),
        ratio: Number(r.toFixed(2)),
        seuil,
        taille,
        graisse,
        texte: `rgb(${texte.map((v) => Math.round(v)).join(',')})`,
        fond: `rgb(${arriere.map((v) => Math.round(v)).join(',')})`,
        boite: boite(el)
      });
    }
  }

  // --- Cibles tactiles ------------------------------------------------------
  const SEL_INTERACTIF =
    'button, a[href], input, select, textarea, [role=button], [role=checkbox], [role=slider], [role=tab], [tabindex]:not([tabindex="-1"])';
  const interactifs = [...document.querySelectorAll(SEL_INTERACTIF)].filter(visible);
  const cibles = interactifs
    .map((el) => {
      const vue = boite(el);
      const frappe = zoneFrappe(el);
      return {
        cible: nommer(el),
        ...vue,
        // `w`/`h` restent la boite visible ; `frappe` est ce qui repond au
        // doigt. Les deux sont publiees : un ecart entre elles est voulu.
        frappe: `${frappe.w}x${frappe.h}`,
        frappeW: frappe.w,
        frappeH: frappe.h
      };
    })
    .filter((c) => c.frappeW < 44 || c.frappeH < 44)
    .sort((a, b) => a.frappeW * a.frappeH - b.frappeW * b.frappeH);

  // --- Debordement horizontal ----------------------------------------------
  const coupables = tous
    .filter((el) => el.getBoundingClientRect().right > largeur + 1)
    .map((el) => ({ cible: nommer(el), ...boite(el) }));

  // --- Clipping -------------------------------------------------------------
  const clipping = tous
    .filter((el) => {
      const s = getComputedStyle(el);
      const coupe = s.overflowX === 'hidden' || s.textOverflow === 'ellipsis';
      return coupe && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0;
    })
    .map((el) => ({ cible: nommer(el), visible: el.clientWidth, reel: el.scrollWidth }));

  // --- Chevauchements -------------------------------------------------------
  const PANNEAUX =
    '.legende, .fonds, .fiche, .facettes, .jetons, .frise, .bascule, .chiffres, .marque, .centre-barre, .liste, .matrice, .maplibregl-ctrl-bottom-right, .maplibregl-ctrl-bottom-left, .maplibregl-ctrl-top-right, .scene > button.filtres, .renvoi-photo';
  const candidats = [
    ...new Set([...interactifs, ...[...document.querySelectorAll(PANNEAUX)].filter(visible)])
  ].slice(0, 140);
  const chevauchements = [];
  for (let i = 0; i < candidats.length; i++) {
    for (let j = i + 1; j < candidats.length; j++) {
      const a = candidats[i];
      const b = candidats[j];
      if (a.contains(b) || b.contains(a)) continue;
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const l = Math.max(0, Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left));
      const h = Math.max(0, Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top));
      if (l * h < 9) continue;
      chevauchements.push({
        a: nommer(a),
        b: nommer(b),
        aire: Math.round(l * h),
        zA: getComputedStyle(a).zIndex,
        zB: getComputedStyle(b).zIndex
      });
    }
  }

  return {
    viewport: { w: innerWidth, h: innerHeight },
    theme: document.documentElement.getAttribute('data-theme'),
    url: location.href,
    total: document.querySelector('.chiffres span b')?.textContent ?? '',
    debordement: {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: largeur,
      deborde: document.documentElement.scrollWidth > largeur + 1,
      coupables: coupables.slice(0, 30)
    },
    cibles: cibles.slice(0, 40),
    contrastes: contrastes.sort((a, b) => a.ratio - b.ratio).slice(0, 40),
    clipping: clipping.slice(0, 30),
    chevauchements: chevauchements.sort((a, b) => b.aire - a.aire).slice(0, 30),
    carte: window.__carte ? { teinture: { ...window.__carte.teinture } } : null
  };
};

let captures = 0;
const journal = [];
const t0 = Date.now();
const navigateur = await chromium.launch();

try {
  for (const vp of VIEWPORTS) {
    // Chromium sans tete annonce `prefers-color-scheme: light` : on demarre en
    // sombre pour avoir quelque chose a basculer, et la bascule passe par le
    // **bouton de la page** — un seul amorcage DuckDB par gabarit au lieu de
    // deux, et c'est le vrai chemin, `setStyle` compris.
    const contexte = await navigateur.newContext({
      viewport: { width: vp.width, height: vp.height },
      colorScheme: 'dark',
      deviceScaleFactor: 1
    });
    const page = await contexte.newPage();
    const erreurs = [];
    page.on('console', (m) => m.type() === 'error' && erreurs.push(m.text()));
    page.on('pageerror', (e) => erreurs.push(String(e)));

    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await attendre(page, '.chiffres b', 90_000);
    await page.waitForTimeout(2500);

    for (const theme of THEMES) {
      if (theme === 'clair') {
        try {
          await raz(page);
          // `data-theme` porte les valeurs du produit — `clair` / `sombre` —, pas
          // celles de la specification CSS.
          await page.getByRole('button', { name: 'Clair' }).click();
          await page.waitForFunction(() => document.documentElement.dataset.theme === 'clair', null, {
            timeout: 20_000
          });
          await page.waitForTimeout(3000);
        } catch (e) {
          // Une bascule ratee ne doit pas emporter les gabarits suivants : le
          // journal le dit et la passe continue.
          journal.push(`${vp.cle} — BASCULE CLAIR ECHOUEE : ${String(e).split('\n')[0]}`);
          continue;
        }
      }

      for (const etat of ETATS) {
        const nom = `${etat.vue}_${vp.cle}_${theme}_${etat.cle}`;
        const marque = erreurs.length;
        try {
          await raz(page);
          await etat.poser(page);
          // Le pointeur reste ou le dernier geste l'a laisse, et un `:hover`
          // fige teinte la capture **et** le releve. La premiere passe a ainsi
          // fait conclure a quatre lecteurs qu'un jeton de couleur etait faux,
          // alors que c'etait le survol qui ecrasait la regle. On l'ecarte donc
          // avant chaque capture, dans le coin de la marque, qui n'est pas une
          // commande.
          await page.mouse.move(2, 2);
          await page.waitForTimeout(etat.vue === 'carte' ? 1100 : 500);
          await page.screenshot({ path: `${SORTIE}/${nom}.png` });
          const releve = await page.evaluate(RELEVE);
          releve.capture = `${nom}.png`;
          releve.erreursConsole = erreurs.slice(marque);
          writeFileSync(`${RELEVES}/${nom}.json`, JSON.stringify(releve, null, 2));
          captures += 1;
          // Une capture prise dans le mauvais theme est le mode d'echec le plus
          // silencieux de cette passe : elle est belle et elle est fausse.
          if (releve.theme !== theme) journal.push(`${nom} — THEME INATTENDU : ${releve.theme}`);
          journal.push(
            `${nom} — ${releve.debordement.deborde ? 'DEBORDE ' : ''}${releve.contrastes.length} contraste(s), ` +
              `${releve.cibles.length} cible(s) < 44, ${releve.chevauchements.length} chevauchement(s)`
          );
        } catch (e) {
          journal.push(`${nom} — ECHEC : ${String(e).split('\n')[0]}`);
          await page.screenshot({ path: `${SORTIE}/${nom}.ECHEC.png` }).catch(() => {});
        }
      }
    }
    await contexte.close();
    console.log(`${vp.cle} : ${captures} captures cumulees`);
  }
} finally {
  await navigateur.close();
  serveur.close();
}

writeFileSync(`${SORTIE}/journal.txt`, journal.join('\n'));
console.log(journal.join('\n'));
console.log(`\n${captures} captures ecrites dans .audit-screenshots/ en ${Math.round((Date.now() - t0) / 1000)} s`);
