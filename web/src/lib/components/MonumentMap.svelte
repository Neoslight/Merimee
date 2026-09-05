<script lang="ts">
  import maplibregl, {
    type ExpressionSpecification,
    type Map as MapLibreMap
  } from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import type { Point } from '$lib/db/queries';

  interface Props {
    points: Point[];
    selection: string | null;
    onselect: (reference: string) => void;
    onbbox: (bbox: [number, number, number, number] | null) => void;
  }

  let { points, selection, onselect, onbbox }: Props = $props();

  const COULEURS: ExpressionSpecification = [
    'match',
    ['get', 'statut'],
    'classé', '#e0a458',
    'classé+inscrit', '#b07bd4',
    'inscrit', '#4ea8de',
    '#7d8597'
  ];

  let conteneur: HTMLDivElement;
  let carte: MapLibreMap | undefined = $state();
  let pret = $state(false);
  let suivreVue = $state(false);
  let minuteur: ReturnType<typeof setTimeout> | undefined;

  function geojson(liste: Point[]): GeoJSON.FeatureCollection {
    return {
      type: 'FeatureCollection',
      features: liste.map((p) => ({
        type: 'Feature',
        id: p.reference,
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        properties: { reference: p.reference, statut: p.statut, nb: p.nb_palissy }
      }))
    };
  }

  function emettreBbox() {
    if (!carte) return;
    const b = carte.getBounds();
    onbbox([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
  }

  $effect(() => {
    const map = new maplibregl.Map({
      container: conteneur,
      // Fond vectoriel sobre servi sans cle d'API.
      style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
      center: [2.6, 46.6],
      zoom: 4.7,
      attributionControl: { compact: true },
      // La rotation n'apporte rien a une carte de points et transforme le
      // moindre glissement a deux doigts en desorientation sur telephone.
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    map.on('load', () => {
      map.addSource('monuments', { type: 'geojson', data: geojson([]) });
      // Couche de densite, masquee par defaut. Elle repond a ce que 44 000
      // points superposes cachent : au niveau national, la carte de points
      // sature et ne distingue plus une commune riche d'un departement dense.
      map.addLayer({
        id: 'monuments-densite',
        type: 'heatmap',
        source: 'monuments',
        layout: { visibility: 'none' },
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
            0, 'rgba(11, 14, 20, 0)',
            0.2, '#1d3b57',
            0.4, '#4ea8de',
            0.65, '#e0a458',
            1, '#f4f1ea'
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
          'circle-color': COULEURS,
          'circle-opacity': 0.14,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 7, 12, 26]
        }
      });
      map.addLayer({
        id: 'monuments-points',
        type: 'circle',
        source: 'monuments',
        paint: {
          'circle-color': COULEURS,
          'circle-opacity': 0.82,
          'circle-stroke-color': '#0b0e14',
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
        filter: ['==', ['get', 'reference'], ''],
        paint: {
          'circle-color': 'transparent',
          'circle-stroke-color': '#f4f1ea',
          'circle-stroke-width': 2,
          'circle-radius': 11
        }
      });
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
  let densite = $state(false);

  $effect(() => {
    if (!pret || !carte) return;
    carte.setLayoutProperty('monuments-densite', 'visibility', densite ? 'visible' : 'none');
    carte.setPaintProperty('monuments-points', 'circle-opacity', densite ? 0.12 : 0.82);
    carte.setPaintProperty('monuments-halo', 'circle-opacity', densite ? 0 : 0.14);
  });

  function basculerSuivi() {
    suivreVue = !suivreVue;
    if (suivreVue) emettreBbox();
    else onbbox(null);
  }
</script>

<div class="carte" bind:this={conteneur}></div>

<div class="legende">
  <span><i style="background:#e0a458"></i>classé</span>
  <span><i style="background:#4ea8de"></i>inscrit</span>
  <span><i style="background:#b07bd4"></i>les deux</span>
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
     CARTO, qui a sa propre position imposee en bas a droite. */
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
