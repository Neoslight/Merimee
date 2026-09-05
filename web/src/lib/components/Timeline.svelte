<script lang="ts">
  import * as Plot from '@observablehq/plot';
  import type { BarreAnnee, BarreSiecle } from '$lib/db/queries';
  import { ANNEE_MAX, ANNEE_MIN } from '$lib/state/filters.svelte';
  import { compact, romain } from '$lib/format';
  import { palette } from '$lib/state/theme.svelte';

  interface Props {
    siecles: BarreSiecle[];
    protections: BarreAnnee[];
    siecleSelection: number[];
    plage: [number, number] | null;
    onsiecle: (siecle: number) => void;
    onsiecles: (siecles: number[]) => void;
    onplage: (plage: [number, number] | null) => void;
  }

  let { siecles, protections, siecleSelection, plage, onsiecle, onsiecles, onplage }: Props =
    $props();

  const HAUTEUR = 104;

  let boiteSiecles: HTMLDivElement;
  let boiteAnnees: HTMLDivElement;
  let largeur = $state(900);
  let echelleX: ((valeur: number) => number) | null = null;
  let inverseX: ((pixel: number) => number) | null = null;

  // Piste des siecles : echelle **a bandes**, donc pas d'`invert`. Le pixel se
  // retraduit en siecle en balayant les bandes, et la meme fonction sert au
  // clic et au brossage.
  let bandeSiecle: ((pixel: number) => number | null) | null = null;
  let bornesSiecle: ((siecle: number) => { gauche: number; largeur: number } | null) | null =
    null;

  $effect(() => {
    const observateur = new ResizeObserver(([entree]) => {
      largeur = Math.max(320, entree.contentRect.width);
    });
    observateur.observe(boiteSiecles);
    return () => observateur.disconnect();
  });

  // Axe 1 : epoque de construction. Clic = bascule d'un siecle, glissement =
  // plage entiere. Selectionner le gothique demandait trois clics.
  $effect(() => {
    const donnees = siecles;
    const selection = siecleSelection;
    const graphe = Plot.plot({
      width: largeur,
      height: HAUTEUR,
      marginLeft: 34,
      marginRight: 8,
      marginTop: 8,
      marginBottom: 20,
      style: { background: 'transparent', color: 'var(--texte-faible)', fontSize: '10px' },
      x: { label: null, tickFormat: (d: number) => romain(d) },
      y: { label: null, grid: true, ticks: 2, tickFormat: (d: number) => compact.format(d) },
      marks: [
        Plot.barY(donnees, {
          x: 'siecle',
          y: 'n',
          fill: (d: BarreSiecle) =>
            selection.length === 0 || selection.includes(d.siecle)
              ? palette.accent
              : palette.barreSourde,
          title: (d: BarreSiecle) => `${romain(d.siecle)}e siècle — ${d.n.toLocaleString('fr-FR')}`
        }),
        Plot.ruleY([0], { stroke: 'var(--bord)' })
      ]
    });
    // `graphe.value` n'est renseigne que par les marques interactives de Plot
    // (pointer, tip) : sur une simple barre il reste nul. On retrouve donc la
    // bande visee depuis l'echelle x plutot que depuis la cible du clic.
    const echelle = graphe.scale('x');
    const bande = echelle?.bandwidth ?? 0;
    // Le pixel est rattache a la bande **la plus proche**, pas a celle qu'il
    // touche exactement : `barY` laisse un intervalle entre les barres, et un
    // geste qui demarre ou passe dans un intervalle ne doit pas se perdre.
    // Hors de la zone des barres — la marge de l'axe — rien n'est vise.
    bandeSiecle = (pixel) => {
      if (!echelle?.apply || donnees.length === 0) return null;
      const premier = echelle.apply(donnees[0].siecle) as number;
      const dernier = (echelle.apply(donnees[donnees.length - 1].siecle) as number) + bande;
      if (pixel < premier - bande || pixel > dernier + bande) return null;
      let cible = donnees[0];
      let ecart = Infinity;
      for (const d of donnees) {
        const centre = (echelle.apply(d.siecle) as number) + bande / 2;
        const distance = Math.abs(pixel - centre);
        if (distance < ecart) {
          ecart = distance;
          cible = d;
        }
      }
      return cible.siecle;
    };
    bornesSiecle = (siecle) => {
      if (!echelle?.apply) return null;
      return { gauche: echelle.apply(siecle) as number, largeur: bande };
    };
    boiteSiecles.replaceChildren(graphe);
    return () => graphe.remove();
  });

  // Axe 2 : annee de l'arrete de protection. Echelle lineaire, brossage.
  $effect(() => {
    const donnees = protections;
    const graphe = Plot.plot({
      width: largeur,
      height: HAUTEUR,
      marginLeft: 34,
      marginRight: 8,
      marginTop: 8,
      marginBottom: 20,
      style: { background: 'transparent', color: 'var(--texte-faible)', fontSize: '10px' },
      x: { label: null, domain: [ANNEE_MIN, ANNEE_MAX + 1], tickFormat: 'd' },
      y: { label: null, grid: true, ticks: 2, tickFormat: (d: number) => compact.format(d) },
      marks: [
        Plot.rectY(donnees, {
          x1: (d: BarreAnnee) => d.annee,
          x2: (d: BarreAnnee) => d.annee + 1,
          y: 'n',
          fill: palette.inscrit,
          insetLeft: 0.2,
          insetRight: 0.2,
          title: (d: BarreAnnee) => `${d.annee} — ${d.n.toLocaleString('fr-FR')} actes`
        }),
        Plot.ruleY([0], { stroke: 'var(--bord)' })
      ]
    });
    const echelle = graphe.scale('x');
    echelleX = echelle?.apply ?? null;
    inverseX = echelle?.invert ?? null;
    boiteAnnees.replaceChildren(graphe);
    return () => graphe.remove();
  });

  // Observable Plot n'embarque pas de brossage : quelques evenements pointeur
  // sur un calque transparent suffisent, et evitent une dependance de plus.
  let depart: number | null = $state(null);
  let courant: number | null = $state(null);

  function annee(event: PointerEvent): number {
    const boite = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const valeur = inverseX ? inverseX(event.clientX - boite.left) : ANNEE_MIN;
    return Math.round(Math.min(ANNEE_MAX, Math.max(ANNEE_MIN, valeur)));
  }

  function debut(event: PointerEvent) {
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    depart = annee(event);
    courant = depart;
  }

  function glisse(event: PointerEvent) {
    if (depart === null) return;
    courant = annee(event);
  }

  function fin(event: PointerEvent) {
    if (depart === null) return;
    const a = depart;
    const b = annee(event);
    depart = null;
    courant = null;
    // Un clic sec (pas un glissement) efface la plage.
    onplage(Math.abs(a - b) < 1 ? null : [Math.min(a, b), Math.max(a, b)]);
  }

  function saisirBorne(index: 0 | 1, valeur: string) {
    const annee = Number.parseInt(valeur, 10);
    if (!Number.isFinite(annee)) return;
    const borne = Math.min(ANNEE_MAX, Math.max(ANNEE_MIN, annee));
    const courante: [number, number] = plage ? [...plage] : [ANNEE_MIN, ANNEE_MAX];
    courante[index] = borne;
    onplage([Math.min(...courante), Math.max(...courante)]);
  }

  const apercu = $derived.by(() => {
    const borne = depart !== null && courant !== null ? [depart, courant] : plage;
    if (!borne || !echelleX) return null;
    const x1 = echelleX(Math.min(borne[0], borne[1]));
    const x2 = echelleX(Math.max(borne[0], borne[1]) + 1);
    return { gauche: x1, largeur: Math.max(2, x2 - x1) };
  });

  // --- Brossage des siecles -------------------------------------------------
  let departS: number | null = $state(null);
  let courantS: number | null = $state(null);
  // Le dernier siecle survole reste memorise : relacher entre deux bandes ne
  // doit pas annuler un geste deja commence.
  let dernierS: number | null = null;

  function siecleSous(event: PointerEvent): number | null {
    const boite = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return bandeSiecle ? bandeSiecle(event.clientX - boite.left) : null;
  }

  function debutSiecle(event: PointerEvent) {
    const siecle = siecleSous(event);
    if (siecle === null) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    departS = siecle;
    courantS = siecle;
    dernierS = siecle;
  }

  function glisseSiecle(event: PointerEvent) {
    if (departS === null) return;
    const siecle = siecleSous(event);
    if (siecle !== null) {
      courantS = siecle;
      dernierS = siecle;
    }
  }

  function finSiecle() {
    if (departS === null) return;
    const a = departS;
    const b = dernierS ?? a;
    departS = null;
    courantS = null;
    // Clic sec : la bascule d'un seul siecle reste le geste appris, et le seul
    // moyen de decocher.
    if (a === b) {
      onsiecle(a);
      return;
    }
    const bas = Math.min(a, b);
    const haut = Math.max(a, b);
    onsiecles(siecles.filter((d) => d.siecle >= bas && d.siecle <= haut).map((d) => d.siecle));
  }

  const apercuSiecles = $derived.by(() => {
    if (departS === null || courantS === null || !bornesSiecle) return null;
    const a = bornesSiecle(Math.min(departS, courantS));
    const b = bornesSiecle(Math.max(departS, courantS));
    if (!a || !b) return null;
    return { gauche: a.gauche, largeur: b.gauche + b.largeur - a.gauche };
  });
</script>

<section class="frise">
  <div class="piste">
    <header>
      <h3>Époque de construction</h3>
      <span>clic pour un siècle, glisser pour une plage</span>
    </header>
    <div class="graphe brossable cliquable" bind:this={boiteSiecles}
         role="application" aria-label="Histogramme des époques de construction, cliquer un siècle ou glisser pour sélectionner une plage"
         onpointerdown={debutSiecle} onpointermove={glisseSiecle} onpointerup={finSiecle}>
      {#if apercuSiecles}
        <div class="brosse" style="left:{apercuSiecles.gauche}px; width:{apercuSiecles.largeur}px"></div>
      {/if}
    </div>
  </div>

  <div class="piste">
    <header>
      <h3>Année de protection</h3>
      <span class="bornes">
        <!-- Le brossage a la souris a son equivalent clavier : deux bornes
             saisissables, qui restent le seul chemin accessible. -->
        <label>
          de
          <input type="number" min={ANNEE_MIN} max={ANNEE_MAX} value={plage?.[0] ?? ANNEE_MIN}
                 oninput={(e) => saisirBorne(0, e.currentTarget.value)} />
        </label>
        <label>
          à
          <input type="number" min={ANNEE_MIN} max={ANNEE_MAX} value={plage?.[1] ?? ANNEE_MAX}
                 oninput={(e) => saisirBorne(1, e.currentTarget.value)} />
        </label>
        {#if plage}
          <button onclick={() => onplage(null)}>effacer</button>
        {/if}
      </span>
    </header>
    <div class="graphe brossable" bind:this={boiteAnnees}
         role="application" aria-label="Histogramme des actes de protection, glisser pour sélectionner une plage d'années"
         onpointerdown={debut} onpointermove={glisse} onpointerup={fin}>
      {#if apercu}
        <div class="brosse" style="left:{apercu.gauche}px; width:{apercu.largeur}px"></div>
      {/if}
    </div>
  </div>
</section>

<style>
  .frise {
    display: grid;
    grid-template-columns: 1fr 1.6fr;
    gap: 20px;
    padding: 10px 16px 6px;
    border-top: 1px solid var(--bord);
    background: var(--fond);
  }

  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 2px;
  }

  h3 {
    margin: 0;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--texte);
  }

  header span {
    font-size: 10px;
    color: var(--texte-faible);
  }

  .bornes {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .bornes label {
    display: flex;
    align-items: center;
    gap: 3px;
  }

  .bornes input {
    width: 52px;
    padding: 1px 4px;
    background: var(--fond-creux);
    border: 1px solid var(--bord);
    border-radius: 4px;
    color: var(--texte);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }

  header button {
    background: none;
    border: none;
    padding: 0;
    color: var(--accent);
    cursor: pointer;
    font-size: 10px;
    text-decoration: underline;
  }

  .graphe {
    position: relative;
  }

  .brossable {
    cursor: crosshair;
    touch-action: none;
  }

  /* La piste des siecles accepte les deux gestes : le curseur annonce le clic,
     qui reste le seul moyen de decocher un siecle. */
  .cliquable {
    cursor: pointer;
  }

  .brosse {
    position: absolute;
    top: 8px;
    bottom: 20px;
    background: color-mix(in srgb, var(--accent) 22%, transparent);
    border-left: 1px solid var(--accent);
    border-right: 1px solid var(--accent);
    pointer-events: none;
  }

  @media (max-width: 900px) {
    .frise {
      grid-template-columns: 1fr;
    }
  }
</style>
