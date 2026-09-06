<script lang="ts">
  import maplibregl, {
    type ExpressionSpecification,
    type Map as MapLibreMap
  } from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import { untrack } from 'svelte';
  import { FOND, palette } from '$lib/state/theme.svelte';
  import { mesures } from '$lib/state/mesures.svelte';
  import type { FondHistorique, VueCarte } from '$lib/state/permalien';

  interface Props {
    /** Nuage deja en GeoJSON : `queries.points()` le construit depuis les
     *  vecteurs Arrow, la carte n'a plus qu'a le poser. */
    points: GeoJSON.FeatureCollection;
    selection: string | null;
    vueInitiale: VueCarte | null;
    /** Fond historique superpose. Lie a la page, qui seule ecrit l'URL. */
    fond: FondHistorique | null;
    onselect: (reference: string) => void;
    onbbox: (bbox: [number, number, number, number] | null) => void;
  }

  let {
    points,
    selection,
    vueInitiale,
    fond = $bindable(),
    onselect,
    onbbox
  }: Props = $props();

  /** Vue par defaut : la France entiere. */
  const DEPART: VueCarte = { lon: 2.6, lat: 46.6, zoom: 4.7 };

  let conteneur: HTMLDivElement;
  let carte: MapLibreMap | undefined = $state();
  let pret = $state(false);
  let suivreVue = $state(false);
  let densite = $state(false);
  let minuteur: ReturnType<typeof setTimeout> | undefined;

  /** Semiologie des points : statut juridique, ou epoque de construction. */
  type Mode = 'statut' | 'epoque';
  let mode = $state<Mode>('statut');

  const TRANCHES = [
    { cle: 'epoque1', depuis: 1, titre: 'jusqu’au XIIe' },
    { cle: 'epoque2', depuis: 13, titre: 'XIIIe – XVe' },
    { cle: 'epoque3', depuis: 16, titre: 'XVIe – XVIIe' },
    { cle: 'epoque4', depuis: 18, titre: 'XVIIIe – XIXe' },
    { cle: 'epoque5', depuis: 20, titre: 'XXe et après' }
  ] as const;

  /**
   * Fonds historiques de la Geoplateforme IGN, servis sans cle d'API.
   *
   * Trois points mesures, a ne pas redecouvrir :
   *
   * - le prefixe `BNF-IGNF_` de Cassini est **obligatoire** : l'identifiant nu
   *   `GEOGRAPHICALGRIDSYSTEMS.CASSINI` renvoie 400 ;
   * - `zoomMax` n'est pas une precaution, c'est le piege du dispositif. Cassini
   *   s'arrete a z14 : sans `maxzoom` sur la source, MapLibre reclame des tuiles
   *   inexistantes au-dela et **la couche disparait** au moment precis ou l'on
   *   zoome sur l'edifice. Avec, il etire la derniere tuile disponible, ce qui
   *   est le comportement correct pour une carte ancienne ;
   * - Cassini pese ~170 Ko la tuile, soit ~2 Mo par ecran. D'ou la visibilite
   *   `none` au depart : aucun octet IGN ne part tant qu'un fond n'est pas
   *   demande.
   *
   * L'attribution n'est pas decorative : ce sont des reproductions BnF / IGN,
   * la mention est une obligation. Portee par la source, MapLibre l'ajoute et
   * la retire tout seul avec la couche.
   */
  const HISTORIQUES = [
    {
      cle: 'cassini',
      titre: 'Cassini',
      epoque: 'XVIIIe siècle',
      couche: 'BNF-IGNF_GEOGRAPHICALGRIDSYSTEMS.CASSINI',
      format: 'image/png',
      zoomMax: 14,
      poids: '~170 Ko par tuile',
      attribution: 'Carte de Cassini — BnF / IGN'
    },
    {
      cle: 'etatmajor',
      titre: 'État-major',
      epoque: '1820-1866',
      couche: 'GEOGRAPHICALGRIDSYSTEMS.ETATMAJOR40',
      format: 'image/jpeg',
      zoomMax: 15,
      poids: '~20 Ko par tuile',
      attribution: "Carte de l'état-major — IGN"
    }
  ] as const satisfies readonly {
    cle: FondHistorique;
    titre: string;
    epoque: string;
    couche: string;
    format: string;
    zoomMax: number;
    poids: string;
    attribution: string;
  }[];

  /** Opacite de la superposition, en pourcent. Absente de l'URL : c'est un
   *  dosage de lecture, pas un etat d'exploration. */
  let opaciteFond = $state(65);

  /** Au-dela de cette opacite, le fond beige l'emporte sur la carte ardoise et
   *  le lisere clair des points s'y efface. */
  const BASCULE_LISERET = 50;

  const tuiles = (h: (typeof HISTORIQUES)[number]) =>
    'https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile' +
    `&LAYER=${h.couche}&STYLE=normal&TILEMATRIXSET=PM` +
    `&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=${encodeURIComponent(h.format)}`;

  /** Le lisere bascule au sombre sous une carte ancienne suffisamment opaque. */
  function liseret(): string {
    return fond && opaciteFond >= BASCULE_LISERET
      ? palette.carteLiseretSurClair
      : palette.carteLiseret;
  }

  function couleurs(): ExpressionSpecification {
    if (mode === 'epoque') {
      // `siecle_max` est nul pour les notices sans siecle indexe : `step` prend
      // alors sa valeur de base, la teinte « non renseigne ».
      return [
        'step',
        ['coalesce', ['get', 'siecle'], 0],
        palette.statutNul,
        ...TRANCHES.flatMap((t) => [t.depuis, palette[t.cle]])
      ] as unknown as ExpressionSpecification;
    }
    return [
      'match',
      ['get', 'statut'],
      'classé', palette.classe,
      'classé+inscrit', palette.mixte,
      'inscrit', palette.inscrit,
      palette.statutNul
    ];
  }

  function emettreBbox() {
    if (!carte) return;
    const b = carte.getBounds();
    onbbox([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
  }

  /** Vue courante, arrondie. Lue par la page au moment de copier le lien —
   *  jamais ecrite dans l'URL vivante, qui clignoterait a chaque deplacement. */
  export function vueCourante(): VueCarte | null {
    if (!carte) return null;
    const c = carte.getCenter();
    return {
      lon: Math.round(c.lng * 1000) / 1000,
      lat: Math.round(c.lat * 1000) / 1000,
      zoom: Math.round(carte.getZoom() * 10) / 10
    };
  }

  /** Coupe le suivi de vue et retire la contrainte de zone. Appele par la page
   *  quand la puce « zone visible » est retiree : sans cela `suivreVue` reste
   *  vrai et le prochain `moveend` repose aussitot la bbox. */
  export function delierVue() {
    if (!suivreVue) return;
    suivreVue = false;
    onbbox(null);
  }

  /**
   * Toutes les sources et couches ajoutees, en un seul endroit.
   *
   * Le fond ne change plus avec le theme, donc `setStyle` n'est plus appele —
   * mais `style.load` reste le bon point d'accroche : c'est l'evenement du
   * montage, et il couvre tout `setStyle` futur, qui **detruit** l'ensemble de
   * ce qui a ete ajoute. Les fonds historiques, poses ici depuis, en dependent
   * desormais autant que les monuments.
   */
  function poserCouches(map: MapLibreMap, donnees: GeoJSON.FeatureCollection) {
    // Les fonds historiques se posent **avant** les couches de monuments :
    // MapLibre empile dans l'ordre d'ajout, le raster se retrouve donc entre le
    // fond CARTO et les points, jamais au-dessus. Pas de `beforeId` ici — les
    // couches qu'il viserait n'existent pas encore a cet instant, et le passer
    // leverait.
    for (const h of HISTORIQUES) {
      map.addSource(`fond-${h.cle}`, {
        type: 'raster',
        tiles: [tuiles(h)],
        tileSize: 256,
        // Sans ce plafond, la couche disparait au-dela de sa resolution reelle.
        maxzoom: h.zoomMax,
        attribution: h.attribution
      });
      map.addLayer({
        id: `fond-${h.cle}`,
        type: 'raster',
        source: `fond-${h.cle}`,
        layout: { visibility: fond === h.cle ? 'visible' : 'none' },
        paint: { 'raster-opacity': opaciteFond / 100 }
      });
    }

    map.addSource('monuments', { type: 'geojson', data: donnees });
    // Couche de densite, masquee par defaut. Elle repond a ce que 44 000
    // points superposes cachent : au niveau national, la carte de points
    // sature et ne distingue plus une commune riche d'un departement dense.
    map.addLayer({
      id: 'monuments-densite',
      type: 'heatmap',
      source: 'monuments',
      layout: { visibility: densite ? 'visible' : 'none' },
      paint: {
        // Calibrage contraint par la vue nationale : a z4,7 les 44 000 points
        // couvrent le territoire, et un rayon genereux sature la France
        // entiere en un aplat blanc qui ne dit plus rien. Le rayon reste
        // donc minuscule au depart et ne s'ouvre qu'au zoom.
        'heatmap-weight': ['interpolate', ['linear'], ['get', 'nb'], 0, 0.35, 200, 1],
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 4, 0.16, 8, 0.6, 12, 1.6],
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 4, 6, 8, 14, 12, 30],
        'heatmap-opacity': 0.75,
        'heatmap-color': [
          'interpolate', ['linear'], ['heatmap-density'],
          0, palette.chaleur0,
          0.2, palette.chaleur1,
          0.4, palette.chaleur2,
          0.65, palette.chaleur3,
          1, palette.chaleur4
        ]
      }
    });
    map.addLayer({
      id: 'monuments-halo',
      type: 'circle',
      source: 'monuments',
      // Halo reserve aux edifices riches en mobilier Palissy.
      filter: ['>', ['get', 'nb'], 50],
      paint: {
        'circle-color': couleurs(),
        'circle-opacity': densite ? 0 : 0.14,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 7, 12, 26]
      }
    });
    map.addLayer({
      id: 'monuments-points',
      type: 'circle',
      source: 'monuments',
      paint: {
        'circle-color': couleurs(),
        'circle-opacity': densite ? 0.12 : 0.82,
        'circle-stroke-color': liseret(),
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 6, 0, 9, 0.5, 13, 1.8],
        'circle-radius': [
          'interpolate', ['linear'], ['zoom'],
          4, ['case', ['>', ['get', 'nb'], 200], 4, 1.9],
          9, ['case', ['>', ['get', 'nb'], 200], 9, 4],
          14, ['case', ['>', ['get', 'nb'], 200], 16, 8]
        ]
      }
    });
    map.addLayer({
      id: 'monuments-selection',
      type: 'circle',
      source: 'monuments',
      filter: ['==', ['get', 'reference'], selection ?? ''],
      paint: {
        'circle-color': 'transparent',
        'circle-stroke-color': palette.carteSelection,
        'circle-stroke-width': 2,
        'circle-radius': 11
      }
    });
  }

  $effect(() => {
    // La vue de depart est lue sans dependance : c'est une condition initiale.
    // La suivre ici detruirait et recreerait la carte a chaque deplacement.
    const depart = untrack(() => vueInitiale ?? DEPART);
    const map = new maplibregl.Map({
      container: conteneur,
      style: FOND,
      center: [depart.lon, depart.lat],
      zoom: depart.zoom,
      // L'attribution est posee a la main, en bas a **gauche** : a droite, le
      // panneau de fiche la recouvrait des qu'une notice etait ouverte. Une
      // mention de licence masquee n'est pas une mention.
      attributionControl: false,
      // La rotation n'apporte rien a une carte de points et transforme le
      // moindre glissement a deux doigts en desorientation sur telephone.
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

    // `style.load` se declenche au montage **et** apres chaque `setStyle` :
    // c'est le seul evenement qui couvre les deux.
    map.on('style.load', () => {
      poserCouches(map, untrack(() => points));
      pret = true;
    });

    const popup = new maplibregl.Popup({ closeButton: false, offset: 10 });
    map.on('mouseenter', 'monuments-points', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'monuments-points', () => {
      map.getCanvas().style.cursor = '';
      popup.remove();
    });
    map.on('click', 'monuments-points', (event) => {
      const ref = event.features?.[0]?.properties?.reference;
      if (typeof ref === 'string') onselect(ref);
    });
    map.on('moveend', () => {
      if (!suivreVue) return;
      clearTimeout(minuteur);
      minuteur = setTimeout(emettreBbox, 150);
    });

    // La bande de puces qui apparait au premier filtre change la hauteur de la
    // scene. MapLibre ne redimensionne pas son canevas tout seul : sans cet
    // observateur la carte reste dessinee a l'ancienne taille, decalee du
    // pointeur. Les deux panneaux, eux, sont des calques et ne declenchent
    // rien — c'est precisement pourquoi ils sont sortis du flux.
    const gabarit = new ResizeObserver(() => map.resize());
    gabarit.observe(conteneur);

    carte = map;
    return () => {
      gabarit.disconnect();
      clearTimeout(minuteur);
      map.remove();
      carte = undefined;
      pret = false;
    };
  });

  // Les points arrivent apres chaque changement de filtre : `setData` suffit,
  // la couche et son style restent en place.
  $effect(() => {
    const source = pret ? (carte?.getSource('monuments') as maplibregl.GeoJSONSource) : null;
    if (!source) return;
    const t0 = performance.now();
    source.setData(points);
    mesures.rendu = performance.now() - t0;
  });

  $effect(() => {
    if (!pret) return;
    carte?.setFilter('monuments-selection', ['==', ['get', 'reference'], selection ?? '']);
  });

  // Les points restent la couche interactive : les masquer sous la densite
  // supprimerait le clic vers la fiche, on les garde en filigrane.
  $effect(() => {
    if (!pret || !carte) return;
    carte.setLayoutProperty('monuments-densite', 'visibility', densite ? 'visible' : 'none');
    carte.setPaintProperty('monuments-points', 'circle-opacity', densite ? 0.12 : 0.82);
    carte.setPaintProperty('monuments-halo', 'circle-opacity', densite ? 0 : 0.14);
  });

  // Fonds historiques : visibilite et dosage. Une seule carte ancienne a la
  // fois — empiler Cassini sur l'etat-major ne donne qu'une bouillie, pour le
  // double du transfert.
  $effect(() => {
    if (!pret || !carte) return;
    for (const h of HISTORIQUES) {
      carte.setLayoutProperty(`fond-${h.cle}`, 'visibility', fond === h.cle ? 'visible' : 'none');
      carte.setPaintProperty(`fond-${h.cle}`, 'raster-opacity', opaciteFond / 100);
    }
    // Le lisere clair des points s'efface sur un aplat beige : il bascule au
    // sombre des que la carte ancienne l'emporte.
    carte.setPaintProperty('monuments-points', 'circle-stroke-color', liseret());
  });

  /** Densite et fond historique repondent a deux questions incompatibles :
   *  l'une agrege, l'autre situe. Activer l'un eteint l'autre. */
  function choisirFond(cle: FondHistorique) {
    fond = fond === cle ? null : cle;
    if (fond) densite = false;
  }

  function basculerDensite() {
    densite = !densite;
    if (densite) fond = null;
  }

  // Semiologie et palette. Les teintes de statut et le lisere changent avec le
  // theme meme si le fond de carte, lui, ne bouge pas : cet effet couvre les
  // deux, la bascule de theme comme le changement de mode.
  $effect(() => {
    if (!pret || !carte) return;
    const expression = couleurs();
    carte.setPaintProperty('monuments-points', 'circle-color', expression);
    carte.setPaintProperty('monuments-halo', 'circle-color', expression);
    carte.setPaintProperty('monuments-points', 'circle-stroke-color', liseret());
    carte.setPaintProperty('monuments-selection', 'circle-stroke-color', palette.carteSelection);
  });

  function basculerSuivi() {
    suivreVue = !suivreVue;
    if (suivreVue) emettreBbox();
    else onbbox(null);
  }
</script>

<div class="carte" bind:this={conteneur}></div>

<div class="legende">
  {#if mode === 'statut'}
    <span><i style="background:{palette.classe}"></i>classé</span>
    <span><i style="background:{palette.inscrit}"></i>inscrit</span>
    <span><i style="background:{palette.mixte}"></i>les deux</span>
  {:else}
    {#each TRANCHES as tranche (tranche.cle)}
      <span><i style="background:{palette[tranche.cle]}"></i>{tranche.titre}</span>
    {/each}
  {/if}
  <i class="separateur" aria-hidden="true"></i>
  <button class="mode" class:actif={mode === 'epoque'}
          onclick={() => (mode = mode === 'statut' ? 'epoque' : 'statut')}
          aria-pressed={mode === 'epoque'} title="Colorer les points par époque de construction">
    {mode === 'epoque' ? 'par époque' : 'par statut'}
  </button>
  <button class:actif={densite} onclick={basculerDensite}
          aria-pressed={densite} title="Afficher la densité plutôt que les points seuls">
    densité
  </button>
  {#each HISTORIQUES as h (h.cle)}
    <button class:actif={fond === h.cle} onclick={() => choisirFond(h.cle)}
            aria-pressed={fond === h.cle}
            title="Superposer la carte {h.titre} ({h.epoque}) — {h.poids}">
      {h.titre}
    </button>
  {/each}
  {#if fond}
    <!-- Le curseur natif apporte le clavier et le tactile sans rien ecrire. -->
    <label class="dosage">
      opacité
      <input type="range" min="0" max="100" step="5" bind:value={opaciteFond}
             aria-label="Opacité du fond historique" />
      <output>{opaciteFond} %</output>
    </label>
  {/if}
  <button class:actif={suivreVue} onclick={basculerSuivi} aria-pressed={suivreVue}
          title="Restreindre les filtres à la zone visible">
    {suivreVue ? 'vue liée' : 'lier la vue'}
  </button>
</div>

<style>
  .carte {
    position: absolute;
    inset: 0;
  }

  /* `--marge-gauche` est posee par la page : c'est la largeur du tiroir des
     filtres quand il est ouvert a cote de la carte. La carte n'a pas a
     connaitre l'existence d'un panneau de facettes, une variable heritee
     suffit. */
  .legende {
    position: absolute;
    left: calc(var(--marge-gauche, 0px) + 12px);
    bottom: 34px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 16px;
    padding: 9px 14px;
    border: 1px solid rgb(var(--voile) / 6%);
    border-radius: var(--r-l);
    background: color-mix(in srgb, var(--fond) 94%, transparent);
    box-shadow: var(--ombre-carte);
    /* Pas de flou au-dessus d'un canevas WebGL : il se paie a chaque image. */
    backdrop-filter: none;
    font-size: 11.5px;
    color: var(--texte-faible);
    transition: left var(--t-tiroir);
  }

  .legende span {
    display: flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }

  .legende i {
    width: 9px;
    height: 9px;
    border-radius: 50%;
  }

  /* Filet de separation entre la lecture de la legende et ses commandes. Un
     `<i>` et non un `<span>` : le test qui verifie que la legende suit le mode
     de coloration compte `.legende span` — trois entrees par statut, cinq par
     epoque. */
  .separateur {
    width: 1px;
    height: 16px;
    border-radius: 0;
    background: var(--bord);
  }

  .legende button {
    border: 1px solid var(--bord);
    background: var(--fond-carte);
    color: var(--texte-faible);
    border-radius: var(--r-pilule);
    padding: 4px 11px;
    font-size: 11.5px;
    cursor: pointer;
    transition: all var(--t-rapide);
  }

  .legende button:hover {
    border-color: var(--inscrit);
    color: var(--inscrit-texte);
  }

  .legende button.actif {
    border-color: var(--inscrit);
    background: color-mix(in srgb, var(--inscrit) 14%, transparent);
    color: var(--inscrit-texte);
    font-weight: 600;
  }

  /* Le dosage n'apparait qu'avec un fond actif : il n'occupe donc de place que
     lorsqu'il en a une a regler. */
  .dosage {
    display: flex;
    align-items: center;
    gap: 7px;
    white-space: nowrap;
    color: var(--texte-faible);
  }

  .dosage input {
    width: 84px;
    accent-color: var(--inscrit);
    cursor: pointer;
  }

  /* Largeur fixe : sans elle, passer de « 5 % » a « 100 % » decale toute la
     legende a chaque cran du curseur. */
  .dosage output {
    min-width: 34px;
    font-variant-numeric: tabular-nums;
    color: var(--texte-moyen);
  }

  /* Les commandes MapLibre s'ecartent des deux calques, comme la legende : la
     boussole et le zoom passaient sous la fiche, l'attribution sous le tiroir.
     Les deux variables sont posees par la page. */
  .carte :global(.maplibregl-ctrl-bottom-left) {
    left: var(--marge-gauche, 0px);
    transition: left 160ms ease;
  }

  .carte :global(.maplibregl-ctrl-top-right) {
    right: var(--marge-droite, 0px);
    transition: right 160ms ease;
  }

  /* Sur un telephone les cinq tranches d'epoque ne tiennent pas sur une
     ligne : la legende s'enroule et occupe toute la largeur. */
  @media (max-width: 900px) {
    .legende {
      left: 8px;
      right: 8px;
      bottom: 34px;
      gap: 8px 10px;
      border-radius: var(--r-m);
      font-size: 10px;
    }
  }
</style>
