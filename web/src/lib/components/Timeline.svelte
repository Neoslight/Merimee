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
    onfermer: () => void;
  }

  let {
    siecles,
    protections,
    siecleSelection,
    plage,
    onsiecle,
    onsiecles,
    onplage,
    onfermer
  }: Props = $props();

  const HAUTEUR = 104;

  let boiteSiecles: HTMLDivElement;
  let boiteAnnees: HTMLDivElement;
  // Une largeur **par piste**. Les deux graphiques partageaient la mesure du
  // premier : la piste des annees, qui occupe 1,6 fois la colonne de gauche,
  // etait donc dessinee a la largeur de sa voisine et laissait 350 px de vide a
  // sa droite — l'espace ou logeaient les bornes saisissables.
  let largeurSiecles = $state(900);
  let largeurAnnees = $state(900);
  // `echelleX` est reactif, `inverseX` non : le premier est lu par l'apercu de
  // brossage, qui doit se redessiner des que le graphique est (re)construit —
  // sinon un lien portant `annees=` arrivait sans son voile, l'echelle etant
  // encore nulle au premier calcul. Le second n'est lu que dans un gestionnaire
  // d'evenement, donc toujours apres.
  let echelleX = $state<((valeur: number) => number) | null>(null);
  let inverseX: ((pixel: number) => number) | null = null;

  // Piste des siecles : echelle **a bandes**, donc pas d'`invert`. Le pixel se
  // retraduit en siecle en balayant les bandes, et la meme fonction sert au
  // clic et au brossage.
  let bandeSiecle: ((pixel: number) => number | null) | null = null;
  let bornesSiecle: ((siecle: number) => { gauche: number; largeur: number } | null) | null =
    null;

  $effect(() => {
    const observateur = new ResizeObserver((entrees) => {
      for (const entree of entrees) {
        const mesure = Math.max(320, entree.contentRect.width);
        if (entree.target === boiteSiecles) largeurSiecles = mesure;
        else largeurAnnees = mesure;
      }
    });
    observateur.observe(boiteSiecles);
    observateur.observe(boiteAnnees);
    return () => observateur.disconnect();
  });

  // Axe 1 : epoque de construction. Clic = bascule d'un siecle, glissement =
  // plage entiere. Selectionner le gothique demandait trois clics.
  $effect(() => {
    const donnees = siecles;
    const selection = siecleSelection;
    const graphe = Plot.plot({
      width: largeurSiecles,
      height: HAUTEUR,
      marginLeft: 34,
      marginRight: 8,
      marginTop: 8,
      marginBottom: 20,
      style: { background: 'transparent', color: 'var(--frise-texte-faible)', fontSize: '10.5px' },
      x: { label: null, tickFormat: (d: number) => romain(d) },
      y: { label: null, grid: true, ticks: 2, tickFormat: (d: number) => compact.format(d) },
      marks: [
        Plot.barY(donnees, {
          x: 'siecle',
          y: 'n',
          fill: (d: BarreSiecle) =>
            selection.length === 0 || selection.includes(d.siecle)
              ? palette.accentPlein
              : palette.barreSourde,
          title: (d: BarreSiecle) => `${romain(d.siecle)}e siècle — ${d.n.toLocaleString('fr-FR')}`
        }),
        Plot.ruleY([0], { stroke: 'var(--frise-graduation)' })
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
      width: largeurAnnees,
      height: HAUTEUR,
      marginLeft: 34,
      marginRight: 8,
      marginTop: 8,
      marginBottom: 20,
      style: { background: 'transparent', color: 'var(--frise-texte-faible)', fontSize: '10.5px' },
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
        Plot.ruleY([0], { stroke: 'var(--frise-graduation)' })
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
    // Les deux pistes repondent aux memes gestes : glisser pose une plage,
    // cliquer pose une seule valeur — et re-cliquer la meme l'efface, comme
    // recliquer un siecle le decoche. Le clic effacait la plage sans rien
    // poser, ce qui n'avait d'equivalent nulle part ailleurs.
    if (Math.abs(a - b) >= 1) {
      onplage([Math.min(a, b), Math.max(a, b)]);
      return;
    }
    onplage(plage && plage[0] === a && plage[1] === a ? null : [a, a]);
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
  <!-- La frise se replie a toutes les largeurs, comme le tiroir des filtres :
       la croix est ici, le bouton qui la rouvre est dans la page. -->
  <button class="fermer-frise" aria-label="Masquer les frises" onclick={onfermer}>×</button>

  <div class="piste">
    <header>
      <h3>Époque de construction</h3>
      <span>clic pour un siècle, glisser pour une plage</span>
    </header>
    <div class="graphe brossable cliquable piste-siecles"
         role="application" aria-label="Histogramme des époques de construction, cliquer un siècle ou glisser pour sélectionner une plage"
         onpointerdown={debutSiecle} onpointermove={glisseSiecle} onpointerup={finSiecle}>
      <!-- La toile est a Plot, le voile est a Svelte : `replaceChildren` efface
           **tous** les enfants de son hote, y compris ceux que Svelte y a
           rendus et l'ancre ou il les reinsere. Les melanger faisait
           disparaitre le voile au premier rafraichissement des donnees. -->
      <div class="toile" bind:this={boiteSiecles}></div>
      {#if apercuSiecles}
        <div class="brosse" style="left:{apercuSiecles.gauche}px; width:{apercuSiecles.largeur}px"></div>
      {/if}
    </div>
  </div>

  <div class="piste">
    <header>
      <h3>Année de protection</h3>
      <span>clic pour une année, glisser pour une plage</span>
    </header>
    <div class="graphe brossable cliquable piste-annees"
         role="application" aria-label="Histogramme des actes de protection, cliquer une année ou glisser pour sélectionner une plage"
         onpointerdown={debut} onpointermove={glisse} onpointerup={fin}>
      <div class="toile" bind:this={boiteAnnees}></div>
      {#if apercu}
        <div class="brosse" style="left:{apercu.gauche}px; width:{apercu.largeur}px"></div>
      {/if}
    </div>
  </div>
</section>

<style>
  /* La frise appartient a l'interface, pas a la carte : elle suit donc le
     theme. La reserve a droite est celle de la croix, qui s'y pose. */
  .frise {
    position: relative;
    display: grid;
    grid-template-columns: 1fr 1.6fr;
    gap: 36px;
    padding: 20px 48px 18px 26px;
    border-top: 1px solid var(--bord);
    background: var(--frise-fond);
  }

  /* `min-width: 0` : sans lui, un element de grille prend la largeur de son
     contenu des qu'elle depasse sa part, et le graphique — dimensionne sur la
     largeur mesuree — entretiendrait sa propre croissance. */
  .piste {
    min-width: 0;
  }

  /* Meme pastille que la croix du tiroir des filtres : c'est le meme geste. */
  .fermer-frise {
    position: absolute;
    top: 12px;
    right: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: 1px solid var(--bord);
    border-radius: 50%;
    background: transparent;
    color: var(--frise-texte-faible);
    font-size: 17px;
    line-height: 1;
    cursor: pointer;
    transition: all var(--t-rapide);
  }

  .fermer-frise:hover {
    border-color: var(--bord-appuye);
    color: var(--frise-texte);
  }

  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }

  h3 {
    margin: 0;
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--frise-texte);
  }

  header span {
    font-size: 10.5px;
    color: var(--frise-texte-faible);
  }

  .graphe {
    position: relative;
    color: var(--frise-texte-faible);
  }

  .graphe :global(svg) {
    overflow: visible;
  }

  /* Le graphique donne sa hauteur a la piste : la toile n'ajoute rien, elle
     isole seulement ce que Plot remplace de ce que Svelte rend. */
  .toile {
    display: block;
    min-width: 0;
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

  /* Voile terracotta, et deux poignees en pseudo-elements : aucun noeud de
     plus pour dire ou se prend la plage. */
  .brosse {
    position: absolute;
    top: 8px;
    bottom: 20px;
    background: color-mix(in srgb, var(--accent-plein) 20%, transparent);
    border-left: 1px solid var(--accent-plein);
    border-right: 1px solid var(--accent-plein);
    pointer-events: none;
  }

  .brosse::before,
  .brosse::after {
    content: '';
    position: absolute;
    bottom: -7px;
    width: 15px;
    height: 15px;
    border-radius: 50%;
    background: var(--fond-carte);
    box-shadow:
      0 0 0 5px color-mix(in srgb, var(--accent-plein) 22%, transparent),
      0 4px 12px -3px rgb(var(--voile) / 50%);
  }

  .brosse::before {
    left: -8px;
  }

  .brosse::after {
    right: -8px;
  }

  @media (max-width: 900px) {
    .frise {
      grid-template-columns: 1fr;
      padding: 20px 44px 18px 16px;
      gap: 20px;
    }
  }
</style>
