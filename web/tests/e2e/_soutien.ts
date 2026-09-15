/**
 * Utilitaires partages entre les fichiers de la suite e2e.
 *
 * Chaque fichier de tests/e2e/ demarre et arrete son propre serveur statique
 * (tests/serveur.mjs, API inchangee) : les compteurs d'octets sont donc
 * isoles par fichier sans qu'aucune remise a zero ne soit necessaire. Le
 * navigateur, lui, est le `browser` de worker Playwright (un seul worker,
 * partage entre tous les fichiers) ; chaque fichier ouvre son propre contexte
 * pour qu'une exception n'emporte pas les verifications des autres.
 */
import { expect, type Page } from '@playwright/test';
import type { Server } from 'node:http';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { demarrer as demarrerServeur } from '../serveur.mjs';

export interface InfosServeur {
  serveur: Server;
  octets: Map<string, number>;
  journal: string[];
  url: string;
}

/** Racine du build statique, meme calcul que l'ancien smoke.mjs — la
 *  conversion d'URL en chemin gere le prefixe `/C:` que Windows ajoute. */
export function cheminBuild(): string {
  return new URL('../../build', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
}

export async function demarrer(port?: number): Promise<InfosServeur> {
  return (await demarrerServeur(cheminBuild(), port)) as InfosServeur;
}

/** Ferme proprement le serveur : le port doit etre libre avant que le fichier
 *  suivant demarre le sien, un seul worker les executant en serie. */
export function fermerServeur(serveur: Server): Promise<void> {
  return new Promise((resoudre) => serveur.close(() => resoudre()));
}

/**
 * Meme 1 pour 1 que l'ancien `verifier()` de smoke.mjs, mais adosse a
 * `expect.soft` : l'echec est enregistre sans interrompre le test, comme le
 * faisait le tableau `resultats` original, et Playwright l'imprime avec son
 * propre compte-rendu.
 */
export function verifier(libelle: string, condition: unknown, detail = ''): void {
  const message = detail ? `${libelle} — ${detail}` : libelle;
  expect.soft(Boolean(condition), message).toBe(true);
}

/**
 * `.chiffres b` est le signal de demarrage de toute la suite. Depuis
 * `points.json`, un compte **provisoire** s'y pose avant que DuckDB soit pret :
 * sur ce selecteur on attend donc aussi que la pastille d'amorcage soit partie,
 * sinon un test brosse une frise ou lit un releve sans moteur derriere. Le
 * compte provisoire lui-meme est eprouve a part, dans `09-mobile.spec.ts`.
 */
export async function attendre(page: Page, selecteur: string, timeout = 45_000) {
  const element = await page.waitForSelector(selecteur, { timeout });
  if (selecteur === '.chiffres b') {
    await page.waitForFunction(() => !document.querySelector('.amorce-discrete'), undefined, { timeout });
  }
  return element;
}

/** Le tiroir des filtres est referme au chargement, et chaque navigation le
 *  referme a nouveau : on l'ouvre la ou on lit son contenu. */
export async function ouvrirFiltres(page: Page): Promise<void> {
  if ((await page.locator('.facettes.ouvert').count()) === 1) return;
  await page.getByRole('button', { name: /^Filtres/ }).click();
  await attendre(page, '.facettes.ouvert .option', 20_000);
  await page.waitForTimeout(300);
}

/** La frise est repliee au chargement : on la rouvre la ou on s'en sert. */
export async function ouvrirFrises(page: Page): Promise<void> {
  if ((await page.locator('.frise').count()) === 1) return;
  await page.getByRole('button', { name: 'Afficher les frises' }).click();
  await attendre(page, '.piste-siecles svg', 20_000);
  await page.waitForTimeout(400);
}

export async function total(page: Page): Promise<number> {
  const texte = await page.textContent('.chiffres span b');
  return Number.parseInt((texte ?? '').replace(/\D/g, ''), 10);
}

export function attendreTotal(page: Page, attendu: number) {
  return page.waitForFunction(
    (n) => {
      const el = document.querySelector('.chiffres span b');
      return el && el.textContent?.replace(/\D/g, '') === String(n);
    },
    attendu,
    { timeout: 30_000 }
  );
}

interface Teinture {
  terre: number;
  mer: number;
  trait: number;
  libelle: number;
  detail: number;
  ignorees: number;
}
interface EtatCarteReleve {
  teinture: Teinture;
  chaleurHaute: string;
}
const TEINTURE_VIDE: Teinture = { terre: 0, mer: 0, trait: 0, libelle: 0, detail: 0, ignorees: 0 };

/**
 * Attend que la carte ait effectivement repose ses couches. Un delai fixe
 * serait un pari sur le reseau (feuille CARTO, ~107 Ko) : on relit
 * `window.__carte` jusqu'a ce que le predicat passe, et on rend le dernier
 * releve dans tous les cas — c'est a la verification de trancher.
 */
export async function attendreCarte(
  page: Page,
  predicat: (etat: EtatCarteReleve) => boolean,
  limite = 15_000
): Promise<EtatCarteReleve> {
  const lire = (): Promise<EtatCarteReleve | null> =>
    page.evaluate(() => {
      const c = (window as unknown as { __carte?: EtatCarteReleve }).__carte;
      return c ? { teinture: { ...c.teinture }, chaleurHaute: c.chaleurHaute } : null;
    });
  const t0 = Date.now();
  let etat = await lire();
  while (Date.now() - t0 < limite && !(etat && predicat(etat))) {
    await page.waitForTimeout(200);
    etat = await lire();
  }
  return etat ?? { teinture: { ...TEINTURE_VIDE }, chaleurHaute: '' };
}

export const nomFond = (u: string): string => u.split('/gl/')[1]?.split('/')[0] ?? '';

export function luminance(couleur: string): number {
  const [r, v, b] = (couleur.match(/\d+/g) ?? ['0', '0', '0']).slice(0, 3).map(Number);
  const lin = [r, v, b]
    .map((c) => c / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

export function contraste(l1: number, l2: number): number {
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

interface Boite {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Deux boites ne se recouvrent pas. Meme methode geometrique que le test
 *  attribution/legende original, reutilisee partout ou deux surfaces posees
 *  sur la carte ne doivent pas se chevaucher. */
/**
 * Attend qu'une image ait fini de charger, plutot que de mesurer son rapport
 * naturel trop tot — c'est ce qui rendait « cadre 1.33 pour NaN » : le
 * rapport naturel etait lu avant que l'image Commons ne soit arrivee. Rend
 * `false` si elle ne charge pas du tout (reseau Commons indisponible) : la
 * verification appelante doit alors le dire clairement, jamais produire NaN.
 */
export async function attendreImageChargee(page: Page, selecteur: string, timeout = 15_000): Promise<boolean> {
  try {
    await page.waitForFunction(
      (sel) => {
        const img = document.querySelector(sel);
        return img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0;
      },
      selecteur,
      { timeout }
    );
    return true;
  } catch {
    return false;
  }
}

export function disjointes(a: Boite, b: Boite): boolean {
  return a.x >= b.x + b.width || b.x >= a.x + a.width || a.y >= b.y + b.height || b.y >= a.y + a.height;
}

/** PNG 1x1 transparent : suffit a MapLibre pour une tuile IGN interceptee. */
export const PNG_VIDE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

/** Le bouton de remise a zero ne s'affiche qu'avec des filtres poses. */
export async function effacerTout(page: Page): Promise<void> {
  const raz = page.locator('.jetons button.raz');
  if (await raz.count()) await raz.click();
}

interface MesuresPoints {
  n: number;
  sql: number;
  collection: number;
  rendu: number;
}
export interface Releve extends MesuresPoints {
  etiquette: string;
  total: number;
}

export async function releve(page: Page, etiquette: string): Promise<Releve> {
  const m = await page.evaluate(
    () => ({ ...(window as unknown as { __mesures: MesuresPoints }).__mesures })
  );
  const t = m.sql + m.collection + m.rendu;
  return { etiquette, ...m, total: t };
}

export function imprimerReleves(mesures: Releve[]): void {
  if (!mesures.length) return;
  console.log('Chaine des points (ms, releve navigateur) :');
  console.log('  regime           points      SQL  GeoJSON  setData    total');
  for (const m of mesures) {
    console.log(
      `  ${m.etiquette.padEnd(16)} ${String(m.n).padStart(6)}  ` +
        [m.sql, m.collection, m.rendu, m.total].map((v) => v.toFixed(0).padStart(7)).join('  ')
    );
  }
  console.log('');
}

/**
 * Nom de fichier du chunk qui porte Observable Plot dans le build courant.
 *
 * Le hachage change a chaque build : plutot que de le deviner, on relit les
 * chunks compiles pour trouver celui qui contient un message d'erreur propre
 * a Plot (`unknown scale`, absent de tout le reste du bundle). C'est ce
 * fichier qui ne doit partir sur le reseau qu'au premier besoin — frise
 * ouverte ou vue matrice — et jamais avant.
 */
/** Chemin absolu et taille en octets du binaire wasm du build courant. */
export function infosWasm(): { chemin: string; octets: number } {
  const dossier = new URL('../../build/_app/immutable/assets/', import.meta.url).pathname.replace(
    /^\/([A-Za-z]:)/,
    '$1'
  );
  const fichier = readdirSync(dossier).find((f) => /^duckdb-eh\..+\.wasm$/.test(f));
  if (!fichier) throw new Error('infosWasm : aucun duckdb-eh.*.wasm dans ' + dossier);
  return { chemin: fichier, octets: statSync(`${dossier}${fichier}`).size };
}

export function trouverChunkPlot(): string {
  const dossier = new URL('../../build/_app/immutable/chunks/', import.meta.url).pathname.replace(
    /^\/([A-Za-z]:)/,
    '$1'
  );
  const fichiers = readdirSync(dossier).filter((f) => f.endsWith('.js'));
  const trouve = fichiers.find((f) => readFileSync(`${dossier}${f}`, 'utf8').includes('unknown scale'));
  if (!trouve) throw new Error('trouverChunkPlot : aucun chunk ne porte la marque « unknown scale »');
  return trouve;
}

export function imprimerTransferts(octets: Map<string, number>): void {
  console.log('Transferts /data (mesures cote serveur) :');
  for (const [chemin, taille] of octets) {
    if (chemin.startsWith('/data/')) {
      console.log(`  ${chemin.replace('/data/', '').padEnd(22)} ${(taille / 1024).toFixed(0)} Ko`);
    }
  }
  console.log('');
}
