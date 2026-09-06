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
  import { teinter } from '$lib/teinte';
  import type { FondHistorique, VueCarte } from '$lib/state/permalien';

  interface Props {
    /** Nuage deja en GeoJSON : `queries.points()` le construit depuis les
     *  vecteurs Arrow, la carte n'a plus qu'a le poser. */
    points: GeoJSON.FeatureCollection;
    selection: string | null;
    vueInitiale: VueCarte | null;
    /** Fond historique superpose. Lie a la page, qui seule ecrit l'URL. */
    fond: FondHistorique | null;
    /** Restreindre les filtres a la zone visible. La case qui le commande est
     *  dans le tiroir des filtres — c'en est un — donc l'etat vit dans la page,
     *  seule a posseder `filters.bbox`. */
    suivreVue: boolean;
    onselect: (reference: string) => void;
    onbbox: (bbox: [number, number, number, number] | null) => void;
  }

  let {
    points,
    selection,
    vueInitiale,
    fond = $bindable(),
    suivreVue = $bindable(),
    onselect,
    onbbox
  }: Props = $props();

  /** Vue par defaut : la France entiere. */
  const DEPART: VueCarte = { lon: 2.6, lat: 46.6, zoom: 4.7 };

  let conteneur: HTMLDivElement;
  let carte: MapLibreMap | undefined = $state();
  let pret = $state(false);
  let densite = $state(false);
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

  /**
   * Le module des cartes anciennes est replie par defaut : deux fonds et un
   * curseur d'opacite occupaient en permanence un coin de la carte pour une
   * fonction dont on se sert par intermittence.
   *
   * Il s'ouvre de lui-meme quand un fond est deja actif a l'arrivee — un lien
   * partage porte `fond=cassini`, et la commande doit alors montrer son etat
   * plutot que de le cacher. Lu **une seule fois**, au montage : le suivre
   * rouvrirait le module sous le doigt de qui vient de le refermer.
   */
  let fondsOuverts = $state(untrack(() => fond) !== null);

  /** Au-dela de cette opacite, l'aplat beige de la carte ancienne l'emporte sur
   *  le sol, quel qu'il soit — ardoise en sombre, grege en clair — et le lisere,
   *  qui vaut precisement ce sol, s'y efface. */
  const BASCULE_LISERET = 50;

  const tuiles = (h: (typeof HISTORIQUES)[number]) =>
    'https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile' +
    `&LAYER=${h.couche}&STYLE=normal&TILEMATRIXSET=PM` +
    `&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=${encodeURIComponent(h.format)}`;

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

  /**
   * Le halo ne se lit pas de la meme facon selon le sol, et ce n'est pas une
   * question de gout : clair sur fond sombre, un aplat a faible alpha fait une
   * **lueur** ; sombre sur fond clair, il fait une **salissure**. Constate a la
   * capture — 0,14 sur le grege donnait des taches lavande de 26 px autour des
   * villes, la ou la meme valeur sur l'ardoise donne le halo attendu.
   *
   * C'est une opacite, pas une couleur : elle ne peut pas vivre dans `app.css`,
   * qui ne porte que des teintes. D'ou la seule branche sur le theme du
   * composant, et elle est ecrite ici plutot que dispersee.
   */
  const opaciteHalo = () => (densite ? 0 : theme.courant === 'clair' ? 0.07 : 0.14);

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
        'heatmap-color': rampeChaleur()
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
        'circle-opacity': opaciteHalo(),
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 7, 12, 26]
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
  }

  $effect(() => {
    // La vue de depart est lue sans dependance : c'est une condition initiale.
    // La suivre ici detruirait et recreerait la carte a chaque deplacement.
    const depart = untrack(() => vueInitiale ?? DEPART);
    const map = new maplibregl.Map({
      container: conteneur,
      style: fondPose,
      center: [depart.lon, depart.lat],
      zoom: depart.zoom,
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
      touchPitch: false
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

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
    carte.setPaintProperty('monuments-halo', 'circle-opacity', opaciteHalo());
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
    carte.setPaintProperty('monuments-halo', 'circle-color', expression);
    carte.setPaintProperty('monuments-halo', 'circle-opacity', opaciteHalo());
    // `liseret()` n'est pas appele ici : il lit `fond` et `opaciteFond`, ce qui
    // faisait de chaque pas du curseur d'opacite un declencheur de cet effet —
    // donc deux `circle-color` **data-driven** reecrits sur 44 484 points, pour
    // une couleur inchangee. Il vit dans l'effet des fonds historiques, qui
    // porte deja ces deux dependances.
    carte.setPaintProperty('monuments-selection', 'circle-stroke-color', palette.carteSelection);
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

<div class="legende">
  <div class="cles">
    {#if densite}
      <!-- Sous la densite, les teintes de statut ne disent plus rien : la
           legende montre la rampe qui est effectivement a l'ecran. -->
      <span class="cle">
        <i class="rampe"
           style="background:linear-gradient(90deg,{palette.chaleur1},{palette.chaleur2},{palette.chaleur3},{palette.chaleur4})"
        ></i>
        de quelques notices à plusieurs centaines
      </span>
    {:else if mode === 'statut'}
      <span class="cle"><i style="background:{palette.classe}"></i>classé</span>
      <span class="cle"><i style="background:{palette.inscrit}"></i>inscrit</span>
      <span class="cle"><i style="background:{palette.mixte}"></i>les deux</span>
    {:else}
      {#each TRANCHES as tranche (tranche.cle)}
        <span class="cle"><i style="background:{palette[tranche.cle]}"></i>{tranche.titre}</span>
      {/each}
    {/if}
  </div>

  <!-- Les commandes sont sous un filet, la ou la lecture s'arrete : la legende
       dit d'abord ce qu'on voit, elle propose ensuite de le changer. -->
  <div class="commandes">
    <span class="etiquette">colorer par</span>
    <div class="segments">
      <button class="mode" class:actif={mode === 'statut'} aria-pressed={mode === 'statut'}
              onclick={() => (mode = 'statut')}
              title="Colorer les points par statut de protection">statut</button>
      <button class="mode" class:actif={mode === 'epoque'} aria-pressed={mode === 'epoque'}
              onclick={() => (mode = 'epoque')}
              title="Colorer les points par époque de construction">époque</button>
    </div>
    <i class="separateur" aria-hidden="true"></i>
    <button class="densite" class:actif={densite} onclick={basculerDensite}
            aria-pressed={densite} title="Afficher la densité plutôt que les points seuls">
      densité
    </button>
  </div>
</div>

<!-- Les cartes anciennes prennent la colonne d'outils, sous le zoom : c'est un
     calque de carte, pas une cle de lecture des points, et il se replie parce
     qu'on ne s'en sert pas en continu. La colonne suit `--marge-droite` comme
     le zoom : la fiche ne doit rien recouvrir. -->
{#if fondsOuverts}
  <div class="fonds">
    <div class="entete-fonds">
      <p class="titre-outil">Cartes anciennes</p>
      <button class="fermer-fonds" aria-label="Replier les cartes anciennes"
              onclick={() => (fondsOuverts = false)}>×</button>
    </div>
    {#each HISTORIQUES as h (h.cle)}
      <button class:actif={fond === h.cle} onclick={() => choisirFond(h.cle)}
              aria-pressed={fond === h.cle}
              title="Superposer la carte {h.titre} ({h.epoque}) — {h.poids}">
        <span class="nom-fond">{h.titre}</span>
        <span class="epoque">{h.epoque}</span>
      </button>
    {/each}
    {#if fond}
      <!-- Le curseur natif apporte le clavier et le tactile sans rien ecrire. -->
      <label class="dosage">
        <span>opacité</span>
        <output>{opaciteFond} %</output>
        <input type="range" min="0" max="100" step="5" bind:value={opaciteFond}
               aria-label="Opacité du fond historique" />
      </label>
    {/if}
  </div>
{:else}
  <button class="ouvrir-fonds" class:actif={fond !== null} aria-expanded="false"
          aria-label="Cartes anciennes"
          title="Superposer une carte ancienne — Cassini, état-major"
          onclick={() => (fondsOuverts = true)}>
    <!-- Trois feuillets empiles : le geste est une superposition, pas un choix
         de fond. Trait en `currentColor`, sinon la couleur echapperait au
         theme comme a la regle « tout vit dans app.css ». -->
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 3.2 3.4 7.5 12 11.8l8.6-4.3z" />
      <path d="M3.4 12 12 16.3l8.6-4.3" />
      <path d="M3.4 16.5 12 20.8l8.6-4.3" />
    </svg>
  </button>
{/if}

<style>
  .carte {
    position: absolute;
    inset: 0;
  }

  /* `--marge-gauche` est posee par la page : c'est la largeur du tiroir des
     filtres quand il est ouvert a cote de la carte. La carte n'a pas a
     connaitre l'existence d'un panneau de facettes, une variable heritee
     suffit.

     Le coin bas gauche est libre depuis que l'attribution est passee a droite :
     la legende descend donc jusqu'au bord, elle n'enjambe plus rien. */
  .legende {
    position: absolute;
    left: calc(var(--marge-gauche, 0px) + 12px);
    bottom: 12px;
    z-index: 2;
    display: flex;
    flex-direction: column;
    gap: 9px;
    max-width: min(52vw, 430px);
    padding: 10px 14px 11px;
    border: 1px solid var(--bord-flottant);
    border-radius: var(--r-l);
    background: color-mix(in srgb, var(--fond) 94%, transparent);
    box-shadow: var(--ombre-carte);
    /* Pas de flou au-dessus d'un canevas WebGL : il se paie a chaque image. */
    backdrop-filter: none;
    font-size: 11.5px;
    color: var(--texte-faible);
    transition: left var(--t-tiroir);
  }

  .cles {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 14px;
  }

  .cle {
    display: flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }

  .cle i {
    width: 9px;
    height: 9px;
    border-radius: 50%;
  }

  /* La rampe de densite se lit comme un gradient, pas comme une pastille. */
  .cle i.rampe {
    width: 46px;
    height: 8px;
    border-radius: var(--r-pilule);
  }

  .commandes {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 10px;
    padding-top: 9px;
    border-top: 1px solid var(--bord);
  }

  /* Le libelle dit ce que reglent les deux boutons qui suivent. Sans lui,
     « statut » et « epoque » ressemblaient a des filtres poses sur le corpus. */
  .etiquette {
    font-size: 9.5px;
    font-weight: 600;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--texte-tenu);
  }

  /* Deux options exclusives, donc un rail et une pastille — comme le selecteur
     de vue de la barre. Un bouton unique qui change de libelle demandait de
     deviner s'il annonce l'etat courant ou sa destination. */
  .segments {
    display: flex;
    gap: 2px;
    padding: 2px;
    background: var(--fond-creux);
    border-radius: var(--r-pilule);
  }

  .segments button {
    border: none;
    background: transparent;
    color: var(--texte-faible);
    border-radius: var(--r-pilule);
    padding: 3px 10px;
    font-size: 11px;
    cursor: pointer;
    transition: all var(--t-rapide);
  }

  .segments button:hover {
    color: var(--texte);
  }

  .segments button.actif {
    background: var(--fond-carte);
    color: var(--texte);
    font-weight: 600;
    box-shadow: 0 2px 6px -2px rgb(var(--voile) / 18%);
  }

  /* Filet de separation entre le rail des couleurs et la bascule de densite :
     deux commandes voisines, deux questions differentes. */
  .separateur {
    width: 1px;
    height: 16px;
    background: var(--bord);
  }

  .densite,
  .fonds > button {
    border: 1px solid var(--bord);
    background: var(--fond-carte);
    color: var(--texte-faible);
    border-radius: var(--r-pilule);
    padding: 4px 11px;
    font-size: 11.5px;
    cursor: pointer;
    transition: all var(--t-rapide);
  }

  .densite:hover,
  .fonds > button:hover {
    border-color: var(--inscrit);
    color: var(--inscrit-texte);
  }

  .densite.actif,
  .fonds > button.actif {
    border-color: var(--inscrit);
    background: color-mix(in srgb, var(--inscrit) 14%, transparent);
    color: var(--inscrit-texte);
    font-weight: 600;
  }

  /* Le module prolonge la colonne d'outils du zoom : meme bord droit, meme
     largeur au repos, meme langage graphique. 78 px : la hauteur du groupe
     MapLibre (deux boutons de 29 px et son filet) plus sa marge de 10 px. */
  .ouvrir-fonds,
  .fonds {
    position: absolute;
    top: 78px;
    right: calc(var(--marge-droite, 0px) + 10px);
    z-index: 2;
    border: 1px solid var(--bord-flottant);
    background: var(--fond-carte);
    box-shadow: var(--ombre-carte);
    /* Pas de flou au-dessus d'un canevas WebGL : il se paie a chaque image. */
    backdrop-filter: none;
    transition: right var(--t-tiroir);
  }

  .ouvrir-fonds {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 31px;
    height: 31px;
    border-radius: var(--r-m);
    color: var(--texte-faible);
    cursor: pointer;
  }

  .ouvrir-fonds svg {
    width: 17px;
    height: 17px;
  }

  .ouvrir-fonds:hover {
    background: var(--fond-creux);
    color: var(--texte);
  }

  /* Replie sur un fond actif, le bouton doit encore le dire : sinon la carte
     ancienne resterait a l'ecran sans commande visible pour l'eteindre. */
  .ouvrir-fonds.actif {
    border-color: var(--inscrit);
    color: var(--inscrit-texte);
  }

  .fonds {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 168px;
    padding: 9px 11px 11px;
    border-radius: var(--r-l);
  }

  .entete-fonds {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .titre-outil {
    margin: 0 0 0 2px;
    font-size: 9.5px;
    font-weight: 600;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--texte-tenu);
  }

  .fermer-fonds {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 21px;
    height: 21px;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--texte-tenu);
    font-size: 15px;
    line-height: 1;
    cursor: pointer;
    transition: color var(--t-rapide);
  }

  .fermer-fonds:hover {
    color: var(--texte);
  }

  /* Le nom sur une ligne, la periode sous lui : c'est elle qui dit ce que la
     superposition apporte, et un `title` ne se lit pas au tactile. */
  .fonds > button {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
    border-radius: var(--r-m);
    padding: 6px 11px 7px;
    text-align: left;
  }

  .nom-fond {
    font-size: 12px;
    color: var(--texte);
  }

  .fonds > button.actif .nom-fond {
    color: var(--inscrit-texte);
  }

  .epoque {
    font-size: 10px;
    color: var(--texte-tenu);
  }

  /* Le dosage n'apparait qu'avec un fond actif : il n'occupe donc de place que
     lorsqu'il en a une a regler. */
  /* Le libelle et la valeur sur une ligne, le curseur sous eux : partages en
     largeur, les trois ne laissaient qu'une quarantaine de pixels de course. */
  .dosage {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 3px 6px;
    margin-top: 3px;
    font-size: 10.5px;
    white-space: nowrap;
    color: var(--texte-faible);
  }

  .dosage input {
    grid-column: 1 / -1;
    width: 100%;
    min-width: 0;
    margin: 0;
    accent-color: var(--inscrit);
    cursor: pointer;
  }

  /* Chiffres tabulaires : sans eux, passer de « 5 % » a « 100 % » decale le
     libelle a chaque cran du curseur. */
  .dosage output {
    font-variant-numeric: tabular-nums;
    text-align: right;
    color: var(--texte-moyen);
  }

  /* Les commandes MapLibre s'ecartent des deux calques, comme la legende et la
     boite des cartes anciennes. La variable est posee par la page.

     L'attribution est repassee **en bas a droite** : a gauche, sa pastille
     « i » se posait sur la legende. La raison qui l'en avait chassee — la fiche
     la recouvrait — tombe avec `--marge-droite`, qui l'ecarte du calque comme
     elle ecarte le zoom. */
  .carte :global(.maplibregl-ctrl-bottom-right),
  .carte :global(.maplibregl-ctrl-top-right) {
    right: var(--marge-droite, 0px);
    transition: right 160ms ease;
  }

  /* Sur un telephone les cinq tranches d'epoque ne tiennent pas sur une
     ligne : la legende s'enroule et occupe toute la largeur. Elle remonte
     au-dessus de l'attribution, qui n'a plus de place a elle a cette largeur. */
  @media (max-width: 900px) {
    .legende {
      left: 8px;
      right: 8px;
      bottom: 36px;
      max-width: none;
      border-radius: var(--r-m);
      font-size: 10px;
    }

    .ouvrir-fonds,
    .fonds {
      top: 74px;
    }

    .fonds {
      width: 146px;
      padding: 8px 9px 9px;
    }
  }
</style>
