/**
 * Cadrage des photographies de fiche — calculs purs, geometrie seule.
 *
 * Extrait de `DetailPanel.svelte`, qui garde les gestionnaires DOM/pointeur et
 * l'etat ARIA : ce fichier ne connait ni le pointeur, ni le DOM au-dela d'un
 * `DOMParser` pour depouiller le HTML que rend l'API Commons.
 */

/** Un tirage vertical, 2/3. */
export const CADRE_MIN = 0.68;
/** Un panorama, 16/9. */
export const CADRE_MAX = 1.9;

/** Ramene une valeur dans [0, 100] : un pourcentage d'`object-position`. */
export function borner(valeur: number): number {
  return Math.min(100, Math.max(0, valeur));
}

/**
 * Rapport du cadre affiche : celui du fichier, borne des deux cotes. Le 4/3
 * fixe recadrait tout, et sans borne un bandeau se reduirait a un trait — le
 * repli a 4/3 ne vaut que tant que l'image n'est pas encore mesuree.
 */
export function cadre(rapport: number | null): number {
  return rapport === null ? 4 / 3 : Math.min(CADRE_MAX, Math.max(CADRE_MIN, rapport));
}

/** Hors bornes : l'image deborde son cadre, donc elle se fait glisser. */
export function estRecadree(rapport: number | null): boolean {
  return rapport !== null && (rapport < CADRE_MIN || rapport > CADRE_MAX);
}

/**
 * Nouveau cadrage apres un glissement, en pourcents de la part cachee.
 *
 * `object-position` s'exprime en pourcents de la part cachee du rendu
 * `cover` : le pixel se convertit donc par cette part, recalculee depuis le
 * rapport reel et la boite affichee — une fraction fixe deriverait avec la
 * largeur de la fiche, qui change de gabarit en gabarit.
 */
export function glisserCadrage(params: {
  rapport: number;
  boiteWidth: number;
  boiteHeight: number;
  depart: { x: number; y: number; px: number; py: number };
  pointeur: { x: number; y: number };
}): { x: number; y: number } {
  const { rapport, boiteWidth, boiteHeight, depart, pointeur } = params;
  const rapportBoite = boiteWidth / boiteHeight;
  // Rendu en `cover` : un seul axe deborde, l'autre est ajuste.
  const cacheX = rapport > rapportBoite ? boiteHeight * rapport - boiteWidth : 0;
  const cacheY = rapport < rapportBoite ? boiteWidth / rapport - boiteHeight : 0;
  const dx = pointeur.x - depart.x;
  const dy = pointeur.y - depart.y;
  return {
    // Tirer vers la droite doit decouvrir la gauche : le pourcentage baisse.
    x: cacheX > 0 ? borner(depart.px - (dx / cacheX) * 100) : depart.px,
    y: cacheY > 0 ? borner(depart.py - (dy / cacheY) * 100) : depart.py
  };
}

/** `extmetadata` renvoie du HTML (`<a>`, `<span>`) : le texte seul suffit. */
export function texteNu(html: string): string {
  return new DOMParser().parseFromString(html, 'text/html').body.textContent?.trim() ?? '';
}

/**
 * Auteur et licence, extraits de la reponse `imageinfo` de l'API Commons.
 * Pure une fois la reponse recue : le `fetch` lui-meme reste dans le
 * composant, qui est seul a savoir quand l'appeler et quoi faire d'un echec.
 */
export function extraireCredit(donnees: unknown): { auteur: string; licence: string } | null {
  const pages = (donnees as { query?: { pages?: Record<string, unknown> } })?.query?.pages ?? {};
  const meta = Object.values(pages)[0] as
    | { imageinfo?: { extmetadata?: Record<string, { value?: string }> }[] }
    | undefined;
  const champs = meta?.imageinfo?.[0]?.extmetadata ?? {};
  const auteur = texteNu(champs.Artist?.value ?? '');
  const licence = texteNu(champs.LicenseShortName?.value ?? '');
  return auteur || licence ? { auteur, licence } : null;
}
