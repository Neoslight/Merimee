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

  // Chaque mesure retenue reconstruit integralement le graphique Plot
  // (`Plot.plot()` puis `replaceChildren`), pas seulement son echelle. Un
  // redimensionnement de fenetre en glisse continue, ou l'ouverture d'un
  // panneau qui rogne la piste, emet une rafale de notifications : on n'en
  // retient qu'une par image.
  $effect(() => {
    let trame = 0;
    let siecles: number | null = null;
    let annees: number | null = null;
    const observateur = new ResizeObserver((entrees) => {
      for (const entree of entrees) {
        const mesure = Math.max(320, entree.contentRect.width);
        if (entree.target === boiteSiecles) siecles = mesure;
        else annees = mesure;
      }
      if (trame) return;
      trame = requestAnimationFrame(() => {
        trame = 0;
        if (siecles !== null) largeurSiecles = siecles;
        if (annees !== null) largeurAnnees = annees;
      });
    });
    observateur.observe(boiteSiecles);
    observateur.observe(boiteAnnees);
    return () => {
      if (trame) cancelAnimationFrame(trame);
      observateur.disconnect();
    };
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

  // Factorisees pour etre rejouees a l'identique par le clavier : « memes
  // callbacks que le pointeur », donc les deux gestes de fin de glissement
  // et de clic sec vivent ici, pas dupliques dans le gestionnaire clavier.
  function appliquerPlageAnnees(a: number, b: number) {
    onplage([Math.min(a, b), Math.max(a, b)]);
  }

  function basculerAnnee(a: number) {
    // Recliquer la meme annee l'efface, comme recliquer un siecle le decoche.
    onplage(plage && plage[0] === a && plage[1] === a ? null : [a, a]);
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
      appliquerPlageAnnees(a, b);
      return;
    }
    basculerAnnee(a);
  }

  const apercu = $derived.by(() => {
    const borne = depart !== null && courant !== null ? [depart, courant] : plage;
    if (!borne || !echelleX) return null;
    const x1 = echelleX(Math.min(borne[0], borne[1]));
    const x2 = echelleX(Math.max(borne[0], borne[1]) + 1);
    return { gauche: x1, largeur: Math.max(2, x2 - x1) };
  });

  // --- Chemin clavier : annee -----------------------------------------------
  //
  // Les fleches seules ne font que deplacer le curseur — un survol, pas une
  // action. Entree/Espace rejoue `basculerAnnee`, Maj+fleche rejoue
  // `appliquerPlageAnnees` a chaque pas : memes fonctions que le pointeur,
  // aucun nouveau chemin vers les filtres. Le curseur est un calque Svelte
  // au meme titre que le voile de brossage, jamais lu par les deux effets
  // qui construisent le graphique — sinon chaque pas reconstruirait Plot.
  let curseurAnnee: number | null = $state(null);
  let ancreAnnee: number | null = $state(null);

  function initialiserCurseurAnnee() {
    if (curseurAnnee !== null) return;
    curseurAnnee = plage ? plage[0] : Math.round((ANNEE_MIN + ANNEE_MAX) / 2);
  }

  function clavierAnnee(event: KeyboardEvent) {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowLeft': {
        event.preventDefault();
        const pas = event.key === 'ArrowRight' ? 1 : -1;
        const base = curseurAnnee ?? ANNEE_MIN;
        const cible = Math.min(ANNEE_MAX, Math.max(ANNEE_MIN, base + pas));
        if (event.shiftKey) {
          if (ancreAnnee === null) ancreAnnee = base;
          curseurAnnee = cible;
          appliquerPlageAnnees(ancreAnnee, curseurAnnee);
        } else {
          ancreAnnee = null;
          curseurAnnee = cible;
        }
        break;
      }
      case 'Home':
        event.preventDefault();
        ancreAnnee = null;
        curseurAnnee = ANNEE_MIN;
        break;
      case 'End':
        event.preventDefault();
        ancreAnnee = null;
        curseurAnnee = ANNEE_MAX;
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        ancreAnnee = null;
        if (curseurAnnee !== null) basculerAnnee(curseurAnnee);
        break;
    }
  }

  // `echelleX` est reactif (cf. plus haut) : ce derive se recalcule donc a
  // chaque reconstruction du graphique, comme `apercu`.
  const curseurRectAnnee = $derived.by(() => {
    if (curseurAnnee === null || !echelleX) return null;
    const x1 = echelleX(curseurAnnee);
    const x2 = echelleX(curseurAnnee + 1);
    return { gauche: x1, largeur: Math.max(2, x2 - x1) };
  });

  const effectifAnnee = $derived(
    curseurAnnee === null ? null : (protections.find((d) => d.annee === curseurAnnee)?.n ?? 0)
  );
  const annonceAnnee = $derived(
    curseurAnnee === null || effectifAnnee === null
      ? ''
      : `${curseurAnnee} — ${effectifAnnee.toLocaleString('fr-FR')} acte${effectifAnnee > 1 ? 's' : ''}`
  );

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

  // Factorisee pour etre rejouee a l'identique par le clavier (cf. annee).
  function appliquerPlageSiecles(a: number, b: number) {
    const bas = Math.min(a, b);
    const haut = Math.max(a, b);
    onsiecles(siecles.filter((d) => d.siecle >= bas && d.siecle <= haut).map((d) => d.siecle));
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
    appliquerPlageSiecles(a, b);
  }

  const apercuSiecles = $derived.by(() => {
    if (departS === null || courantS === null || !bornesSiecle) return null;
    const a = bornesSiecle(Math.min(departS, courantS));
    const b = bornesSiecle(Math.max(departS, courantS));
    if (!a || !b) return null;
    return { gauche: a.gauche, largeur: b.gauche + b.largeur - a.gauche };
  });

  // --- Chemin clavier : siecle -----------------------------------------------
  //
  // Echelle a bandes : le curseur avance par index dans les donnees affichees,
  // pas par arithmetique sur le siecle — un « cran » n'a de sens qu'entre deux
  // valeurs presentes sur l'axe. Memes fonctions que le pointeur
  // (`onsiecle`, `appliquerPlageSiecles`), meme raison qu'en annee.
  let curseurSiecle: number | null = $state(null);
  let ancreSiecle: number | null = $state(null);

  function indexCourantSiecle(): number {
    if (curseurSiecle === null) return 0;
    const i = siecles.findIndex((d) => d.siecle === curseurSiecle);
    return i === -1 ? 0 : i;
  }

  function initialiserCurseurSiecle() {
    if (curseurSiecle !== null || siecles.length === 0) return;
    const premierRetenu =
      siecleSelection.length > 0
        ? siecles.find((d) => siecleSelection.includes(d.siecle))
        : undefined;
    curseurSiecle = (premierRetenu ?? siecles[0]).siecle;
  }

  function clavierSiecle(event: KeyboardEvent) {
    if (siecles.length === 0) return;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowLeft': {
        event.preventDefault();
        const pas = event.key === 'ArrowRight' ? 1 : -1;
        const ancienIndex = indexCourantSiecle();
        const nouvelIndex = Math.min(siecles.length - 1, Math.max(0, ancienIndex + pas));
        if (event.shiftKey) {
          if (ancreSiecle === null) ancreSiecle = siecles[ancienIndex].siecle;
          curseurSiecle = siecles[nouvelIndex].siecle;
          appliquerPlageSiecles(ancreSiecle, curseurSiecle);
        } else {
          ancreSiecle = null;
          curseurSiecle = siecles[nouvelIndex].siecle;
        }
        break;
      }
      case 'Home':
        event.preventDefault();
        ancreSiecle = null;
        curseurSiecle = siecles[0].siecle;
        break;
      case 'End':
        event.preventDefault();
        ancreSiecle = null;
        curseurSiecle = siecles[siecles.length - 1].siecle;
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        ancreSiecle = null;
        if (curseurSiecle !== null) onsiecle(curseurSiecle);
        break;
    }
  }

  const curseurRectSiecle = $derived.by(() => {
    if (curseurSiecle === null || !bornesSiecle) return null;
    return bornesSiecle(curseurSiecle);
  });

  const effectifSiecle = $derived(
    curseurSiecle === null ? null : (siecles.find((d) => d.siecle === curseurSiecle)?.n ?? 0)
  );
  const annonceSiecle = $derived(
    curseurSiecle === null || effectifSiecle === null
      ? ''
      : `${romain(curseurSiecle)}e siècle — ${effectifSiecle.toLocaleString('fr-FR')} notice${effectifSiecle > 1 ? 's' : ''}`
  );
</script>

<section class="frise">
  <!-- La frise se replie a toutes les largeurs, comme le tiroir des filtres :
       la croix est ici, le bouton qui la rouvre est dans la page. -->
  <button class="fermer-frise frappe-44" aria-label="Masquer les frises" onclick={onfermer}>×</button>

  <div class="piste">
    <header>
      <h3>Époque de construction</h3>
      <span>clic pour un siècle, glisser pour une plage</span>
    </header>
    <!-- `role="application"` reste le plus honnete : cet axe repond deja au
         pointeur avec une semantique qui lui est propre (clic, glissement),
         desormais doublee au clavier. L'a11y-lint de Svelte ne reconnait pas
         ce role comme « interactif » pour autoriser `tabindex`/`onkeydown` —
         c'est pourtant precisement ce que ce role signifie a un lecteur
         d'ecran : gerer soi-meme les touches. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="graphe brossable cliquable piste-siecles"
         role="application" tabindex="0"
         aria-label="Histogramme des époques de construction. Cliquer un siècle ou glisser pour une plage à la souris ; flèches gauche et droite pour déplacer le curseur d'un siècle, Début et Fin pour les extrémités, Entrée ou Espace pour sélectionner ou désélectionner le siècle focalisé, Majuscule et flèche pour étendre une plage depuis ce curseur"
         onpointerdown={debutSiecle} onpointermove={glisseSiecle} onpointerup={finSiecle}
         onkeydown={clavierSiecle} onfocus={initialiserCurseurSiecle}>
      <!-- La toile est a Plot, le voile est a Svelte : `replaceChildren` efface
           **tous** les enfants de son hote, y compris ceux que Svelte y a
           rendus et l'ancre ou il les reinsere. Les melanger faisait
           disparaitre le voile au premier rafraichissement des donnees. -->
      <div class="toile" bind:this={boiteSiecles}></div>
      {#if apercuSiecles}
        <div class="brosse" style="left:{apercuSiecles.gauche}px; width:{apercuSiecles.largeur}px"></div>
      {/if}
      {#if curseurRectSiecle}
        <!-- Repere clavier : un calque Svelte de plus, au meme titre que le
             voile de brossage — jamais une marque Plot, sinon chaque pas
             clavier reconstruirait le graphique. -->
        <div class="curseur-clavier"
             style="left:{curseurRectSiecle.gauche}px; width:{curseurRectSiecle.largeur}px"></div>
      {/if}
      <span class="lecteur-seul" aria-live="polite">{annonceSiecle}</span>
    </div>
  </div>

  <div class="piste">
    <header>
      <h3>Année de protection</h3>
      <span>clic pour une année, glisser pour une plage</span>
    </header>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="graphe brossable cliquable piste-annees"
         role="application" tabindex="0"
         aria-label="Histogramme des actes de protection. Cliquer une année ou glisser pour une plage à la souris ; flèches gauche et droite pour déplacer le curseur d'une année, Début et Fin pour les bornes {ANNEE_MIN} et {ANNEE_MAX}, Entrée ou Espace pour sélectionner ou désélectionner l'année focalisée, Majuscule et flèche pour étendre une plage depuis ce curseur"
         onpointerdown={debut} onpointermove={glisse} onpointerup={fin}
         onkeydown={clavierAnnee} onfocus={initialiserCurseurAnnee}>
      <div class="toile" bind:this={boiteAnnees}></div>
      {#if apercu}
        <div class="brosse" style="left:{apercu.gauche}px; width:{apercu.largeur}px"></div>
      {/if}
      {#if curseurRectAnnee}
        <div class="curseur-clavier"
             style="left:{curseurRectAnnee.gauche}px; width:{curseurRectAnnee.largeur}px"></div>
      {/if}
      <span class="lecteur-seul" aria-live="polite">{annonceAnnee}</span>
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

  /* Le survol qui reste colle au tactile n'a de sens qu'au pointeur fin. */
  @media (hover: hover) and (pointer: fine) {
    .fermer-frise:hover {
      border-color: var(--bord-appuye);
      color: var(--frise-texte);
    }
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

  /* Repere clavier : un simple cadre, distinct de la teinte du filtre actif
     (`--accent-plein`, deja pris par les barres retenues et le voile de
     brossage). Invisible tant que l'axe n'a pas le focus — un Tab prealable
     est le seul moyen d'y entrer, comme pour toute barre d'outils. */
  .curseur-clavier {
    position: absolute;
    top: 8px;
    bottom: 20px;
    border: 2px solid var(--frise-texte);
    border-radius: 2px;
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--t-rapide);
  }

  .graphe:focus .curseur-clavier {
    opacity: 1;
  }

  /* Gardee pour les lecteurs d'ecran : la valeur focalisee et son effectif
     n'ont pas d'autre pendant visible que le curseur lui-meme. */
  .lecteur-seul {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
    padding: 0;
    margin: -1px;
  }

  @media (max-width: 900px) {
    .frise {
      grid-template-columns: 1fr;
      padding: 20px 44px 18px 16px;
      gap: 20px;
    }
  }
</style>
