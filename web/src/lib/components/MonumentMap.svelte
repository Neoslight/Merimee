<script lang="ts">
  import maplibregl, {
    type ExpressionSpecification,
    type Map as MapLibreMap
  } from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import { untrack } from 'svelte';
  import type { Point } from '$lib/db/queries';
  import { FONDS, palette, theme } from '$lib/state/theme.svelte';
  import type { VueCarte } from '$lib/state/permalien';

  interface Props {
    points: Point[];
    selection: string | null;
    vueInitiale: VueCarte | null;
    onselect: (reference: string) => void;
    onbbox: (bbox: [number, number, number, number] | null) => void;
  }

  let { points, selection, vueInitiale, onselect, onbbox }: Props = $props();

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

  function geojson(liste: Point[]): GeoJSON.FeatureCollection {
    return {
      type: 'FeatureCollection',
      features: liste.map((p) => ({
        type: 'Feature',
        id: p.reference,
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        properties: {
          reference: p.reference,
          statut: p.statut,
          nb: p.nb_palissy,
          siecle: p.siecle_max
        }
      }))
    };
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

  /**
   * `setStyle` detruit toutes les sources et couches ajoutees : changer de fond
   * de carte veut dire les reposer entierement. D'ou cette fonction, appelee a
   * chaque `style.load` et non une seule fois au montage.
   */
  function poserCouches(map: MapLibreMap, donnees: Point[]) {
    map.addSource('monuments', { type: 'geojson', data: geojson(donnees) });
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
        'circle-stroke-color': palette.carteLiseret,
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 6, 0, 10, 0.6],
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
    // Le theme et la vue de depart sont lus sans dependance : ce sont des
    // conditions initiales. Les suivre ici detruirait et recreerait la carte a
    // chaque bascule, au lieu de lui changer son fond.
    const depart = untrack(() => vueInitiale ?? DEPART);
    const map = new maplibregl.Map({
      container: conteneur,
      // Fond vectoriel sobre servi sans cle d'API.
      style: untrack(() => FONDS[theme.courant]),
      center: [depart.lon, depart.lat],
      zoom: depart.zoom,
      attributionControl: { compact: true },
      // La rotation n'apporte rien a une carte de points et transforme le
      // moindre glissement a deux doigts en desorientation sur telephone.
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

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

    carte = map;
    return () => {
      clearTimeout(minuteur);
      map.remove();
      carte = undefined;
      pret = false;
    };
  });

  // Bascule de fond. `pret` retombe : les effets qui repeuplent la carte
  // attendent que les couches soient reposees plutot que d'ecrire dans le vide.
  let fondPose = untrack(() => theme.courant);

  $effect(() => {
    const choix = theme.courant;
    if (!carte || choix === fondPose) return;
    fondPose = choix;
    pret = false;
    carte.setStyle(FONDS[choix]);
  });

  // Les points arrivent apres chaque changement de filtre : `setData` suffit,
  // la couche et son style restent en place.
  $effect(() => {
    const source = pret ? (carte?.getSource('monuments') as maplibregl.GeoJSONSource) : null;
    source?.setData(geojson(points));
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

  // Semiologie et palette. Les couches sont deja posees avec les bonnes
  // couleurs apres un changement de fond ; cet effet couvre le changement de
  // mode, qui lui ne repose pas les couches.
  $effect(() => {
    if (!pret || !carte) return;
    const expression = couleurs();
    carte.setPaintProperty('monuments-points', 'circle-color', expression);
    carte.setPaintProperty('monuments-halo', 'circle-color', expression);
    carte.setPaintProperty('monuments-points', 'circle-stroke-color', palette.carteLiseret);
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
  <button class="mode" class:actif={mode === 'epoque'}
          onclick={() => (mode = mode === 'statut' ? 'epoque' : 'statut')}
          aria-pressed={mode === 'epoque'} title="Colorer les points par époque de construction">
    {mode === 'epoque' ? 'par époque' : 'par statut'}
  </button>
  <button class:actif={densite} onclick={() => (densite = !densite)}
          aria-pressed={densite} title="Afficher la densité plutôt que les points seuls">
    densité
  </button>
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

  .legende {
    position: absolute;
    left: 12px;
    bottom: 12px;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 7px 12px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--fond) 82%, transparent);
    border: 1px solid var(--bord);
    backdrop-filter: blur(8px);
    font-size: 11px;
    color: var(--texte-faible);
  }

  .legende span {
    display: flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }

  .legende i {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .legende button {
    border: 1px solid var(--bord);
    background: transparent;
    color: var(--texte-faible);
    border-radius: 999px;
    padding: 3px 10px;
    font-size: 11px;
    cursor: pointer;
  }

  .legende button.actif {
    color: var(--accent);
    border-color: var(--accent);
  }

  /* Sur un telephone la legende deborde et vient buter sur l'attribution
     CARTO, qui a sa propre position imposee en bas a droite. Les cinq tranches
     d'epoque n'y tiennent pas sur une ligne : la legende s'enroule. */
  @media (max-width: 900px) {
    .legende {
      left: 8px;
      right: 8px;
      bottom: 34px;
      flex-wrap: wrap;
      gap: 8px 10px;
      border-radius: 10px;
      font-size: 10px;
    }
  }
</style>
