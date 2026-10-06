<script lang="ts">
  import maplibregl, {
    type ExpressionSpecification,
    type Map as MapLibreMap
  } from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import { untrack } from 'svelte';
  import { fondPour, palette, theme } from '$lib/state/theme.svelte';
  import { mesures } from '$lib/state/mesures.svelte';
  import { etatCarte, oublierTeinture } from '$lib/state/carte.svelte';
  import { erreurDepuisCode, position } from '$lib/state/position.svelte';
  import { teinter } from '$lib/teinte';
  import { SUPERPOSITIONS, tuiles } from '$lib/carte/fonds';
  import { TRANCHES, type Mode } from '$lib/carte/semiologie';
  import {
    decalage,
    devoilePosition,
    DUREE_VOL,
    estVisible,
    margesDepart,
    METROPOLE,
    SANS_MARGE,
    ZOOM_EDIFICE,
    ZOOM_PROCHE,
    type Marges
  } from '$lib/carte/camera';
  import type { Etiquette } from '$lib/db/queries';
  import type { FondHistorique, VueCarte } from '$lib/state/permalien';

  interface Props {
    /** Nuage deja en GeoJSON : `queries.points()` le construit depuis les
     *  vecteurs Arrow, la carte n'a plus qu'a le poser. */
    points: GeoJSON.FeatureCollection;
    selection: string | null;
    vueInitiale: VueCarte | null;
    /** Fond superpose — photo aerienne ou carte ancienne. Choisi dans le
     *  panneau des calques ; la page le possede, elle seule ecrit l'URL. */
    fond: FondHistorique | null;
    /** Opacite du fond superpose, en pourcent. Dosage de lecture, hors URL. */
    opaciteFond: number;
    /** Semiologie des points, et la carte de chaleur qui la remplace. Choisies
     *  dans le panneau des calques, nommees par la legende : la carte ne fait
     *  que les peindre. */
    mode: Mode;
    densite: boolean;
    /** Restreindre les filtres a la zone visible. La case qui le commande est
     *  dans le tiroir des filtres — c'en est un — donc l'etat vit dans la page,
     *  seule a posseder `filters.bbox`. */
    suivreVue: boolean;
    /** Ce que les panneaux ouverts masquent sur chaque bord de la carte, en
     *  pixels : la fiche, le tiroir pose a cote, la feuille du telephone. Un
     *  point choisi qui tomberait dessous est ramene dans la part visible — on
     *  toucherait sinon un monument pour ne plus le voir. */
    marges?: Marges;
    /** Nom et commune d'une notice, pour l'infobulle de survol. Fournie par la
     *  page : la carte ne connait pas DuckDB, elle ne recoit que des points. */
    etiquette?: (reference: string) => Promise<Etiquette | null>;
    /** Couche Architecture contemporaine remarquable affichee. Liee a la page,
     *  qui l'ecrit dans l'URL. Hors du filtrage croise : aucun filtre ne s'y
     *  applique. */
    acr?: boolean;
    /** Nuage de la couche, `null` tant qu'elle n'a jamais ete affichee. */
    pointsAcr?: GeoJSON.FeatureCollection | null;
    onselect: (reference: string) => void;
    onbbox: (bbox: [number, number, number, number] | null) => void;
  }

  let {
    points,
    selection,
    vueInitiale,
    fond,
    opaciteFond,
    mode,
    densite,
    suivreVue = $bindable(),
    marges = SANS_MARGE,
    etiquette,
    acr = false,
    pointsAcr = null,
    onselect,
    onbbox
  }: Props = $props();

  const VIDE: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

  /** Bouton « France entiere », dans le langage des commandes natives : meme
   *  groupe, meme icone en masque peinte par jeton (`app.css`). */
  class ControleAccueil implements maplibregl.IControl {
    groupe: HTMLElement | undefined;
    rentrer: () => void;
    constructor(rentrer: () => void) {
      this.rentrer = rentrer;
    }
    onAdd(): HTMLElement {
      const groupe = document.createElement('div');
      groupe.className = 'maplibregl-ctrl maplibregl-ctrl-group';
      const bouton = document.createElement('button');
      bouton.type = 'button';
      bouton.className = 'maplibregl-ctrl-accueil';
      bouton.title = 'Revenir à la France entière';
      bouton.setAttribute('aria-label', 'Revenir à la France entière');
      const icone = document.createElement('span');
      icone.className = 'maplibregl-ctrl-icon';
      icone.setAttribute('aria-hidden', 'true');
      bouton.append(icone);
      bouton.addEventListener('click', this.rentrer);
      groupe.append(bouton);
      this.groupe = groupe;
      return groupe;
    }
    onRemove(): void {
      this.groupe?.remove();
    }
  }

  /** Couches interrogees au toucher : la couche ACR n'y entre que visible —
   *  `queryRenderedFeatures` ignore deja une couche masquee, mais la nommer
   *  avant qu'elle existe leverait. */
  function couchesTouchables(map: MapLibreMap): string[] {
    return acr && map.getLayer('acr-points')
      ? ['monuments-points', 'acr-points']
      : ['monuments-points'];
  }

  let conteneur: HTMLDivElement;
  let carte: MapLibreMap | undefined = $state();
  let pret = $state(false);
  let minuteur: ReturnType<typeof setTimeout> | undefined;

  /**
   * Feuille de style effectivement demandee a MapLibre.
   *
   * Un simple `let`, pas un `$state` : l'effet de bascule la lit **et**
   * l'ecrit, et un etat reactif le ferait boucler sur lui-meme. C'est aussi ce
   * qui desamorce le montage — le constructeur vient de poser cette feuille,
   * l'effet doit constater qu'il n'a rien a faire plutot que de la
   * retelecharger.
   */
  let fondPose = untrack(() => fondPour(theme.courant));

  /**
   * Tolerance du toucher, en pixels autour du point de contact.
   *
   * Un point mesure 1,2 a 4,5 px de rayon jusqu'a z10 : au doigt, dont la
   * pulpe couvre une dizaine de pixels CSS et masque ce qu'elle vise, toucher
   * le pixel exact relevait du hasard. La souris, elle, vise juste — une marge
   * large lui ferait ouvrir le voisin de ce qu'elle pointe.
   */
  const TOLERANCE_DOIGT = 16;
  const TOLERANCE_SOURIS = 6;

  /** Sous ce zoom, un toucher qui couvre plus de `AMAS` points rapproche la
   *  vue au lieu d'ouvrir l'un d'eux : dans un amas, le plus proche du doigt
   *  n'est pas celui qu'on voulait, c'est celui que le hasard a mis la. */
  const ZOOM_AMAS = 9;
  const AMAS = 3;

  /** Au-dela de cette opacite, l'aplat beige de la carte ancienne l'emporte sur
   *  le sol, quel qu'il soit — ardoise en sombre, grege en clair — et le lisere,
   *  qui vaut precisement ce sol, s'y efface. */
  const BASCULE_LISERET = 50;

  /**
   * Rayon des points. A l'echelle nationale, 44 484 pastilles de 2 px pleines
   * bouchent une carte claire : le point tombe sous 1,5 px et c'est la
   * **superposition** qui dessine les zones denses. Il s'ouvre des que le zoom
   * separe les pastilles, la ou l'on cherche un edifice et non une masse.
   *
   * Les edifices tres riches en mobilier Palissy gardent leur cran d'avance,
   * ramene de 2,1x a 2,5x : plus, et la trentaine de sites concernes seraient
   * les seuls objets lisibles d'une carte volontairement pale.
   */
  const RAYON = [
    'interpolate', ['linear'], ['zoom'],
    4, ['case', ['>', ['get', 'nb'], 200], 3, 1.2],
    7, ['case', ['>', ['get', 'nb'], 200], 3.6, 1.5],
    10, ['case', ['>', ['get', 'nb'], 200], 9, 4.5],
    14, ['case', ['>', ['get', 'nb'], 200], 16, 8]
  ] as unknown as ExpressionSpecification;

  /**
   * Opacite des points, et **du meme coup celle de leur lisere** :
   * `circle-stroke-opacity` vaut 1 par defaut et ne suit pas `circle-opacity`.
   * Un remplissage a 0,42 sous un lisere opaque donnerait des anneaux creux.
   *
   * L'opacite basse ne vaut qu'a l'echelle nationale : un edifice isole n'y
   * ressort qu'a 1,6:1 sur la terre gregee, ce qui ne suffit pas a le trouver.
   * A z8, 0,60 le porte a 2,1:1. Un litteral serait plus court et faux.
   */
  const OPACITE = [
    'interpolate', ['linear'], ['zoom'], 4, 0.42, 8, 0.6, 11, 0.85
  ] as unknown as ExpressionSpecification;

  /** Sous la densite les points restent en filigrane : ils demeurent la couche
   *  interactive, les masquer supprimerait le clic vers la fiche. */
  const opacitePoints = () => (densite ? 0.12 : OPACITE);

  /** Rampe de densite. Extraite pour que la pose et l'effet de palette lisent
   *  la meme chose : posee seule, elle restait sur l'ancien theme apres une
   *  bascule — la claire et la sombre vont pourtant en sens inverse. */
  function rampeChaleur(): ExpressionSpecification {
    return [
      'interpolate', ['linear'], ['heatmap-density'],
      0, palette.chaleur0,
      0.2, palette.chaleur1,
      0.4, palette.chaleur2,
      0.65, palette.chaleur3,
      1, palette.chaleur4
    ] as unknown as ExpressionSpecification;
  }

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
   *  jamais ecrite dans l'URL vivante, qui clignoterait a chaque deplacement.
   *
   *  Nulle aussi quand elle montrerait ou se tient l'utilisateur : apres « Me
   *  localiser », la carte est centree sur lui, et un lien copie ne doit pas
   *  le dire (`devoilePosition`). */
  export function vueCourante(): VueCarte | null {
    if (!carte) return null;
    const b = carte.getBounds();
    const bornes = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] as const;
    if (devoilePosition(carte.getZoom(), bornes, position.courante)) return null;
    const c = carte.getCenter();
    return {
      lon: Math.round(c.lng * 1000) / 1000,
      lat: Math.round(c.lat * 1000) / 1000,
      zoom: Math.round(carte.getZoom() * 10) / 10
    };
  }

  /**
   * Le lien entre la case du tiroir et la contrainte de zone.
   *
   * La lier pose la zone courante, la delier la retire — y compris quand la
   * page eteint `suivreVue` parce que la puce « zone visible » a ete retiree
   * ailleurs. Sans cette derniere branche, le prochain `moveend` reposerait
   * aussitot la bbox que l'on vient d'enlever.
   */
  $effect(() => {
    if (suivreVue) emettreBbox();
    else onbbox(null);
  });

  /**
   * Toutes les sources et couches ajoutees, en un seul endroit.
   *
   * Le fond suit de nouveau le theme, donc `setStyle` est de nouveau appele, et
   * il **detruit** l'ensemble de ce qui a ete ajoute. `style.load` est le seul
   * evenement qui couvre le montage **et** chaque echange de feuille. Les fonds
   * historiques, poses ici, en dependent autant que les monuments.
   */
  function poserCouches(map: MapLibreMap, donnees: GeoJSON.FeatureCollection) {
    // **Avant tout `addLayer`** : `teinter` parcourt `map.getStyle().layers`, ou
    // nos propres couches figureraient une fois posees. Repeindre
    // `monuments-points` en couleur de terre serait la panne la plus bete du
    // dispositif. En sombre on ne repeint pas : dark-matter est deja la carte
    // que le projet veut, l'aplatir a l'identique serait deux cents appels pour
    // rien — c'est une dissymetrie voulue, pas un oubli.
    if (theme.courant === 'clair') etatCarte.teinture = teinter(map, palette);
    else oublierTeinture();

    // Les fonds superposes se posent **avant** les couches de monuments :
    // MapLibre empile dans l'ordre d'ajout, le raster se retrouve donc entre le
    // fond CARTO et les points, jamais au-dessus. La photo aerienne descend en
    // plus sous les libelles du plan (`beforeId` sur le premier `symbol`) :
    // c'est la vue « hybride ». Les cartes anciennes, elles, restent au-dessus
    // — elles portent leur propre toponymie, deux ecritures se brouilleraient.
    const premierLibelle = map.getStyle().layers.find((couche) => couche.type === 'symbol')?.id;
    for (const h of SUPERPOSITIONS) {
      map.addSource(`fond-${h.cle}`, {
        type: 'raster',
        tiles: [tuiles(h)],
        tileSize: 256,
        // Sans ce plafond, la couche disparait au-dela de sa resolution reelle.
        maxzoom: h.zoomMax,
        attribution: h.attribution
      });
      map.addLayer(
        {
          id: `fond-${h.cle}`,
          type: 'raster',
          source: `fond-${h.cle}`,
          layout: { visibility: fond === h.cle ? 'visible' : 'none' },
          paint: { 'raster-opacity': opaciteFond / 100 }
        },
        h.sousLibelles ? premierLibelle : undefined
      );
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
        'heatmap-color': rampeChaleur()
      }
    });
    map.addLayer({
      id: 'monuments-points',
      type: 'circle',
      source: 'monuments',
      paint: {
        'circle-color': couleurs(),
        'circle-opacity': opacitePoints(),
        'circle-stroke-color': liseret(),
        'circle-stroke-opacity': opacitePoints(),
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 6, 0, 9, 0.5, 13, 1.8],
        'circle-radius': RAYON
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

    // Couche ACR, **au-dessus** des monuments : 1 743 points parmi 44 484, ils
    // disparaitraient dessous. Posee meme masquee, pour que la bascule ne soit
    // qu'un `setLayoutProperty` et survive a un `setStyle` du theme.
    map.addSource('acr', { type: 'geojson', data: untrack(() => pointsAcr) ?? VIDE });
    map.addLayer({
      id: 'acr-points',
      type: 'circle',
      source: 'acr',
      layout: { visibility: acr ? 'visible' : 'none' },
      paint: {
        'circle-color': palette.acr,
        // Plus opaques et plus larges que les monuments a l'echelle nationale :
        // une couche que l'on vient d'allumer doit se voir, et elle est cent
        // fois moins dense.
        'circle-opacity': ['interpolate', ['linear'], ['zoom'], 4, 0.8, 10, 0.95],
        'circle-stroke-color': liseret(),
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 4, 0.6, 9, 1, 13, 2],
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 2.4, 7, 3, 10, 5.5, 14, 9]
      }
    });
    map.addLayer({
      id: 'acr-selection',
      type: 'circle',
      source: 'acr',
      layout: { visibility: acr ? 'visible' : 'none' },
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
    //
    // Sans vue portee par le lien, la carte cadre la metropole : une emprise,
    // et non un centre et un zoom, qui ne valaient que pour un ecran large.
    const depart = untrack(() => vueInitiale);
    const map = new maplibregl.Map({
      container: conteneur,
      style: fondPose,
      ...(depart
        ? { center: [depart.lon, depart.lat] as [number, number], zoom: depart.zoom }
        : {
            bounds: [...METROPOLE] as [number, number, number, number],
            fitBoundsOptions: { padding: margesDepart(conteneur.clientWidth) }
          }),
      // L'attribution est posee a la main, en bas a **droite** : a gauche, sa
      // pastille « i » se posait sur la legende. La fiche, qui l'en avait
      // chassee, ne la recouvre plus — `--marge-droite` l'ecarte.
      attributionControl: false,
      // Sans plafond, MapLibre suit `devicePixelRatio` : sur un telephone a 3x,
      // le canevas compose neuf fois les pixels CSS a chaque image de
      // deplacement, pour 44 484 cercles a lisere. Deux suffisent — l'ecart
      // visible est marginal, le fill-rate economise ne l'est pas.
      pixelRatio: Math.min(window.devicePixelRatio ?? 1, 2),
      // La rotation n'apporte rien a une carte de points et transforme le
      // moindre glissement a deux doigts en desorientation sur telephone.
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      // Seuls les libelles de la geolocalisation sont traduits : ceux du zoom
      // restent ceux de MapLibre, que la suite e2e et l'audit lisent deja.
      locale: {
        'GeolocateControl.FindMyLocation': 'Me localiser',
        'GeolocateControl.LocationNotAvailable': 'Position non disponible'
      }
    });

    // Releve pour Playwright, publie sur `window` comme `__carte` : les points
    // rendus en coordonnees **de page**, seul moyen de toucher un monument
    // precis sans connaitre la projection. Rien n'y ecrit, rien ne le lit en
    // production.
    (window as unknown as { __carteOutils: unknown }).__carteOutils = {
      rendus: () => {
        if (!map.getLayer('monuments-points')) return [];
        const boite = conteneur.getBoundingClientRect();
        return map.queryRenderedFeatures({ layers: ['monuments-points'] }).map((f) => {
          const p = map.project((f.geometry as GeoJSON.Point).coordinates as [number, number]);
          return { reference: f.properties?.reference, x: boite.left + p.x, y: boite.top + p.y };
        });
      },
      rendusAcr: () => {
        if (!map.getLayer('acr-points')) return [];
        const boite = conteneur.getBoundingClientRect();
        return map.queryRenderedFeatures({ layers: ['acr-points'] }).map((f) => {
          const p = map.project((f.geometry as GeoJSON.Point).coordinates as [number, number]);
          return { reference: f.properties?.reference, x: boite.left + p.x, y: boite.top + p.y };
        });
      },
      zoom: () => map.getZoom(),
      centre: () => map.getCenter().toArray(),
      bornes: () => map.getBounds().toArray().flat(),
      enMouvement: () => map.isMoving(),
      // Position a l'ecran d'une coordonnee, en pixels de page.
      projeter: (lon: number, lat: number) => {
        const boite = conteneur.getBoundingClientRect();
        const p = map.project([lon, lat]);
        return { x: boite.left + p.x, y: boite.top + p.y };
      }
    };
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    // Revenir a la France entiere : apres un vol ou trois zooms, le geste que
    // l'on cherche sans le trouver. Meme cadrage qu'au depart, marges des
    // panneaux ouverts comprises.
    map.addControl(
      new ControleAccueil(() => {
        const depart = margesDepart(conteneur.clientWidth);
        map.fitBounds([...METROPOLE] as [number, number, number, number], {
          padding: {
            top: depart.top + marges.top,
            bottom: depart.bottom + marges.bottom,
            left: depart.left + marges.left,
            right: depart.right + marges.right
          }
        });
      }),
      'top-right'
    );
    // Sous le zoom, dans la meme colonne : c'est un outil de cadrage, comme
    // lui. Le controle natif porte deja le point, le cercle de precision, le
    // suivi et l'etat de permission — le reecrire n'apporterait qu'un bouton
    // de plus a maintenir. Ses couleurs sont reprises dans `app.css`.
    const geoloc = new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true, timeout: 15_000 },
      trackUserLocation: true,
      showAccuracyCircle: true,
      fitBoundsOptions: { maxZoom: 14 }
    });
    map.addControl(geoloc, 'top-right');
    // L'evenement MapLibre recopie les champs de la position (ou de l'erreur)
    // sur lui-meme : `coords` et `code` y sont directement.
    geoloc.on('geolocate', (event) => {
      const { coords } = event as unknown as GeolocationPosition;
      position.courante = { lon: coords.longitude, lat: coords.latitude, precision: coords.accuracy };
      position.erreur = null;
    });
    geoloc.on('error', (event) => {
      position.erreur = erreurDepuisCode((event as unknown as GeolocationPositionError).code);
    });

    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    // Trois deplacements animes existent : le rapprochement sur un amas
    // touche, le cadrage du controle de geolocalisation (`fitBounds`), et le
    // recentrage d'un point passe sous la feuille de fiche. **Aucun ne passe
    // `essential: true`**, et le controle natif non plus (verifie dans sa
    // source, 4.7.1) : MapLibre lit alors `prefers-reduced-motion` lui-meme a
    // chaque appel et ramene la duree a zero — c'est deja le mouvement reduit
    // demande, sans code a ecrire ici. « Au hasard » continue d'ouvrir une
    // fiche sans toucher au cadrage.

    // `style.load` se declenche au montage **et** apres chaque `setStyle` :
    // c'est le seul evenement qui couvre les deux.
    map.on('style.load', () => {
      poserCouches(map, untrack(() => points));
      pret = true;
    });

    // Infobulle de survol, au pointeur fin seulement : au doigt il n'y a pas de
    // survol, le toucher ouvre la fiche. Le nuage ne porte que la reference ;
    // le nom vient d'une requete, retardee de 120 ms pour qu'un balayage de la
    // carte n'en emette pas une par point traverse, et gardee en memoire.
    //
    // Le contenu passe par `textContent` et `setDOMContent`, jamais `setHTML` :
    // un titre de notice est une donnee, et `setHTML` est le chemin de l'avis
    // GHSA-jrc7-96c5-q579 qui pese sur maplibre-gl 4.x.
    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 12,
      className: 'infobulle'
    });
    const pointeurFin = window.matchMedia('(hover: hover) and (pointer: fine)');
    const etiquettes = new Map<string, Etiquette | null>();
    let survolee: string | null = null;
    let jetonSurvol = 0;
    map.on('mouseenter', 'monuments-points', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mousemove', 'monuments-points', (event) => {
      const entite = event.features?.[0];
      const ref = entite?.properties?.reference;
      if (!etiquette || !pointeurFin.matches || typeof ref !== 'string' || ref === survolee) return;
      survolee = ref;
      const mien = ++jetonSurvol;
      const ou = (entite!.geometry as GeoJSON.Point).coordinates as [number, number];
      setTimeout(async () => {
        if (mien !== jetonSurvol) return;
        if (!etiquettes.has(ref)) etiquettes.set(ref, await etiquette(ref).catch(() => null));
        const nom = etiquettes.get(ref);
        if (mien !== jetonSurvol || !nom) return;
        const noeud = document.createElement('div');
        const titre = document.createElement('b');
        titre.textContent = nom.titre;
        const lieu = document.createElement('span');
        lieu.textContent = nom.commune;
        noeud.append(titre, lieu);
        popup.setLngLat(ou).setDOMContent(noeud).addTo(map);
      }, 120);
    });
    map.on('mouseleave', 'monuments-points', () => {
      map.getCanvas().style.cursor = '';
      survolee = null;
      jetonSurvol += 1;
      popup.remove();
    });
    map.on('mouseenter', 'acr-points', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'acr-points', () => (map.getCanvas().style.cursor = ''));
    // Clic sur la carte entiere, et non sur la couche : l'ecouteur de couche ne
    // repond qu'au pixel exact d'un cercle. On interroge une boite autour du
    // contact et on retient le point le plus proche **a l'ecran** — l'ordre
    // rendu par `queryRenderedFeatures` est celui du dessin, pas de la distance.
    const doigt = window.matchMedia('(pointer: coarse)');
    map.on('click', (event) => {
      if (!map.getLayer('monuments-points')) return;
      const r = doigt.matches ? TOLERANCE_DOIGT : TOLERANCE_SOURIS;
      const { x, y } = event.point;
      const touches = map.queryRenderedFeatures(
        [[x - r, y - r], [x + r, y + r]],
        { layers: couchesTouchables(map) }
      );
      // Une source GeoJSON peut rendre la meme entite sur deux tuiles voisines.
      const vus = new Set<string>();
      let retenue: string | null = null;
      let meilleure = Infinity;
      for (const entite of touches) {
        const ref = entite.properties?.reference;
        if (typeof ref !== 'string' || vus.has(ref)) continue;
        vus.add(ref);
        const [lon, lat] = (entite.geometry as GeoJSON.Point).coordinates;
        const p = map.project([lon, lat]);
        const d = (p.x - x) ** 2 + (p.y - y) ** 2;
        if (d < meilleure) {
          meilleure = d;
          retenue = ref;
        }
      }
      if (!retenue) return;
      if (doigt.matches && vus.size > AMAS && map.getZoom() < ZOOM_AMAS) {
        map.easeTo({ center: event.lngLat, zoom: Math.min(map.getZoom() + 2, ZOOM_AMAS) });
        return;
      }
      // L'infobulle nommait le point ; la fiche qui s'ouvre le fait mieux, et
      // l'epingle se pose exactement la ou elle est.
      popup.remove();
      onselect(retenue);
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
      epingle = undefined;
      pret = false;
    };
  });

  // Les points arrivent apres chaque changement de filtre : `setData` suffit,
  // la couche et son style restent en place.
  //
  // `pret` etant une dependance, cet effet se rejoue aussi apres chaque
  // `setStyle`, et repose alors des points que `poserCouches` vient de poser :
  // 15 ms de `setData` en apparence gratuites. **Ne pas les economiser.**
  // Mesure : avec un garde `points === dernierNuagePose`, la source reste sur
  // le chargement pendant ouvert par `addSource` ; deux bascules de theme
  // rapprochees la retirent en plein vol et MapLibre remonte
  // « AbortError: signal is aborted without reason » en console. Le `setData`
  // redondant, lui, supersede ce chargement et l'annulation reste interne.
  // Trois verifications tombent sans lui — dont `deux bascules rapides ne
  // laissent qu un style`, ecrite exactement pour ce cas.
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
    carte?.setFilter('acr-selection', ['==', ['get', 'reference'], selection ?? '']);
  });

  // Couche ACR : meme regle que le `setData` des monuments ci-dessus, `pret`
  // en premiere lecture pour se rejouer apres un `setStyle`.
  $effect(() => {
    const source = pret ? (carte?.getSource('acr') as maplibregl.GeoJSONSource) : null;
    if (!source) return;
    source.setData(pointsAcr ?? VIDE);
  });

  $effect(() => {
    if (!pret || !carte) return;
    const visibilite = acr ? 'visible' : 'none';
    carte.setLayoutProperty('acr-points', 'visibility', visibilite);
    carte.setLayoutProperty('acr-selection', 'visibility', visibilite);
  });

  // --- Camera ----------------------------------------------------------------
  // Tout ce qui deplace la vue vers une notice passe par ici. Les calculs —
  // ce qui est visible, ou viser — sont dans `lib/carte/camera.ts`.

  /** Coordonnees d'une notice, lues dans le nuage deja charge : aucune
   *  requete. Nulles pour une notice hors filtre ou sans coordonnees. */
  function coordonnees(reference: string): [number, number] | null {
    const trouvee =
      points.features.find((f) => f.properties?.reference === reference) ??
      pointsAcr?.features.find((f) => f.properties?.reference === reference);
    return trouvee ? ((trouvee.geometry as GeoJSON.Point).coordinates as [number, number]) : null;
  }

  // Recentrage sous un panneau. Il ne part que si le point choisi est hors de
  // la part visible : ouvrir un monument deja bien place ne doit pas deplacer
  // la carte, et passer d'un voisin a l'autre non plus. Il rejoue quand les
  // marges changent — la fiche qui s'ouvre, le tiroir qui se pose — mais le
  // nuage est lu sans dependance : un filtre qui le remplace ne doit pas
  // rejouer le cadrage.
  $effect(() => {
    const ref = selection;
    const masque = marges;
    if (!pret || !carte || !ref) return;
    const map = carte;
    untrack(() => {
      const ou = coordonnees(ref);
      if (!ou) return;
      if (estVisible(map.project(ou), conteneur.clientWidth, conteneur.clientHeight, masque)) return;
      map.easeTo({ center: ou, offset: decalage(masque) });
    });
  });

  // Un lien `?ref=` sans `c=` s'ouvre sur la notice, pas sur la France : c'est
  // elle qu'on a partagee. Une seule fois, au depart, et sans animation — le
  // nuage arrivant apres la carte, l'effet attend qu'il porte la notice. Il se
  // desarme si la selection a change entre-temps.
  let departCadre = untrack(() => vueInitiale !== null || selection === null);
  const selectionDepart = untrack(() => selection);

  $effect(() => {
    if (departCadre || !pret || !carte) return;
    if (untrack(() => selection) !== selectionDepart || !selectionDepart) {
      departCadre = true;
      return;
    }
    const ou = coordonnees(selectionDepart);
    if (!ou) return;
    departCadre = true;
    carte.easeTo({ center: ou, zoom: ZOOM_EDIFICE, offset: decalage(untrack(() => marges)), duration: 0 });
  });

  /**
   * Rapproche la vue d'une notice choisie **ailleurs que sur la carte** — une
   * ligne de liste. A l'echelle nationale, ouvrir sa fiche laissait la carte
   * ou elle etait : rien ne disait ou se trouve l'edifice. Toucher un point de
   * la carte, lui, ne deplace rien : on voit deja ou il est.
   *
   * `anime` est faux quand la carte est masquee par une autre vue : un vol que
   * personne ne regarde ne vaut pas ses images.
   */
  export function approcher(reference: string, anime: boolean): void {
    const map = carte;
    if (!map || !pret) return;
    const ou = coordonnees(reference);
    if (!ou) return;
    // Deja a l'echelle d'une ville : on garde ce zoom, et on ne bouge que si
    // l'edifice est hors champ. `flyTo` plutot qu'`easeTo` — la notice
    // suivante d'une liste peut etre a l'autre bout du pays, et un glissement
    // en ligne droite a z12 chargerait toutes les tuiles du trajet.
    const proche = map.getZoom() >= ZOOM_PROCHE;
    if (proche && estVisible(map.project(ou), conteneur.clientWidth, conteneur.clientHeight, marges)) return;
    map.flyTo({
      center: ou,
      zoom: proche ? map.getZoom() : ZOOM_EDIFICE,
      offset: decalage(marges),
      ...(anime ? {} : { duration: 0 })
    });
  }

  /**
   * Le vol de « Au hasard » : recul jusqu'a la France entiere, puis descente
   * vers l'edifice. `minZoom` donne le sommet de la trajectoire, MapLibre
   * calcule l'arc. La promesse se resout a l'arrivee — ou tout de suite si le
   * vol n'a pas lieu.
   *
   * **Jamais `essential: true`** : sous `prefers-reduced-motion`, MapLibre
   * remplace alors le vol par un saut, et c'est le comportement voulu.
   *
   * `reserve` est ce que la fiche masquera **a l'arrivee** : elle n'est pas
   * encore ouverte quand le vol part.
   *
   * Un fond historique est suspendu le temps du vol : la trajectoire traverse
   * une dizaine de niveaux de zoom, et Cassini pese ~170 Ko la tuile.
   */
  export function survoler(lon: number, lat: number, reserve: Marges): Promise<void> {
    const map = carte;
    if (!map || !pret) return Promise.resolve();
    const recul =
      map.cameraForBounds([...METROPOLE] as [number, number, number, number], {
        padding: margesDepart(conteneur.clientWidth)
      })?.zoom ?? 5;
    const suspendu = fond;
    if (suspendu) map.setLayoutProperty(`fond-${suspendu}`, 'visibility', 'none');
    map.flyTo({
      center: [lon, lat],
      zoom: ZOOM_EDIFICE,
      minZoom: recul,
      offset: decalage(reserve),
      duration: DUREE_VOL
    });
    return new Promise((resoudre) => {
      const arrivee = () => {
        if (suspendu && fond === suspendu && map.getLayer(`fond-${suspendu}`)) {
          map.setLayoutProperty(`fond-${suspendu}`, 'visibility', 'visible');
        }
        resoudre();
      };
      // L'ecouteur se pose **apres** `flyTo` : celui-ci commence par arreter le
      // mouvement en cours, ce qui emet un `moveend` qui n'est pas le sien. Et
      // sous mouvement reduit le saut est deja fini a ce point : il n'y aura
      // pas d'autre `moveend` a attendre.
      if (map.isMoving()) map.once('moveend', arrivee);
      else arrivee();
    });
  }

  // Epingle de la notice choisie. L'anneau de 11 px disait quel point, pas ou
  // regarder : a l'echelle d'une ville il se perdait parmi ses voisins. C'est
  // un `Marker` — du DOM, peint par jetons dans `app.css` — qui survit donc a
  // `setStyle` sans passer par `poserCouches`.
  let epingle: maplibregl.Marker | undefined;

  function creerEpingle(): HTMLElement {
    const noeud = document.createElement('div');
    noeud.className = 'epingle';
    noeud.innerHTML =
      '<svg viewBox="0 0 26 34" aria-hidden="true">' +
      '<path fill="currentColor" d="M13 0C5.8 0 0 5.7 0 12.8 0 22 13 34 13 34s13-12 13-21.2C26 5.7 20.2 0 13 0z"/>' +
      '<circle cx="13" cy="12.6" r="4.6"/></svg>';
    return noeud;
  }

  $effect(() => {
    const map = carte;
    const ref = selection;
    if (!map) return;
    const ou = ref ? coordonnees(ref) : null;
    if (!ou) {
      epingle?.remove();
      return;
    }
    epingle ??= new maplibregl.Marker({ element: creerEpingle(), anchor: 'bottom' });
    epingle.setLngLat(ou).addTo(map);
  });

  // Les points restent la couche interactive : les masquer sous la densite
  // supprimerait le clic vers la fiche, on les garde en filigrane.
  //
  // Cet effet doit reposer **l'expression**, pas un scalaire : un litteral
  // ecraserait l'interpolation par zoom des la premiere bascule de densite, et
  // les points redeviendraient opaques a l'echelle nationale, definitivement.
  $effect(() => {
    if (!pret || !carte) return;
    carte.setLayoutProperty('monuments-densite', 'visibility', densite ? 'visible' : 'none');
    carte.setPaintProperty('monuments-points', 'circle-opacity', opacitePoints());
    carte.setPaintProperty('monuments-points', 'circle-stroke-opacity', opacitePoints());
  });

  // Fonds superposes : visibilite et dosage. Un seul a la fois — empiler
  // Cassini sur l'etat-major ne donne qu'une bouillie, pour le double du
  // transfert.
  $effect(() => {
    if (!pret || !carte) return;
    for (const h of SUPERPOSITIONS) {
      carte.setLayoutProperty(`fond-${h.cle}`, 'visibility', fond === h.cle ? 'visible' : 'none');
      carte.setPaintProperty(`fond-${h.cle}`, 'raster-opacity', opaciteFond / 100);
    }
  });

  // Le lisere clair des points s'efface sur un aplat beige : il bascule au
  // sombre des que la carte ancienne l'emporte. Il a son propre effet, et ce
  // n'est pas un rangement : `liseret()` croise le fond pose et la palette, or
  // le loger dans l'un des deux autres effets fait chaque fois du tort.
  // Dans celui de la palette, le curseur d'opacite du fond devenait
  // declencheur de deux `circle-color` **data-driven** sur 44 484 points.
  // Dans celui des fonds, la palette devenait dependance, et une bascule de
  // theme rejouait `setLayoutProperty` sur les couches raster : les tuiles
  // repartaient, le `setStyle` suivant les annulait, et l'AbortError
  // remontait en console. Seul, il ne pose qu'une couleur scalaire.
  $effect(() => {
    if (!pret || !carte) return;
    carte.setPaintProperty('monuments-points', 'circle-stroke-color', liseret());
    carte.setPaintProperty('acr-points', 'circle-stroke-color', liseret());
  });

  // Semiologie et palette : cet effet couvre la bascule de theme comme le
  // changement de mode.
  //
  // La rampe de densite en fait partie, et c'est un correctif : posee seulement
  // par `poserCouches`, elle restait sur l'ancien theme tant qu'on ne rechargeait
  // pas la feuille. Elle doit suivre le theme par un chemin qui lui est propre,
  // sans dependre du fait que la bascule repose les couches.
  $effect(() => {
    if (!pret || !carte) return;
    const expression = couleurs();
    carte.setPaintProperty('monuments-points', 'circle-color', expression);
    // `liseret()` n'est pas appele ici : il lit `fond` et `opaciteFond`, ce qui
    // faisait de chaque pas du curseur d'opacite un declencheur de cet effet —
    // donc deux `circle-color` **data-driven** reecrits sur 44 484 points, pour
    // une couleur inchangee. Il vit dans l'effet des fonds historiques, qui
    // porte deja ces deux dependances.
    carte.setPaintProperty('monuments-selection', 'circle-stroke-color', palette.carteSelection);
    carte.setPaintProperty('acr-points', 'circle-color', palette.acr);
    carte.setPaintProperty('acr-selection', 'circle-stroke-color', palette.carteSelection);
    carte.setPaintProperty('monuments-densite', 'heatmap-color', rampeChaleur());
    etatCarte.chaleurHaute = palette.chaleur4;
  });

  /**
   * Le fond suit le theme.
   *
   * `pret` retombe a faux **avant** l'appel et non dans le rappel : `setStyle`
   * detruit les couches de maniere synchrone, et les effets Svelte sont
   * regroupes en microtache — rien ne s'intercale entre les deux instructions.
   * Un `setPaintProperty` sur une couche disparue leve.
   *
   * `pret` est aussi le signal de **rearmement** : les cinq effets qui touchent
   * une couche le lisent en premiere instruction, ce qui les enregistre comme
   * dependants et les rejoue quand `poserCouches` le remet a vrai. Redondant
   * avec ce que `poserCouches` pose deja, et volontairement : deplacer un
   * `if (!pret)` apres un autre test casserait le rearmement sans qu'aucun test
   * ne bouge.
   */
  $effect(() => {
    const vise = fondPour(theme.courant);
    const map = carte;
    if (!map || vise === fondPose) return;
    fondPose = vise;
    pret = false;
    // `diff: false` n'est pas une precaution, c'est la condition pour que
    // `style.load` se declenche. Par defaut MapLibre **compare** l'ancienne
    // feuille a la nouvelle et n'applique qu'un ecart : la `Style` est
    // conservee, l'evenement n'est pas re-emis, `poserCouches` n'est jamais
    // rappelee et `pret` reste faux pour toujours. Rien ne leve — nos couches
    // survivent au diff, les points continuent de s'afficher — et seul le
    // repeint du fond manque a l'appel. Mesure : sans ce drapeau, la teinture
    // reste a zero et la rampe de densite sur l'ancien theme.
    map.setStyle(vise, { diff: false });
  });
</script>

<div class="carte" bind:this={conteneur}></div>

<style>
  .carte {
    position: absolute;
    inset: 0;
  }

  /* Les commandes descendent en bas a droite, au-dessus de l'attribution, a
     la maniere des cartes en ligne : le haut de la carte appartient a la
     recherche et au theme. Elles sont ajoutees en `top-right` — MapLibre ne
     deplace pas une commande d'un coin a l'autre — et c'est leur conteneur
     qui descend. L'attribution reste au pied, en `bottom-right` : une mention
     de licence masquee n'est pas une mention. */
  .carte :global(.maplibregl-ctrl-top-right) {
    top: auto;
    bottom: 26px;
  }

  /* Sur telephone, la feuille repliee tient le pied de l'ecran : l'attribution
     se pose au-dessus (`--reserve-bas`), et s'efface quand la feuille monte
     (`--legende-visibilite`). Les commandes, elles, remontent sous le bloc de
     recherche, ou rien ne les recouvre. */
  .carte :global(.maplibregl-ctrl-bottom-right) {
    bottom: var(--reserve-bas, 0px);
    visibility: var(--legende-visibilite, visible);
  }

  @media (max-width: 768px) {
    .carte :global(.maplibregl-ctrl-top-right) {
      top: calc(var(--hauteur-haut, 0px) + 10px);
      bottom: auto;
    }
  }

</style>
