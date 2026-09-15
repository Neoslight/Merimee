/**
 * Lectures de sources, pas de navigateur : deux regles de conception qui ne
 * se verifient qu'en texte.
 *
 * « Toute couleur vit dans app.css » — MapLibre et Plot lisent la palette
 * par `getComputedStyle` ; une couleur ecrite en dur dans un composant
 * resterait muette au changement de theme.
 *
 * « Tout `:hover` vit sous `@media (hover: hover)` » — sans quoi il reste
 * colle au tactile jusqu'au tap suivant (cf. CLAUDE.md, reste a faire).
 */
import { test } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { verifier } from './_soutien';

function racineSrc(): string {
  return new URL('../../src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
}

function fichiersSource(extensions: RegExp, exclure: string[] = []): string[] {
  const fichiers: string[] = [];
  const parcourir = (dossier: string) => {
    for (const entree of readdirSync(dossier, { withFileTypes: true })) {
      const chemin = `${dossier}/${entree.name}`;
      if (entree.isDirectory()) parcourir(chemin);
      else if (extensions.test(entree.name) && !exclure.includes(entree.name)) fichiers.push(chemin);
    }
  };
  parcourir(racineSrc());
  return fichiers;
}

/** Remplace le contenu des commentaires par des espaces (memes indices,
 *  memes numeros de ligne), pour que les regex suivantes les ignorent sans
 *  decaler ce qu'elles rapportent. */
function sansCommentaires(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
}

/** Plages de caracteres a l'interieur d'un bloc `@media` dont la condition
 *  mentionne `hover: hover` — analyse textuelle simple par comptage
 *  d'accolades, suffisante pour du CSS/Svelte sans accolades dans les
 *  chaines de la condition elle-meme. */
function plagesSuresHover(src: string): [number, number][] {
  const plages: [number, number][] = [];
  const re = /@media([^{]*)\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const condition = m[1];
    let profondeur = 1;
    let i = m.index + m[0].length;
    for (; i < src.length && profondeur > 0; i++) {
      if (src[i] === '{') profondeur++;
      else if (src[i] === '}') profondeur--;
    }
    if (/hover:\s*hover/.test(condition)) plages.push([m.index, i]);
  }
  return plages;
}

test('sources : couleurs et survols', async () => {
  await test.step('aucune couleur en dur hors app.css', async () => {
    // `theme.svelte.ts` est exclu : sa palette de repli doit porter des
    // valeurs, le rendu prealable n'ayant pas de document a interroger —
    // c'est le seul miroir volontaire d'`app.css`, commente comme tel dans
    // le fichier. `photo.ts` et `carte/fonds.ts`, ajoutes cette session,
    // n'ont besoin d'aucune exception : ce parcours est deja recursif sur
    // tout `src/`.
    const fichiers = fichiersSource(/\.(svelte|ts)$/, ['theme.svelte.ts']);
    const fautifs = fichiers.filter((f) => /#[0-9a-fA-F]{6}/.test(readFileSync(f, 'utf8')));
    verifier(
      'aucune couleur en dur hors app.css',
      fautifs.length === 0,
      fautifs.map((f) => f.split('/src/')[1]).join(', ') || `${fichiers.length} fichiers relus`
    );
  });

  await test.step('tout :hover vit sous @media (hover: hover)', async () => {
    const fichiers = fichiersSource(/\.(svelte|css)$/);
    const violations: string[] = [];
    for (const f of fichiers) {
      const src = sansCommentaires(readFileSync(f, 'utf8'));
      const plages = plagesSuresHover(src);
      const re = /:hover/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const protege = plages.some(([d, fin]) => m!.index >= d && m!.index < fin);
        if (!protege) {
          const ligne = src.slice(0, m.index).split('\n').length;
          violations.push(`${f.split('/src/')[1]}:${ligne}`);
        }
      }
    }
    verifier(
      'toute regle :hover est sous @media (hover: hover) and (pointer: fine)',
      violations.length === 0,
      violations.join(', ') || `${fichiers.length} fichiers relus`
    );
  });
});
