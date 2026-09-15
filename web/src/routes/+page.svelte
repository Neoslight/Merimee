<script lang="ts">
  import DetailPanel from '$lib/components/DetailPanel.svelte';
  import FacetPanel from '$lib/components/FacetPanel.svelte';
  import Jetons from '$lib/components/Jetons.svelte';
  import MonumentMap from '$lib/components/MonumentMap.svelte';
  import {
    auHasard,
    cardinalites,
    facette,
    histogrammeProtections,
    histogrammeSiecles,
    liste,
    matrice,
    points,
    totaux,
    type BarreAnnee,
    type BarreSiecle,
    type Compte,
    type Ligne,
    type Matrice as DonneesMatrice,
    type Totaux
  } from '$lib/db/queries';
  import {
    ANNEE_MAX,
    countActive,
    filters,
    jetonsActifs,
    replier,
    poserSaisie,
    reset,
    retirer,
    toggleSiecle,
    type FacetKey,
    type Jeton
  } from '$lib/state/filters.svelte';
  import {
    decoder,
    encoder,
    type FondHistorique,
    type Vue,
    type VueCarte
  } from '$lib/state/permalien';
  import { charger, indexTexte, preparer } from '$lib/state/texte.svelte';
  import { appliquer, basculer, theme } from '$lib/state/theme.svelte';
  import { amorcage, LIBELLES } from '$lib/state/amorcage.svelte';
  import { formaterDistance, nf } from '$lib/format';
  import { browser } from '$app/environment';
  import { pushState, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { tick, untrack } from 'svelte';
  import { base } from '$app/paths';
  import { versCollection } from '$lib/db/points';
  import { MESSAGES_POSITION, position } from '$lib/state/position.svelte';

  const FACETTES: FacetKey[] = [
    'statut', 'domaines', 'denominations', 'regions',
    'departements', 'auteurs', 'proprietaires', 'periodes'
  ];

  // `$state.raw` et non `$state` : le nuage est remplace en bloc a chaque
  // filtre, jamais modifie en place. Un etat profond ferait de MapLibre le
  // declencheur de 44 484 proxies, pour une reactivite dont personne ne se sert.
  let pointsCarte = $state.raw<GeoJSON.FeatureCollection>({
    type: 'FeatureCollection',
    features: []
  });
  // Meme regle que `pointsCarte` ci-dessus, et pour la meme raison : ces six
  // valeurs sont reaffectees en bloc a chaque cycle et jamais modifiees en
  // place. En `$state`, Svelte posait des proxies recursifs sur les huit
  // listes de facettes, les 200 lignes de resultats et les 186 barres
  // d'annees, a chaque frappe, pour une reactivite dont personne ne se sert.
  let facettes = $state.raw<Partial<Record<FacetKey, Compte[]>>>({});
  let barresSiecles = $state.raw<BarreSiecle[]>([]);
  let barresAnnees = $state.raw<BarreAnnee[]>([]);
  let cardinaux = $state.raw<Partial<Record<FacetKey, number>>>({});
  let compteurs = $state.raw<Totaux | null>(null);
  let resultats = $state.raw<Ligne[]>([]);
  // L'URL est lue avant le premier cycle de requetes : un lien partage ne doit
  // pas provoquer un aller-retour « corpus complet puis filtre ».
  const initial = decoder(browser ? location.search : '');
  Object.assign(filters, initial.filtres);

  // Nuage precalcule du premier ecran (`lib/db/points.ts`). Il ne part que si
  // l'URL ne porte **aucun** filtre : sinon il peindrait le corpus entier avant
  // que DuckDB ne le restreigne, et 500 Ko pour un nuage aussitot jete. Il ne
  // se pose que si DuckDB n'a pas encore repondu et que rien n'a bouge depuis
  // (`jeton` vaut encore 1) — il ne remplace jamais une reponse du moteur.
  //
  // Le compte provisoire ne porte que ce que la barre et la liste lisent ;
  // classes, inscrits et objets arrivent avec la premiere reponse de DuckDB.
  let nuageMoteur = false;
  if (browser && encoder({ filtres: initial.filtres, selection: null, vue: 'carte', fond: null }) === '') {
    fetch(`${base}/data/points.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((brut) => {
        const nuage = versCollection(brut);
        if (!nuage || nuageMoteur || jeton > 1) return;
        pointsCarte = nuage;
        compteurs ??= { total: brut.total, geolocalises: brut.geolocalises, classes: 0, inscrits: 0, objets: 0 };
      })
      .catch(() => {
        // Fichier absent d'un deploiement plus ancien : DuckDB suivra.
      });
  }

  let selection = $state<string | null>(initial.selection);
  // Cran de la feuille de fiche sur telephone, cf. « Feuille a crans » plus
  // bas. Declare ici : `ouvrirFiche` le lit avant que ce bloc n'arrive.
  type Cran = 'apercu' | 'plein';
  let cran = $state<Cran>('apercu');
  let chargement = $state(true);
  let erreur = $state<string | null>(null);
  let vue = $state<Vue>(initial.vue);
  // Le fond historique vit ici et non dans la carte : c'est la page qui
  // ecrit l'URL, et le fond en fait partie. Son opacite, elle, reste dans le
  // composant — dosage de lecture, pas etat d'exploration.
  let fond = $state<FondHistorique | null>(initial.fond);
  let croisement = $state.raw<DonneesMatrice>({ cellules: [], ecartees: 0 });

  // Timeline et Matrice importent Observable Plot (209 Ko minifie, ~65 Ko
  // gzip) et partaient jusqu'ici dans le chunk de page, charge avant meme que
  // `boot()` de duckdb.ts puisse commencer — alors que la frise est fermee au
  // chargement et que la matrice n'est qu'une des trois vues. Les deux ne sont
  // donc plus importes statiquement : `import()` les charge au premier besoin
  // (frise ouverte, vue matrice), et le composant reste `null` le temps du
  // telechargement — d'ou les emplacements reserves du gabarit, cf. le style.
  type ComposantTimeline = (typeof import('$lib/components/Timeline.svelte'))['default'];
  type ComposantMatrice = (typeof import('$lib/components/Matrice.svelte'))['default'];
  let TimelineComp = $state<ComposantTimeline | null>(null);
  let MatriceComp = $state<ComposantMatrice | null>(null);

  $effect(() => {
    if (friseOuverte && !TimelineComp) {
      import('$lib/components/Timeline.svelte').then((m) => {
        TimelineComp = m.default;
      });
    }
  });

  $effect(() => {
    if (vue === 'matrice' && !MatriceComp) {
      import('$lib/components/Matrice.svelte').then((m) => {
        MatriceComp = m.default;
      });
    }
  });
  let terme = $state(initial.filtres.texte || initial.filtres.recherche);

  // Cible de la saisie. Les deux recherches s'excluent : `search_key` est
  // instantanee et ne vise que titre, commune et departement ; les historiques
  // demandent 3,8 Mo d'index. Les reunir couterait une union de deux predicats
  // de couts incomparables pour un gain nul — il n'existe pas de titre qui
  // contienne « jube ».
  type Cible = 'titres' | 'historiques';
  let cible = $state<Cible>(initial.filtres.texte ? 'historiques' : 'titres');
  let jetonTexte = 0;

  // Position de depart de la carte, portee par le lien partage et par lui seul.
  const cadrageInitial = initial.cadrage;
  let vueCarte = $state<{ vueCourante: () => VueCarte | null } | undefined>();

  // Instance de la fiche, pour lui rendre le focus apres un geste d'ouverture
  // — meme procede que `vueCarte` ci-dessus.
  let detailPanel = $state<{ focaliser: () => void } | undefined>();
  // Titre affiche par la fiche, pour le `<title>` du document : la page ne
  // charge pas la notice elle-meme, `DetailPanel` le lui remonte.
  let titreFiche = $state<string | null>(null);

  // « Limiter a la zone visible » est un filtre : sa case vit donc dans le
  // tiroir des filtres, avec les autres, et non plus dans la legende de la
  // carte. L'etat est ici parce que la page possede `filters.bbox` ; la carte
  // le lit et pose ou retire la zone.
  let suivreVue = $state(false);

  // Le script en tete d'`app.html` a deja pose `data-theme` avant le premier
  // paint : cet effet ne change donc rien a l'ecran au montage. Il resout la
  // palette lue par MapLibre et Plot, qui exige un document, puis rejoue a
  // chaque bascule.
  $effect(() => {
    appliquer(theme.courant);
  });

  // Deux chemins depuis le meme champ. Sur les titres, un LIKE sur une colonne
  // pre-normalisee repond en quelques ms. Sur les historiques, l'index se
  // charge au premier usage, puis le lexique traduit les mots en identifiants
  // avant que `filters.texte` ne declenche le cycle — cet ordre est ce que
  // `poserTermes` exige.
  $effect(() => {
    const saisie = terme;
    const mode = cible;
    const minuteur = setTimeout(async () => {
      const mien = ++jetonTexte;
      // La saisie brute est posee avant le filtre : c'est elle que la puce
      // affiche, et le filtre est ce qui declenche le cycle.
      poserSaisie(saisie);
      if (mode === 'titres') {
        await preparer('');
        if (mien !== jetonTexte) return;
        filters.texte = '';
        filters.recherche = replier(saisie);
        return;
      }
      filters.recherche = '';
      if (!(await charger())) {
        // Index absent de ce deploiement : on revient aux titres plutot que de
        // laisser un mode qui ne peut rien rendre.
        if (mien === jetonTexte) cible = 'titres';
        return;
      }
      await preparer(saisie);
      if (mien !== jetonTexte) return;
      filters.texte = replier(saisie);
    }, 180);
    return () => clearTimeout(minuteur);
  });

  // Signature profonde de l'etat : un seul point de declenchement pour tout
  // le cycle de requetes, quel que soit le filtre modifie.
  const signature = $derived(JSON.stringify(filters));

  let jeton = 0;
  let jetonFacettes = 0;
  let jetonFrise = 0;
  let jetonMatrice = 0;

  /** Un echec n'est signale que s'il concerne encore le cycle en cours. */
  function echec(vivant: () => boolean) {
    return (e: unknown) => {
      if (!vivant()) return;
      erreur = e instanceof Error ? e.message : String(e);
      chargement = false;
    };
  }

  // Le nuage de points est le seul resultat que l'oeil suit en continu. Il
  // partait dans le meme `Promise.all` que les facettes et les cardinalites :
  // repondant en 12 ms, il attendait quand meme le maillon le plus lent du lot,
  // les huit requetes partageant une connexion unique et donc s'y serialisant.
  // Il a desormais son propre aller-retour et s'affiche des qu'il repond.
  $effect(() => {
    signature;
    const mien = ++jeton;
    chargement = true;
    points(filters)
      .then((pts) => {
        if (mien !== jeton) return;
        nuageMoteur = true;
        pointsCarte = pts;
      })
      .catch(echec(() => mien === jeton));
    totaux(filters)
      .then((tot) => {
        if (mien !== jeton) return;
        compteurs = tot;
        erreur = null;
        chargement = false;
      })
      .catch(echec(() => mien === jeton));
  });

  // --- Ordre de la liste -----------------------------------------------------
  // La liste a quitte l'effet principal : elle depend aussi de la position, qui
  // n'a rien a relancer des points ni des totaux.
  //
  // `tri` et la position restent hors de l'URL : un lien partage ne dit pas ou
  // se tenait celui qui l'a copie. A la **premiere** position obtenue, la liste
  // passe d'elle-meme en proximite — c'est ce qu'on demandait en touchant le
  // bouton — puis le choix n'appartient plus qu'a l'utilisateur.
  type Tri = 'pertinence' | 'proximite';
  let tri = $state<Tri>('pertinence');
  let proximiteProposee = false;

  $effect(() => {
    if (!position.courante || proximiteProposee) return;
    proximiteProposee = true;
    tri = 'proximite';
  });

  const proche = $derived(tri === 'proximite' ? position.courante : null);
  // Arrondie a une centaine de metres : en suivi, le navigateur renvoie une
  // position toutes les quelques secondes, et chacune relancerait la requete
  // pour un ordre inchange.
  const cleProche = $derived(proche ? `${proche.lon.toFixed(3)},${proche.lat.toFixed(3)}` : '');
  let jetonListe = 0;

  $effect(() => {
    signature;
    cleProche;
    const mien = ++jetonListe;
    const ici = untrack(() => proche);
    liste(filters, 200, ici ? { lon: ici.lon, lat: ici.lat } : null)
      .then((lst) => {
        if (mien !== jetonListe) return;
        resultats = lst;
      })
      .catch(echec(() => mien === jetonListe));
  });

  // Le message d'erreur de geolocalisation s'efface de lui-meme : il informe,
  // il n'attend pas de reponse.
  $effect(() => {
    if (!position.erreur) return;
    const minuteur = setTimeout(() => (position.erreur = null), 8000);
    return () => clearTimeout(minuteur);
  });

  // Les facettes et leurs cardinalites alimentent un tiroir repliable, ferme
  // par defaut sous 900 px : neuf requetes sur quatorze partaient pour un
  // panneau que personne ne regarde. L'effet depend de `facettesOuvertes`,
  // donc ouvrir le tiroir le rejoue — rien ne s'affiche perime.
  $effect(() => {
    signature;
    if (!facettesOuvertes) return;
    const mien = ++jetonFacettes;
    Promise.all([
      Promise.all(FACETTES.map((cle) => facette(filters, cle))),
      cardinalites(filters)
    ])
      .then(([fac, card]) => {
        if (mien !== jetonFacettes) return;
        facettes = Object.fromEntries(FACETTES.map((cle, i) => [cle, fac[i]]));
        cardinaux = card;
      })
      .catch(echec(() => mien === jetonFacettes));
  });

  // Meme regle pour la frise, repliable a toutes les largeurs et fermee au
  // premier ecran sur telephone.
  $effect(() => {
    signature;
    if (!friseOuverte) return;
    const mien = ++jetonFrise;
    Promise.all([histogrammeSiecles(filters), histogrammeProtections(filters)])
      .then(([sie, ann]) => {
        if (mien !== jetonFrise) return;
        barresSiecles = sie;
        barresAnnees = ann;
      })
      .catch(echec(() => mien === jetonFrise));
  });

  // `vue` etait lu dans le corps de l'effet principal, ce qui en faisait une
  // dependance de l'effet **entier** : basculer carte -> liste relancait les
  // quatorze requetes sans qu'aucun filtre ait bouge. La matrice a donc son
  // propre effet, le seul a dependre de `vue`. Il ne lit plus `croisement` non
  // plus — l'ancien `Promise.resolve(croisement)` faisait de l'effet principal
  // un lecteur de ce qu'il ecrivait lui-meme.
  $effect(() => {
    signature;
    if (vue !== 'matrice') return;
    const mien = ++jetonMatrice;
    matrice(filters)
      .then((m) => {
        if (mien !== jetonMatrice) return;
        croisement = m;
      })
      .catch(echec(() => mien === jetonMatrice));
  });

  // --- Permalien -----------------------------------------------------------
  // L'URL est la seule memoire partageable de l'exploration. On y ecrit par
  // remplacement : chaque clic de facette empilerait sinon une entree
  // d'historique. Seule l'ouverture d'une fiche empile, parce que refermer la
  // fiche est precisement ce que le bouton retour doit faire.
  let derniereRequete = encoder(initial);
  let derniereSelection = initial.selection;

  $effect(() => {
    const requete = encoder({ filtres: filters, selection, vue, fond });
    if (requete === derniereRequete) return;
    const fiche = selection !== derniereSelection;
    derniereRequete = requete;
    derniereSelection = selection;
    // Une chaine vide serait resolue comme « URL courante » : viser le chemin.
    const cible = requete || location.pathname;
    if (fiche) pushState(cible, {});
    else replaceState(cible, {});
  });

  // Sens inverse : apres un retour arriere, l'URL fait foi.
  //
  // La comparaison se fait sur la **forme normalisee** — decodee puis reencodee
  // — et non sur la chaine brute. Un lien partage porte `c=`, que `encoder`
  // n'emet jamais : compare tel quel, il paraissait toujours different de
  // l'etat, cet effet et son symetrique se renvoyaient la balle, et le
  // `replaceState` partait avant que SvelteKit ait monte sa racine.
  $effect(() => {
    const etat = decoder(page.url.search);
    const requete = encoder(etat);
    if (requete === derniereRequete) return;
    derniereRequete = requete;
    derniereSelection = etat.selection;
    Object.assign(filters, etat.filtres);
    selection = etat.selection;
    vue = etat.vue;
    fond = etat.fond;
    cible = etat.filtres.texte ? 'historiques' : 'titres';
    terme = etat.filtres.texte || etat.filtres.recherche;
  });

  // Le presse-papier peut etre refuse (contexte non securise, permission) :
  // l'echec bascule sur une selection manuelle plutot que de ne rien faire.
  let copie = $state(false);

  async function copierLien() {
    // Seul endroit ou la vue de carte entre dans une URL. L'URL vivante n'en
    // porte pas : un simple deplacement ne doit rien reecrire.
    const requete = encoder({ filtres: filters, selection, vue, fond }, vueCarte?.vueCourante());
    const lien = location.origin + location.pathname + requete;
    try {
      await navigator.clipboard.writeText(lien);
      copie = true;
      setTimeout(() => (copie = false), 1600);
    } catch {
      window.prompt('Copier ce lien :', lien);
    }
  }

  // --- Puces de filtres actifs ---------------------------------------------
  // Deux cles ont un etat miroir hors de `filters` : le champ de la barre, qui
  // alimente `recherche` par un effet retarde, et le suivi de vue de la carte,
  // qui reposerait `bbox` au prochain deplacement. Les remettre est le travail
  // de la page, seule a connaitre les deux.
  function retirerJeton(puce: Jeton) {
    retirer(puce.cle, puce.valeur);
    if (puce.cle === 'recherche' || puce.cle === 'texte') terme = '';
    if (puce.cle === 'bbox') suivreVue = false;
  }

  function toutEffacer() {
    reset();
    terme = '';
    suivreVue = false;
  }

  // --- Focus des calques -----------------------------------------------------
  // Un tiroir ou une fiche ouverts par un geste deplacent le focus dedans ; le
  // refermer le rend a ce qui l'avait avant. Seul un geste utilisateur le
  // fait : un permalien pose `selection` sans jamais passer par ces fonctions,
  // et l'effet de lecture d'URL (retour arriere compris) non plus.
  //
  // Le tiroir n'a qu'un seul point d'entree — son bouton flottant, qui
  // reapparait a l'identique des la fermeture — inutile de le capturer. La
  // fiche, elle, s'ouvre depuis trois endroits (carte, liste, « au hasard »),
  // d'ou la capture du foyer courant.
  let foyerFiche: HTMLElement | null = null;
  let titreTiroir: HTMLElement | undefined = $state();
  let boutonFiltres: HTMLElement | undefined = $state();

  function ouvrirFiche(ref: string) {
    const actif = document.activeElement;
    foyerFiche = actif instanceof HTMLElement && actif !== document.body ? actif : null;
    // Une feuille fermee s'ouvre en apercu ; une feuille deja ouverte garde son
    // cran — passer d'un voisin a l'autre ne doit pas la faire sauter.
    if (selection === null) cran = 'apercu';
    selection = ref;
    // La fiche affiche d'abord « Chargement… » : `focaliser()` vise l'aside
    // lui-meme, toujours present, pas son titre qui arrive plus tard.
    tick().then(() => detailPanel?.focaliser());
  }

  function fermerFiche() {
    selection = null;
    // Le foyer peut avoir disparu (filtre qui retire la ligne de liste) : un
    // clic sur la carte replie alors sur le canevas, le repli le plus sense.
    const repli =
      foyerFiche && document.contains(foyerFiche)
        ? foyerFiche
        : document.querySelector<HTMLElement>('.maplibregl-canvas');
    foyerFiche = null;
    repli?.focus();
  }

  function ouvrirTiroir() {
    facettesOuvertes = true;
    tick().then(() => titreTiroir?.focus());
  }

  function fermerTiroir() {
    facettesOuvertes = false;
    tick().then(() => boutonFiltres?.focus());
  }

  // --- Echap -------------------------------------------------------------
  // Ferme le calque le plus haut, avec les memes fonctions que les croix : la
  // fiche restitue le focus au bon endroit, exactement comme un clic dessus.
  function champTexteNonVide(el: HTMLElement): boolean {
    if (el instanceof HTMLTextAreaElement) return el.value !== '';
    if (el instanceof HTMLInputElement) return (el.type === 'text' || el.type === 'search') && el.value !== '';
    return false;
  }

  function surEchap(event: KeyboardEvent) {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    // Convention partagee avec les composants qui gerent Echap localement :
    // ils appellent `preventDefault`, celui-ci les laisse faire.
    const cible = event.target;
    // Un champ de saisie non vide se vide au premier Echap — comportement
    // natif des `<input type="search">` de ce produit — la fermeture d'un
    // calque attend le passage suivant.
    if (cible instanceof HTMLElement && champTexteNonVide(cible)) return;
    if (selection !== null) {
      fermerFiche();
    } else if (facettesOuvertes) {
      fermerTiroir();
    }
  }

  // Le seuil telephone (768 px) est purement graphique — la fiche remonte du
  // bas au lieu de glisser du cote — et vit donc dans la feuille de style.
  // Celui-ci commande de l'etat : voile pose sur la scene, et fiche qui
  // referme le tiroir derriere elle.
  const ETROIT = '(max-width: 900px)';
  let etroit = $state(false);
  // Le seuil telephone commande desormais de l'etat lui aussi : la feuille a
  // crans, qui n'est modale qu'une fois depliee, et la reserve qu'elle impose
  // a la carte. Il reste ecrit a l'identique dans la feuille de style.
  const TELEPHONE = '(max-width: 768px)';
  let telephone = $state(false);

  // Les deux panneaux repliables s'ouvrent au geste, jamais au chargement, et
  // **a toutes les largeurs**. Le tiroir etait pose d'emblee des qu'il y avait
  // la place : il fallait le refermer avant de regarder la carte, qui est ce
  // qu'on vient voir. Consequence heureuse cote requetes — les effets qui
  // portent facettes, cardinalites et histogrammes dependent de ces deux
  // drapeaux, donc le demarrage n'emet plus que trois requetes au lieu de
  // quatorze, et l'ouverture d'un panneau les rejoue.
  let facettesOuvertes = $state(false);
  let friseOuverte = $state(false);

  $effect(() => {
    if (!browser) return;
    const moyen = window.matchMedia(ETROIT);
    const petit = window.matchMedia(TELEPHONE);
    const appliquerGabarit = () => {
      etroit = moyen.matches;
      telephone = petit.matches;
    };
    appliquerGabarit();
    moyen.addEventListener('change', appliquerGabarit);
    petit.addEventListener('change', appliquerGabarit);
    return () => {
      moyen.removeEventListener('change', appliquerGabarit);
      petit.removeEventListener('change', appliquerGabarit);
    };
  });

  // Ouvrir une fiche sur un ecran etroit doit refermer le tiroir des filtres,
  // sinon la fiche s'ouvre derriere lui. Au large les deux calques cohabitent.
  $effect(() => {
    if (selection && etroit) facettesOuvertes = false;
  });

  // Calque actuellement modal : seulement sur gabarit etroit, et seulement
  // celui qui a effectivement un voile ou une feuille pleine largeur derriere
  // lui. Sur ecran etroit, ouvrir la fiche referme deja le tiroir (effet
  // ci-dessus) : les deux ne sont jamais modaux en meme temps.
  //
  // Exception : la feuille de fiche en **apercu** sur telephone n'est pas
  // modale. Elle laisse 55 % de carte au-dessus d'elle, et c'est tout son
  // interet — toucher le monument voisin sans refermer. Depliee, elle couvre
  // l'ecran et redevient modale.
  const calqueModal = $derived(
    !etroit
      ? null
      : selection !== null
        ? telephone && cran === 'apercu'
          ? null
          : 'fiche'
        : facettesOuvertes
          ? 'tiroir'
          : null
  );

  // --- Feuille a crans (telephone) -----------------------------------------
  // Deux crans et une fermeture, commandes par une poignee. Le glissement
  // suit le doigt par `transform`, jamais par la hauteur : la feuille a une
  // hauteur definie — c'est ce qui la fait defiler, cf. le style — et la
  // translater ne provoque aucun reflow de la notice.
  /** Part de la feuille cachee sous le bord en apercu. */
  const PART_CACHEE = 0.55;
  let hauteurScene = $state(0);
  let decalage = $state<number | null>(null);
  let saisiePoignee: { y: number; depart: number; hauteur: number; bouge: boolean } | null = null;

  function basculerCran() {
    cran = cran === 'plein' ? 'apercu' : 'plein';
  }

  function saisirPoignee(event: PointerEvent) {
    const poignee = event.currentTarget as HTMLElement;
    const hote = poignee.parentElement;
    if (!hote) return;
    poignee.setPointerCapture(event.pointerId);
    const hauteur = hote.getBoundingClientRect().height;
    saisiePoignee = {
      y: event.clientY,
      depart: cran === 'plein' ? 0 : hauteur * PART_CACHEE,
      hauteur,
      bouge: false
    };
  }

  function glisserPoignee(event: PointerEvent) {
    const s = saisiePoignee;
    if (!s) return;
    const dy = event.clientY - s.y;
    // Quelques pixels de jeu : sans eux, le tremblement d'un toucher franc
    // passerait pour un glissement et la bascule ne partirait jamais.
    if (!s.bouge && Math.abs(dy) < 6) return;
    s.bouge = true;
    decalage = Math.min(s.hauteur, Math.max(0, s.depart + dy));
  }

  function lacherPoignee() {
    const s = saisiePoignee;
    const fin = decalage;
    saisiePoignee = null;
    decalage = null;
    if (!s) return;
    if (!s.bouge || fin === null) {
      basculerCran();
      return;
    }
    const part = fin / s.hauteur;
    // Un quart de la part encore visible en apercu, tire vers le bas, ferme.
    if (part > PART_CACHEE + (1 - PART_CACHEE) * 0.25) fermerFiche();
    else cran = part < PART_CACHEE / 2 ? 'plein' : 'apercu';
  }

  function annulerPoignee() {
    saisiePoignee = null;
    decalage = null;
  }

  /** Le pointeur est traite par `lacherPoignee` ; un `click` de detail nul
   *  vient du clavier (Entree, Espace), seul chemin qui passe ici. */
  function clavierPoignee(event: MouseEvent) {
    if (event.detail === 0) basculerCran();
  }

  // Ce que la feuille masque en bas de la carte : la carte y ramene un point
  // choisi qui tomberait dessous. Depliee, la feuille couvre tout, il n'y a
  // plus rien a ramener.
  const reserveBas = $derived(
    telephone && selection !== null && vue === 'carte' && cran === 'apercu'
      ? Math.round((hauteurScene - 8) * (1 - PART_CACHEE))
      : 0
  );

  // Pose `inert` sur tout ce qui n'est pas le calque modal courant, depuis
  // l'exterieur : la carte, la matrice et la frise appartiennent a d'autres
  // composants, `inert` se pose donc sur leurs racines sans qu'ils aient
  // besoin de le connaitre. Le voile bloque deja le pointeur ; ceci bloque le
  // clavier, que le voile ne couvre pas.
  $effect(() => {
    if (!browser) return;
    const modal = calqueModal;
    const scene = document.querySelector('.scene');
    const dehors = [
      document.querySelector('.barre'),
      document.querySelector('.jetons'),
      document.querySelector('.frise'),
      document.querySelector('.replier'),
      document.querySelector('.onglets')
    ];
    const cibles = [...(scene ? Array.from(scene.children) : []), ...dehors].filter(
      (el): el is HTMLElement => el instanceof HTMLElement
    );
    for (const el of cibles) {
      const estCalque =
        (modal === 'tiroir' && el.classList.contains('facettes')) ||
        (modal === 'fiche' && el.classList.contains('fiche-hote')) ||
        el.classList.contains('voile');
      el.inert = modal !== null && !estCalque;
    }
  });

  const VUES: { cle: Vue; titre: string }[] = [
    { cle: 'carte', titre: 'Carte' },
    { cle: 'matrice', titre: 'Matrice' },
    { cle: 'liste', titre: 'Liste' }
  ];

  // Un clic dans la matrice pose les deux axes d'un coup. La decennie devient
  // une plage d'annees pleine, pas une annee unique.
  function choisirCellule(siecle: number, decennie: number) {
    filters.siecles = [siecle];
    filters.anneeProtection = [decennie, Math.min(ANNEE_MAX, decennie + 9)];
  }

  async function hasard() {
    const ref = await auHasard(filters);
    if (ref) ouvrirFiche(ref);
  }

  const actifs = $derived(countActive(filters));
  const puces = $derived(jetonsActifs(filters));
  // Le tiroir ne se pose a cote de la carte qu'au large : c'est le seul cas ou
  // la legende et l'attribution, ancrees en bas a gauche, doivent s'ecarter
  // pour ne pas passer dessous. Une classe plutot qu'une chaine de pixels : la
  // largeur n'est ecrite qu'une fois, dans `--largeur-tiroir`.
  const tiroirPose = $derived(facettesOuvertes && !etroit);
</script>

<svelte:window onkeydown={surEchap} />

<svelte:head>
  <title>{titreFiche ? `${titreFiche} — Mérimée` : 'Mérimée — monuments historiques'}</title>
</svelte:head>

<div class="app">
  <header class="barre">
    <!-- La marque tient sur deux lignes : le filet vertical separait deux
         blocs poses cote a cote, il n'a plus rien a separer une fois la
         signature empilee sous le titre. -->
    <div class="marque">
      <strong>Mérimée</strong>
      <span class="sous">
        <span>Monuments historiques</span>
        <i class="filet" aria-hidden="true"></i>
        <span class="dates">1840 — 2026</span>
      </span>
    </div>

    <!-- Selecteur de vue, recherche et « Au hasard » forment un seul groupe
         centre. Les deux flancs portent `flex: 1 1 0` : a largeurs egales, le
         groupe tombe au milieu de la barre sans que rien ne le mesure. -->
    <div class="centre-barre">
      <nav class="bascule">
        {#each VUES as choix (choix.cle)}
          <!-- Trois boutons en rang : la zone de frappe ne s'etend qu'en
               hauteur, sinon celle de « Matrice » recouvrirait « Carte ». -->
          <button
            class="frappe-44-v"
            class:actif={vue === choix.cle}
            aria-pressed={vue === choix.cle}
            onclick={() => (vue = choix.cle)}
          >{choix.titre}</button>
        {/each}
      </nav>

      <div class="champ">
        <input
          class="recherche"
          type="search"
          aria-label={cible === 'historiques'
            ? 'Rechercher dans le texte des historiques'
            : 'Rechercher un édifice, une commune ou un département'}
          placeholder={cible === 'historiques'
            ? 'Chercher dans les historiques : jubé, machicoulis…'
            : 'Rechercher un édifice, une commune, un département…'}
          bind:value={terme}
        />
        <!-- Le bouton annonce ce qu'il engage, comme ceux des fonds historiques
             annoncent le poids de leurs tuiles : l'index pèse 3,8 Mo. -->
        <button
          class="cible"
          class:actif={cible === 'historiques'}
          aria-pressed={cible === 'historiques'}
          aria-busy={indexTexte.etat === 'chargement'}
          disabled={indexTexte.etat === 'indisponible'}
          title={indexTexte.etat === 'indisponible'
            ? 'Index plein texte absent de ce déploiement'
            : 'Chercher dans le texte des historiques — 3,8 Mo au premier usage'}
          onclick={() => (cible = cible === 'historiques' ? 'titres' : 'historiques')}
        >Historiques</button>
        <!-- Sur telephone le libelle cede la place a un de : la rangee du champ
             n'a pas la largeur des deux mots. Le nom accessible ne change pas. -->
        <button class="hasard" aria-label="Au hasard" title="Ouvrir une notice au hasard" onclick={hasard}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
               stroke-linejoin="round" aria-hidden="true">
            <rect x="4" y="4" width="16" height="16" rx="3.5" />
            <circle cx="9" cy="9" r="1.1" fill="currentColor" stroke="none" />
            <circle cx="15" cy="15" r="1.1" fill="currentColor" stroke="none" />
            <circle cx="15" cy="9" r="1.1" fill="currentColor" stroke="none" />
            <circle cx="9" cy="15" r="1.1" fill="currentColor" stroke="none" />
          </svg>
          <span class="libelle-hasard">Au hasard</span>
        </button>
      </div>
    </div>

    <!-- Un seul compteur : le total suit les filtres et c'est le seul qui
         reponde a « combien en reste-t-il ». Classes, inscrites et objets se
         relisent dans le tiroir, ou la facette « statut » les donne deja
         croises — les repeter ici etait une triple lecture du meme etat. -->
    <!-- Region live : seul le compte doit etre relu au changement, pas toute
         la barre. `aria-atomic` fait relire le nombre entier plutot que le
         seul chiffre modifie. -->
    <div class="chiffres" aria-live="polite" aria-atomic="true">
      {#if compteurs}
        <span><b>{nf.format(compteurs.total)}</b> notices</span>
      {/if}
      <!-- Le libelle est porte par `aria-label` et non par le texte : l'icone
           dit la destination (lune vers le sombre, soleil vers le clair), le
           nom accessible la nomme. -->
      <button class="theme frappe-44" onclick={basculer}
              aria-label={theme.courant === 'clair' ? 'Sombre' : 'Clair'}
              title={theme.courant === 'clair'
                ? 'Passer au thème sombre'
                : 'Passer au thème clair'}>
        {#if theme.courant === 'clair'}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M20.4 14.8A8.7 8.7 0 0 1 9.2 3.6 8.7 8.7 0 1 0 20.4 14.8Z" />
          </svg>
        {:else}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
               stroke-linecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="4.1" />
            <path d="M12 2.4v2.3M12 19.3v2.3M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.4 12h2.3M19.3 12h2.3M4.6 19.4 6.2 17.8M17.8 6.2l1.6-1.6" />
          </svg>
        {/if}
      </button>
    </div>
  </header>

  {#if puces.length > 0}
    <Jetons jetons={puces} {actifs} onretirer={retirerJeton} onreset={toutEffacer} />
  {/if}

  <main class:fiche-ouverte={selection !== null} class:tiroir-pose={tiroirPose}>
    <div class="centre">
      <div class="scene" class:tiroir-ouvert={facettesOuvertes} bind:clientHeight={hauteurScene}>
        <MonumentMap
          bind:this={vueCarte}
          points={pointsCarte}
          {selection}
          vueInitiale={cadrageInitial}
          bind:fond
          bind:suivreVue
          friseOuverte={friseOuverte}
          {reserveBas}
          onselect={ouvrirFiche}
          onbbox={(bbox) => (filters.bbox = bbox)}
        />

        {#if vue === 'matrice'}
          {#if MatriceComp}
            <MatriceComp
              cellules={croisement.cellules}
              ecartees={croisement.ecartees}
              siecleSelection={filters.siecles}
              plage={filters.anneeProtection}
              oncellule={choisirCellule}
            />
          {:else}
            <!-- Meme empreinte que Matrice : elle est en `position: absolute;
                 inset: 0`, donc le calque suffit a reserver sa place sans
                 dupliquer sa taille. -->
            <div class="matrice-attente" aria-hidden="true"></div>
          {/if}
        {/if}

        {#if vue === 'liste'}
          <div class="liste">
            <header>
              <h3>
                {compteurs ? nf.format(compteurs.total) : '—'} notices
                {#if compteurs && compteurs.total > resultats.length}
                  <em>
                    (200 premières, {proche
                      ? 'les plus proches'
                      : filters.texte
                        ? 'les plus pertinentes'
                        : 'les plus riches en mobilier'})
                  </em>
                {/if}
              </h3>
              {#if compteurs}
                <p>
                  {nf.format(compteurs.total - compteurs.geolocalises)} sans coordonnées,
                  absentes de la carte{proche ? ' et de ce tri' : ''}
                </p>
              {/if}
              <!-- La bascule n'existe qu'une fois la position connue : proposer
                   un tri par distance sans position serait un bouton mort. -->
              {#if position.courante}
                <div class="tri" role="group" aria-label="Ordre de la liste">
                  <button class="frappe-44-v" class:actif={tri === 'pertinence'}
                          aria-pressed={tri === 'pertinence'}
                          onclick={() => (tri = 'pertinence')}>
                    {filters.texte ? 'Pertinence' : 'Mobilier'}
                  </button>
                  <button class="frappe-44-v" class:actif={tri === 'proximite'}
                          aria-pressed={tri === 'proximite'}
                          onclick={() => (tri = 'proximite')}>À proximité</button>
                </div>
              {/if}
              <!-- Le plafond de la recherche plein texte se dit : une notice sur
                   deux ne porte aucun historique, et un résultat vide serait
                   autrement indiscernable d'un filtre trop serré. -->
              {#if cible === 'historiques' && indexTexte.stats}
                <p class="portee">
                  Recherche dans les {nf.format(indexTexte.stats.n)} notices qui portent
                  un historique.
                  {#if indexTexte.inconnus.length}
                    <b>
                      {indexTexte.inconnus.map((mot) => `« ${mot} »`).join(', ')}
                      n'apparaî{indexTexte.inconnus.length > 1 ? 'ssent' : 't'} dans aucun.
                    </b>
                  {/if}
                </p>
              {/if}
            </header>
            <ul>
              {#each resultats as ligne (ligne.reference)}
                <li>
                  <button
                    class:choisi={selection === ligne.reference}
                    onclick={() => ouvrirFiche(ligne.reference)}
                  >
                    <span class="nom">{ligne.titre}</span>
                    <span class="meta">
                      {#if ligne.distance_m != null}<b class="distance">à {formaterDistance(ligne.distance_m)}</b> · {/if}
                      {ligne.commune} · {ligne.departement_nom}
                      {#if ligne.nb_palissy > 0}· {nf.format(ligne.nb_palissy)} objets{/if}
                    </span>
                  </button>
                </li>
              {/each}
            </ul>
            {#if compteurs && compteurs.total === 0}
              <!-- En mode historiques, `.portee` dit deja pourquoi — le
                   plafond structurel et les mots inconnus — pas de doublon,
                   seul le bouton s'ajoute. -->
              <div class="vide-liste">
                {#if cible !== 'historiques'}
                  <p>Aucune notice ne correspond à ces filtres.</p>
                {/if}
                <button onclick={toutEffacer}>Effacer les filtres</button>
              </div>
            {/if}
          </div>
        {/if}

        {#if erreur}
          <div class="erreur"><b>Erreur DuckDB</b><p>{erreur}</p></div>
        {:else if chargement && !compteurs}
          <div class="amorce">{LIBELLES[amorcage.phase]}</div>
        {:else if vue === 'carte' && compteurs && compteurs.total === 0}
          <!-- Meme famille visuelle que `.amorce` / `.erreur` : une surface
               posee au centre de la scene, qui ne recouvre aucun coin — les
               commandes de la carte y vivent toutes. -->
          <div class="vide-carte">
            <p>Aucune notice ne correspond à ces filtres.</p>
            <button onclick={toutEffacer}>Effacer les filtres</button>
          </div>
        {/if}

        <!-- Des points precalcules sont deja a l'ecran pendant que le moteur
             finit de charger : l'attente se dit dans une pastille, qui ne
             couvre pas la carte qu'on regarde deja. -->
        {#if !erreur && compteurs && amorcage.phase !== 'pret'}
          <div class="amorce-discrete" role="status">{LIBELLES[amorcage.phase]}</div>
        {/if}

        {#if position.erreur}
          <div class="alerte-position" role="alert">
            <p>{MESSAGES_POSITION[position.erreur]}</p>
            <button class="frappe-44" aria-label="Fermer le message"
                    onclick={() => (position.erreur = null)}>×</button>
          </div>
        {/if}

        <!-- Le tiroir se commande depuis le coin de la carte, la ou il
             s'ouvre, et non plus depuis la barre. Il s'efface tant qu'il est
             ouvert : la croix de l'en-tete du tiroir est alors le seul geste
             de fermeture, et le bouton revient avec elle. -->
        {#if !facettesOuvertes}
          <button class="filtres frappe-44" aria-expanded="false"
                  bind:this={boutonFiltres} onclick={ouvrirTiroir}>
            Filtres{#if actifs > 0} <em>{actifs}</em>{/if}
          </button>
        {/if}

        <!-- Les deux panneaux sont des calques : la carte garde sa pleine
             largeur et les ouvrir ne provoque aucun redimensionnement du
             canevas WebGL. Ils vivent dans la scene, pas dans `main`, pour
             laisser la frise entierement visible sous eux. -->
        <div class="colonne facettes" class:ouvert={facettesOuvertes}>
          <div class="entete-tiroir">
            <h2 tabindex="-1" bind:this={titreTiroir}>Filtres</h2>
            <button class="fermer-tiroir frappe-44" aria-label="Fermer les filtres"
                    onclick={fermerTiroir}>×</button>
          </div>
          <!-- La zone visible est un critere comme un autre : elle rejoint
               les facettes plutot que la legende de la carte, ou elle voisinait
               des commandes d'affichage qui ne filtrent rien. -->
          <label class="zone">
            <input type="checkbox" bind:checked={suivreVue} />
            <span>Limiter à la zone visible sur la carte</span>
          </label>
          <FacetPanel {facettes} {cardinaux} {chargement} />
        </div>

        {#if etroit && facettesOuvertes}
          <!-- Fermer en touchant a cote : le geste attendu sur un tiroir. Au
               large le tiroir ne recouvre rien, il n'y a rien a voiler. -->
          <button class="voile" aria-label="Fermer les filtres"
                  onclick={fermerTiroir}></button>
        {/if}

        <div class="colonne fiche-hote" class:ouvert={selection !== null}
             class:plein={cran === 'plein'} class:glisse={decalage !== null}
             style:transform={decalage !== null ? `translateY(${decalage}px)` : undefined}>
          <!-- Poignee de la feuille, telephone seulement. Un toucher bascule le
               cran, un glissement le deplace, tirer vers le bas ferme ; au
               clavier, Entree bascule. Rendue **seulement fiche ouverte** :
               feuille fermee, elle restait un bouton focusable sous le bord de
               l'ecran, invisible au clavier comme au lecteur d'ecran. -->
          {#if selection !== null}
            <button class="poignee" aria-expanded={cran === 'plein'}
                    aria-label={cran === 'plein' ? 'Réduire la fiche' : 'Agrandir la fiche'}
                    onpointerdown={saisirPoignee} onpointermove={glisserPoignee}
                    onpointerup={lacherPoignee} onpointercancel={annulerPoignee}
                    onclick={clavierPoignee}>
              <span aria-hidden="true"></span>
            </button>
          {/if}
          <DetailPanel reference={selection} {copie} oncopier={copierLien}
                       bind:this={detailPanel} onclose={fermerFiche}
                       ontitre={(t) => (titreFiche = t)}
                       ondefile={() => {
                         if (telephone && cran === 'apercu' && decalage === null) cran = 'plein';
                       }} />
        </div>
      </div>

      <!-- La frise se replie a toutes les largeurs, plus seulement sur
           telephone : c'est le tiers bas de l'ecran qu'elle rend a la carte.
           Meme dispositif que le tiroir des filtres — la croix est dans le
           panneau, le bouton qui le rouvre prend sa place. -->
      {#if friseOuverte}
        {#if TimelineComp}
          <TimelineComp
            siecles={barresSiecles}
            protections={barresAnnees}
            siecleSelection={filters.siecles}
            plage={filters.anneeProtection}
            onsiecle={toggleSiecle}
            onsiecles={(choix) => (filters.siecles = choix)}
            onplage={(p) => (filters.anneeProtection = p)}
            onfermer={() => (friseOuverte = false)}
          />
        {:else}
          <!-- Hauteur mesuree du panneau reel (deux graphiques de 104px, ses
               paddings et son entete) : sans elle, l'arrivee du chunk Plot
               ferait bondir la carte au moment ou <Timeline> apparait. -->
          <div class="frise-attente" aria-hidden="true"></div>
        {/if}
      {:else}
        <button class="replier frappe-44-v" aria-expanded="false"
                onclick={() => (friseOuverte = true)}>
          Afficher les frises
        </button>
      {/if}
    </div>
  </main>

  <!-- Onglets du pied, telephone seulement : les vues sous le pouce, et la
       barre du haut rendue a la marque et a la recherche. Ils remplacent le
       selecteur de la barre et le bandeau « Afficher les frises », masques a
       cette largeur ; tablette et ordinateur n'en voient rien. -->
  <nav class="onglets" aria-label="Vues">
    {#each VUES as choix (choix.cle)}
      <button class:actif={vue === choix.cle} aria-pressed={vue === choix.cle}
              onclick={() => (vue = choix.cle)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          {#if choix.cle === 'carte'}
            <path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6z" /><path d="M9 4v14M15 6v14" />
          {:else if choix.cle === 'matrice'}
            <rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" />
            <rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" />
          {:else}
            <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
          {/if}
        </svg>
        <span>{choix.titre}</span>
      </button>
    {/each}
    <button class:actif={friseOuverte} aria-expanded={friseOuverte}
            onclick={() => (friseOuverte = !friseOuverte)}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
           stroke-linecap="round" aria-hidden="true">
        <path d="M4 20h16M7 20v-6M11 20V8M15 20v-9M19 20v-4" />
      </svg>
      <span>Frises</span>
    </button>
  </nav>
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    /* `100vh` compte la bande que la barre d'adresse mobile recouvre : au
       repli de celle-ci pendant un defilement, la scene changeait de hauteur,
       ce qui redimensionnait le canevas et reconstruisait les deux frises.
       `dvh` suit la hauteur reellement visible ; `vh` reste en repli pour les
       navigateurs qui ne la connaissent pas. */
    height: 100vh;
    height: 100dvh;
  }

  /* Une rangee qui s'enroule, pas une grille a colonnes fixes : les compteurs
     et les actions occupent une largeur qui depend des donnees, et une piste
     `1fr` leur cedait tout — le champ de recherche tombait a trois
     caracteres. Le centrage du groupe median vient des deux flancs, qui
     portent la meme base souple : ils se partagent le reste a parts egales,
     donc ce qui est entre eux tombe au milieu sans qu'aucune largeur soit
     ecrite. */
  .barre {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 20px;
    /* Seuls le haut et les cotes touchent un bord physique de l'ecran :
       `--sa-*` vaut 0 hors iOS, aucun changement ailleurs. */
    padding: calc(12px + var(--sa-haut)) calc(24px + var(--sa-droite)) 12px calc(24px + var(--sa-gauche));
    min-height: 72px;
    background: var(--fond-carte);
    border-bottom: 1px solid var(--bord);
  }

  /* La marque passe en serif editorial et en casse normale : les capitales
     espacees la faisaient lire comme une etiquette, pas comme un titre. Elle
     tient sur deux lignes : le titre seul, puis sa signature dessous. */
  .marque {
    display: flex;
    flex: 1 1 0;
    flex-direction: column;
    align-items: flex-start;
    gap: 5px;
    min-width: 0;
  }

  .marque strong {
    font-family: var(--police-titre);
    font-size: 25px;
    font-weight: 500;
    letter-spacing: -0.005em;
    line-height: 1;
    color: var(--texte);
  }

  /* Le filet est desormais horizontal : il ponctue la signature au lieu de
     separer deux blocs poses cote a cote. */
  .filet {
    width: 12px;
    height: 1px;
    background: var(--bord-appuye);
  }

  /* Une base declaree et non `auto` : la contribution max-content d'un
     conteneur flex imbrique ne reprend pas la base de ses enfants, et le champ
     retombait a une vingtaine de caracteres entre ses deux boutons. Les deux
     flancs se partagent ce qui reste, ce qui centre le groupe. */
  .centre-barre {
    display: flex;
    flex: 0 1 700px;
    align-items: center;
    justify-content: center;
    gap: 14px;
    min-width: 0;
  }

  .sous {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.2em;
    line-height: 1.2;
    text-transform: uppercase;
    color: var(--texte-tenu);
    white-space: nowrap;
  }

  .dates {
    color: var(--inscrit-texte);
    font-variant-numeric: tabular-nums;
  }

  /* Le champ, sa bascule de cible et « Au hasard » tiennent ensemble dans la
     rangee qui s'enroule : separes, les boutons partaient a la ligne des
     compteurs. */
  .champ {
    display: flex;
    flex: 1 1 auto;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .cible {
    flex: 0 0 auto;
    height: 44px;
    padding: 0 14px;
    background: transparent;
    border: 1px solid var(--bord);
    border-radius: var(--r-pilule);
    color: var(--texte-tenu);
    font-size: 12px;
    white-space: nowrap;
    cursor: pointer;
    transition:
      border-color var(--t-rapide),
      color var(--t-rapide);
  }

  /* `:not(.actif)` n'est pas une precaution de style, c'est ce qui rend le
     bouton lisible une fois active. Sans lui, ce selecteur pese (0,4,0) contre
     (0,3,0) pour `.cible.actif` : sa `color` gagne, le `background` de l'etat
     actif reste, et comme `--texte` **vaut exactement** `--plein-fond` dans les
     deux themes, le libelle disparait dans son propre fond — mesure a 1,00:1.
     Au pointeur fin le texte revient des que la souris s'ecarte ; au tactile
     le `:hover` reste colle jusqu'au geste suivant, et la pastille reste
     vide. */
  @media (hover: hover) and (pointer: fine) {
    .cible:hover:not(:disabled):not(.actif) {
      color: var(--texte);
      border-color: var(--inscrit);
    }
  }

  .cible.actif {
    background: var(--plein-fond);
    border-color: var(--plein-fond);
    color: var(--plein-texte);
  }

  .cible[aria-busy='true'] {
    opacity: 0.6;
    cursor: progress;
  }

  .cible:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* 44 px et non 40 : un `<input>` n'accepte pas de pseudo-element, donc la
     zone de frappe etendue lui est interdite — sa hauteur reelle est la seule
     cible qu'il ait. Ses deux voisins de la barre suivent, sinon le groupe
     median se desaligne. */
  .recherche {
    flex: 1 1 auto;
    min-width: 0;
    height: 44px;
    padding: 0 16px 0 38px;
    background:
      var(--icone-recherche) no-repeat 14px 50% / 15px 15px,
      var(--fond-creux);
    border: 1px solid var(--bord);
    border-radius: var(--r-pilule);
    color: var(--texte);
    font-size: 13px;
    /* Le texte de substitution est plus long que le champ, meme a 1920 px ou le
       groupe median est borne a 700 px : sans cela il se coupe en plein mot,
       sans rien qui signale qu'il manque quelque chose. */
    text-overflow: ellipsis;
    transition:
      border-color var(--t-rapide),
      background-color var(--t-rapide);
  }

  /* Sous 16 px, Safari iOS zoome toute la page a la mise au point du champ et
     ne la dezoome pas en sortant. Au doigt seulement : a la souris, le 13 px
     garde la barre a sa densite. */
  @media (pointer: coarse) {
    .recherche {
      font-size: 16px;
    }
  }

  .recherche::placeholder {
    color: var(--texte-tenu);
  }

  /* Le creux est plein, non fondu a 72 % : la barre est posee sur
     `--fond-carte`, la surface la plus claire du produit, et un champ presque
     transparent s'y confondait. Au focus il remonte au niveau de la barre, ce
     qui inverse le rapport et signale la saisie. */
  .recherche:focus {
    outline: none;
    border-color: var(--inscrit);
    background-color: var(--fond-carte);
  }

  .recherche::-webkit-search-cancel-button {
    filter: grayscale(1);
    opacity: 0.5;
  }

  .chiffres {
    display: flex;
    flex: 1 1 0;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 10px 14px;
    min-width: 0;
    font-size: 11.5px;
    color: var(--texte-tenu);
  }

  .chiffres b {
    font-family: var(--police-titre);
    font-size: 16px;
    font-weight: 500;
    color: var(--texte);
    font-variant-numeric: tabular-nums;
  }

  /* « Au hasard » se pose au bout du champ : c'est l'autre facon d'entrer dans
     le corpus quand on ne sait pas quoi y chercher. Meme hauteur que le champ
     et que la bascule de cible, sinon la rangee se decale d'un pixel. */
  .hasard svg {
    display: none;
    width: 19px;
    height: 19px;
  }

  .hasard {
    flex: 0 0 auto;
    height: 44px;
    padding: 0 15px;
    border: 1px solid var(--bord-appuye);
    border-radius: var(--r-pilule);
    background: var(--fond-carte);
    color: var(--inscrit-texte);
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
    transition: all var(--t-rapide);
  }

  @media (hover: hover) and (pointer: fine) {
    .hasard:hover {
      border-color: var(--inscrit);
      background: color-mix(in srgb, var(--inscrit) 10%, var(--fond-carte));
    }
  }

  /* Une pastille sans libelle : le theme est un confort de lecture, il n'a pas
     a peser autant qu'une action d'exploration. Le trait de l'icone est
     `currentColor`, il suit donc le jeton de couleur comme le reste. */
  .theme {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    border: 1px solid var(--bord);
    border-radius: 50%;
    background: transparent;
    color: var(--texte-faible);
    cursor: pointer;
    transition: all var(--t-rapide);
  }

  @media (hover: hover) and (pointer: fine) {
    .theme:hover {
      color: var(--texte);
      border-color: var(--bord-appuye);
    }
  }

  .theme svg {
    width: 16px;
    height: 16px;
  }

  /* Le tiroir se commande depuis le coin ou il s'ouvre, avec le compte des
     criteres poses : c'est tout ce qui en reste visible une fois referme.
     z-index 4 : au-dessus de la liste et de la matrice (3), qui recouvrent la
     scene et pour lesquelles les filtres comptent autant, mais sous le voile
     (5) et le tiroir (6), qu'il n'a pas a percer.

     C'est une surface posee, pas un aplat plein. Le fond de carte suit
     desormais le theme, mais cela ne change rien ici : le bouton appartient a
     l'interface et suit le theme comme la legende — calcaire en clair, ardoise
     en sombre, detache de la carte par son filet et son ombre. En aplat
     inverse il etait presque noir sur une carte noire en sombre, et il serait
     ardoise sur du grege en clair : dans les deux cas un trou, jamais une
     commande. Son filet est `--bord-flottant` et non `--bord-appuye` : sur les
     terres gregees, tous les filets d'interface sont plus clairs que le sol et
     disparaissent. */
  .filtres {
    position: absolute;
    top: 12px;
    left: 12px;
    z-index: 4;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    border: 1px solid var(--bord-flottant);
    background: var(--fond-carte);
    color: var(--texte);
    border-radius: var(--r-pilule);
    padding: 9px 16px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    box-shadow: var(--ombre-carte);
    transition: all var(--t-rapide);
  }

  @media (hover: hover) and (pointer: fine) {
    .filtres:hover {
      border-color: var(--accent);
      color: var(--accent);
    }
  }

  .filtres em {
    font-style: normal;
    font-variant-numeric: tabular-nums;
    min-width: 17px;
    padding: 1px 5px;
    border-radius: var(--r-pilule);
    background: var(--accent-plein);
    color: var(--texte-sur-plein);
    font-size: 10.5px;
    text-align: center;
  }

  /* La case de zone visible se pose sous l'en-tete du tiroir, hors de la
     partie qui defile : c'est un critere de cadrage, pas une facette de plus. */
  /* La case elle-meme fait 15 px, mais c'est le label qui recoit le clic : sa
     hauteur est donc la vraie cible, portee ici a 44 px. Agrandir la case
     aurait donne une coche disproportionnee dans un tiroir dense. */
  .zone {
    display: flex;
    align-items: center;
    min-height: 44px;
    gap: 9px;
    padding: 0 22px 14px;
    background: var(--fond-carte);
    font-size: 12px;
    color: var(--texte-moyen);
    cursor: pointer;
  }

  .zone input {
    flex: 0 0 auto;
    width: 15px;
    height: 15px;
    accent-color: var(--accent-plein);
    cursor: pointer;
  }

  /* Selecteur de vue : un rail creux, la vue active est une pastille posee. */
  .bascule {
    display: flex;
    gap: 2px;
    padding: 3px;
    background: var(--fond-creux);
    border-radius: var(--r-pilule);
  }

  .bascule button {
    border: none;
    background: transparent;
    color: var(--texte-faible);
    border-radius: var(--r-pilule);
    padding: 7px 16px;
    font-size: 12.5px;
    font-weight: 500;
    cursor: pointer;
    transition: all var(--t-rapide);
  }

  @media (hover: hover) and (pointer: fine) {
    .bascule button:hover {
      background: color-mix(in srgb, var(--bord) 60%, transparent);
      color: var(--texte);
    }
  }

  .bascule button.actif {
    background: var(--fond-carte);
    color: var(--texte);
    font-weight: 600;
    box-shadow: 0 2px 6px -2px rgb(var(--voile) / 18%);
  }

  main {
    display: grid;
    flex: 1;
    min-height: 0;
    position: relative;
    --largeur-fiche: 392px;
  }

  /* Les commandes MapLibre s'ecartent des deux calques. Les largeurs vivent
     dans des variables pour que les marges les suivent sans que la page ait a
     connaitre le point de rupture — et la fiche flottant a 12 px du bord, sa
     marge les compte. */
  main.fiche-ouverte {
    --marge-droite: calc(var(--largeur-fiche) + 12px);
  }

  main.tiroir-pose {
    --marge-gauche: var(--largeur-tiroir);
  }

  .centre {
    display: grid;
    grid-template-rows: 1fr auto;
    min-width: 0;
    min-height: 0;
  }

  /* La scene porte `--carte-terre` : la couleur que le fond de carte va peindre.
     C'est ce qui supprime le flash entre le montage — ou une bascule de theme,
     qui recharge la feuille de style — et le premier rendu WebGL. En sombre le
     jeton vaut l'ardoise : pixel identique a ce qui etait ecrit ici avant. */
  .scene {
    position: relative;
    min-height: 0;
    overflow: hidden;
    background: var(--carte-terre);
    /* Empreinte du bouton flottant. La liste et la matrice recouvrent la scene :
       sans cette reserve leur titre passerait dessous. Meme procede que
       `--marge-gauche` pour les commandes MapLibre — le composant ne connait
       pas le bouton, il lit une variable heritee. */
    --reserve-filtres: 126px;
  }

  .scene.tiroir-ouvert {
    --reserve-filtres: 0px;
  }

  /* Les controles MapLibre sont a z-index 2 et la carte reste montee sous les
     autres vues : sans cela le zoom et l'attribution traversent le calque. */
  .liste {
    position: absolute;
    inset: 0;
    z-index: 3;
    overflow-y: auto;
    /* Sans cela, tirer vers le bas en haut de la liste remonte au navigateur
       et declenche le pull-to-refresh : rechargement complet du wasm et perte
       de l'exploration en cours. */
    overscroll-behavior: contain;
    background: var(--fond);
  }

  /* Le selecteur de vue est monte dans la barre : la reserve de 200 px qu'il
     imposait ici n'a plus lieu d'etre. */
  .liste header {
    position: sticky;
    top: 0;
    padding: 14px 20px 12px calc(20px + var(--reserve-filtres, 0px));
    transition: padding-left var(--t-tiroir);
    border-bottom: 1px solid var(--bord);
    background: var(--fond-carte);
  }

  .liste h3 {
    margin: 0;
    font-family: var(--police-titre);
    font-size: 17px;
    font-weight: 500;
    color: var(--texte);
  }

  .liste h3 em {
    font-style: normal;
    font-weight: 400;
    color: var(--texte-faible);
  }

  .liste header p {
    margin: 3px 0 0;
    font-size: 11px;
    color: var(--texte-faible);
  }

  /* Le mot introuvable est la seule chose que l'utilisateur doit lire ici :
     il porte l'encre pleine, le reste de la ligne reste tenu. */
  .portee b {
    color: var(--texte);
    font-weight: 500;
  }

  .liste ul {
    list-style: none;
    margin: 0;
    padding: 8px;
  }

  .liste button {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    padding: 8px 12px;
    background: none;
    border: none;
    border-radius: var(--r-s);
    text-align: left;
    cursor: pointer;
    transition: background var(--t-rapide);
  }

  @media (hover: hover) and (pointer: fine) {
    .liste button:hover {
      background: var(--fond-creux);
    }
  }

  .liste button.choisi {
    background: var(--accent-doux);
  }

  /* Pose au fil de la liste plutot qu'en surface flottante : elle n'a rien a
     recouvrir, contrairement a son equivalent sur la vue carte. */
  .vide-liste {
    display: grid;
    gap: 10px;
    padding: 24px 20px;
    text-align: center;
    color: var(--texte-faible);
    font-size: 12.5px;
  }

  .vide-liste button {
    justify-self: center;
    border: 1px solid var(--bord-appuye);
    border-radius: var(--r-pilule);
    background: transparent;
    color: var(--accent);
    padding: 7px 16px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: border-color var(--t-rapide);
  }

  @media (hover: hover) and (pointer: fine) {
    .vide-liste button:hover {
      border-color: var(--accent);
    }
  }

  .nom {
    font-size: 13.5px;
    font-weight: 500;
    color: var(--texte);
  }

  .meta {
    font-size: 11px;
    color: var(--texte-faible);
  }

  .amorce,
  .erreur {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    z-index: 3;
    padding: 16px 24px;
    border: none;
    border-radius: var(--r-m);
    background: var(--fond-carte);
    box-shadow: var(--ombre-carte);
    font-size: 12px;
    color: var(--texte-faible);
    text-align: center;
    max-width: 460px;
  }

  .erreur b {
    color: var(--erreur);
  }

  .erreur p {
    margin: 6px 0 0;
    font-family: ui-monospace, monospace;
    font-size: 11px;
    word-break: break-word;
  }

  /* Meme dispositif que `.amorce` / `.erreur` ci-dessus : une surface posee au
     centre de la scene, qui ne recouvre aucun coin — les commandes de la
     carte y vivent toutes. */
  .vide-carte {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    z-index: 3;
    display: grid;
    gap: 10px;
    padding: 18px 24px;
    border: none;
    border-radius: var(--r-m);
    background: var(--fond-carte);
    box-shadow: var(--ombre-carte);
    font-size: 12px;
    color: var(--texte-faible);
    text-align: center;
    max-width: 320px;
  }

  .vide-carte button {
    justify-self: center;
    border: 1px solid var(--bord-appuye);
    border-radius: var(--r-pilule);
    background: transparent;
    color: var(--accent);
    padding: 7px 16px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: border-color var(--t-rapide);
  }

  @media (hover: hover) and (pointer: fine) {
    .vide-carte button:hover {
      border-color: var(--accent);
    }
  }

  /* --- Les deux calques ---------------------------------------------------
     Aucun `backdrop-filter` : un flou plein ecran au-dessus d'un canevas WebGL
     se paie a chaque image. Fond opaque, ombre portee. */
  .colonne {
    position: absolute;
    display: grid;
    min-height: 0;
    transition: transform var(--t-tiroir);
  }

  /* Filet **a droite seulement** : le tiroir occupe toute la hauteur, un cadre
     complet tracerait une ligne au ras du haut et du bas de la fenetre. Il n'en
     avait aucun tant que la carte etait ardoise, ou l'ivoire se detachait seul. */
  .facettes {
    inset: 0 auto 0 0;
    z-index: 6;
    grid-template-rows: auto auto 1fr;
    width: var(--largeur-tiroir);
    border-right: 1px solid var(--bord-flottant);
    transform: translateX(-100%);
    box-shadow: var(--ombre-tiroir);
    /* Bord gauche et pied de l'ecran : les deux touchent un bord physique.
       Applique une fois ici, en tete du calque, plutot que dans chacun de
       ses trois enfants. */
    padding-left: var(--sa-gauche);
    padding-bottom: var(--sa-bas);
  }

  .facettes.ouvert {
    transform: translateX(0);
  }

  /* En-tete du tiroir : le titre nomme ce qu'on ouvre, la pastille le referme.
     Un bandeau texte pleine largeur disait la meme chose en moins clair. */
  .entete-tiroir {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 22px 14px;
    background: var(--fond-carte);
  }

  .entete-tiroir h2 {
    margin: 0;
    font-family: var(--police-titre);
    font-size: 22px;
    font-weight: 500;
    color: var(--texte);
  }

  .fermer-tiroir {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--texte-faible);
    font-size: 17px;
    line-height: 1;
    cursor: pointer;
    transition: background var(--t-rapide);
  }

  @media (hover: hover) and (pointer: fine) {
    .fermer-tiroir:hover {
      background: var(--fond-creux);
      color: var(--texte);
    }
  }

  /* La fiche ne compresse plus la carte : elle flotte par-dessus, et seulement
     quand une notice est choisie. L'invite « selectionnez un point » n'a donc
     plus 392 px a occuper en permanence. Le decalage de sortie compte la marge,
     sinon l'ombre reste visible sur le bord. */
  .fiche-hote {
    inset: 12px 12px 12px auto;
    z-index: 7;
    width: var(--largeur-fiche);
    /* `box-sizing: border-box` est global : la largeur reste `--largeur-fiche`,
       le filet ne decale aucune geometrie mesuree par les tests. */
    border: 1px solid var(--bord-flottant);
    border-radius: var(--r-l);
    overflow: hidden;
    transform: translateX(calc(100% + 16px));
    box-shadow: var(--ombre-fiche);
  }

  .fiche-hote.ouvert {
    transform: translateX(0);
  }

  .voile {
    display: none;
  }

  /* Poignee et onglets n'existent que sur telephone, cf. le gabarit plus bas. */
  .poignee,
  .onglets {
    display: none;
  }

  /* Bascule d'ordre de la liste : meme rail que le selecteur de vue. */
  .tri {
    display: inline-flex;
    gap: 2px;
    margin-top: 8px;
    padding: 2px;
    background: var(--fond-creux);
    border-radius: var(--r-pilule);
  }

  .liste .tri button {
    display: inline-block;
    width: auto;
    padding: 5px 13px;
    border-radius: var(--r-pilule);
    color: var(--texte-faible);
    font-size: 11.5px;
    font-weight: 500;
  }

  .liste .tri button.actif {
    background: var(--fond-carte);
    color: var(--texte);
    font-weight: 600;
    box-shadow: 0 2px 6px -2px rgb(var(--voile) / 18%);
  }

  .meta .distance {
    font-weight: 600;
    color: var(--position);
  }

  /* L'attente du moteur quand la carte a deja ses points : une pastille en
     haut, au centre, sous le bouton des filtres et hors des coins d'outils. */
  .amorce-discrete {
    position: absolute;
    top: 14px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 3;
    padding: 6px 14px;
    border: 1px solid var(--bord-flottant);
    border-radius: var(--r-pilule);
    background: var(--fond-carte);
    box-shadow: var(--ombre-carte);
    font-size: 11px;
    color: var(--texte-faible);
    white-space: nowrap;
    pointer-events: none;
  }

  /* Meme famille que `.vide-carte`, mais en haut : l'erreur de position ne
     doit pas cacher l'endroit de la carte qu'on regardait. */
  .alerte-position {
    position: absolute;
    top: 64px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 4;
    display: flex;
    align-items: center;
    gap: 10px;
    width: max-content;
    max-width: calc(100% - 24px);
    padding: 10px 10px 10px 16px;
    border: 1px solid var(--bord-flottant);
    border-radius: var(--r-m);
    background: var(--fond-carte);
    box-shadow: var(--ombre-carte);
    font-size: 12px;
    color: var(--texte-moyen);
  }

  .alerte-position p {
    margin: 0;
  }

  .alerte-position button {
    flex: 0 0 auto;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--texte-faible);
    font-size: 17px;
    line-height: 1;
    cursor: pointer;
  }

  /* Bandeau plein largeur : il ne coute sa hauteur que lorsque la frise est
     repliee, et dit ou elle est partie. */
  .replier {
    display: block;
    width: 100%;
    border: none;
    border-top: 1px solid var(--bord);
    background: var(--fond);
    color: var(--texte-faible);
    /* Dernier element de la page : son pied touche le bord physique. */
    padding: 8px 8px calc(8px + var(--sa-bas));
    font-size: 11px;
    cursor: pointer;
    transition: color var(--t-rapide);
  }

  @media (hover: hover) and (pointer: fine) {
    .replier:hover {
      color: var(--texte);
    }
  }

  /* Emplacements reserves le temps que le chunk Plot arrive, cf. le
     commentaire du script. La matrice se contente de remplir son calque
     (`position: absolute; inset: 0`, identique au composant reel) ; la frise
     n'a pas ce luxe, elle occupe une ligne de grille dimensionnee par son
     contenu, d'ou la hauteur mesuree en dur ci-dessous — directement sur le
     panneau reel, aux deux gabarits, pas deduite des paddings. */
  .matrice-attente {
    position: absolute;
    inset: 0;
    z-index: 3;
    background: var(--fond);
  }

  .frise-attente {
    height: 168px;
    border-top: 1px solid var(--bord);
    background: var(--frise-fond);
  }

  @media (max-width: 900px) {
    .frise-attente {
      height: 317px;
    }
  }

  /* Au-dela de 1440 px, la liste laissait pres de la moitie de l'ecran vide a
     droite : chaque entree est une ligne pleine largeur cliquable, donc ce vide
     n'etait meme pas une colonne de lecture bornee. Le contenu se recentre sur
     1120 px — titre et entrees ensemble, sans quoi les deux se desaligneraient.
     Le seuil n'est pas cosmetique : la reserve du bouton flottant est
     neutralisee ici, et il faut que la marge laissee par le centrage
     (160 px a 1440) depasse l'empreinte du bouton (108 px avec son badge),
     sinon le titre repasserait dessous. */
  @media (min-width: 1440px) {
    .liste header {
      padding-left: 20px;
    }

    .liste header h3,
    .liste header p,
    .liste ul {
      max-width: 1120px;
      margin-inline: auto;
    }
  }

  @media (max-width: 1320px) {
    main {
      --largeur-fiche: 352px;
    }

    /* Les flancs se partagent ce que le groupe median laisse : sous 1320 px
       leur part passe sous la largeur de la signature complete. Les dates
       cedent avant le sous-titre, elles se relisent dans la frise. */
    .marque .filet,
    .marque .dates {
      display: none;
    }
  }

  /* Sous 1150 px le groupe median prend sa propre rangee plutot que de se
     reduire : `flex-basis: 100%` suffit, la barre s'enroulant deja. Les deux
     flancs restent seuls sur la premiere ligne et s'y repartissent. */
  @media (max-width: 1150px) {
    .barre {
      padding: calc(10px + var(--sa-haut)) calc(16px + var(--sa-droite)) 10px calc(16px + var(--sa-gauche));
      gap: 10px 16px;
    }

    .centre-barre {
      order: 3;
      flex-basis: 100%;
      max-width: none;
    }

    .champ {
      max-width: none;
    }
  }

  /* --- Gabarit moyen ------------------------------------------------------
     Le tiroir recouvre la carte au lieu de se poser a cote : la place manque.
     Il se ferme donc en touchant a cote, et la frise se replie. */
  @media (max-width: 900px) {
    .barre {
      padding: calc(10px + var(--sa-haut)) calc(12px + var(--sa-droite)) 10px calc(12px + var(--sa-gauche));
      gap: 10px 12px;
    }

    .marque .sous {
      display: none;
    }

    .marque strong {
      font-size: 23px;
    }

    /* Le groupe median s'enroule a son tour : le selecteur de vue sur une
       ligne, le champ et ses deux boutons sur la suivante. */
    .centre-barre {
      flex-wrap: wrap;
      gap: 10px;
    }

    .champ {
      flex-basis: 100%;
    }

    .cible,
    .hasard {
      padding: 0 11px;
    }

    .chiffres {
      gap: 8px;
      font-size: 11px;
    }

    /* La liste et la matrice occupent toute la scene sur un ecran etroit : le
       bouton flottant se pose au-dessus de leur titre, et non plus a cote. */
    .scene {
      --reserve-filtres: 0px;
    }

    .liste header {
      padding-top: 58px;
    }

    .voile {
      display: block;
      position: absolute;
      inset: 0;
      z-index: 5;
      border: none;
      padding: 0;
      background: rgb(var(--voile) / 45%);
      cursor: pointer;
    }

    .facettes {
      width: min(84vw, 320px);
    }

  }

  /* --- Gabarit telephone --------------------------------------------------
     La fiche remonte du bas plutot que de glisser du cote : 340 px de large
     sur un ecran de 375 ne laisseraient rien voir de la carte derriere. */
  @media (max-width: 768px) {
    /* La feuille remonte du bas : elle ne masque plus rien a droite. */
    main.fiche-ouverte {
      --marge-droite: 0px;
    }

    /* Hauteur **definie**, et flex plutot que la grille de `.colonne`. Avec un
       simple `max-height`, la hauteur restait indefinie : la rangee implicite
       de la grille prenait toute la hauteur du contenu, `overflow: hidden`
       rognait le bas, et `.fiche` n'avait jamais rien a faire defiler — la
       moitie de la notice etait inatteignable. En flex colonne, l'enfant
       `min-height: 0` se contracte a la boite et son `overflow-y` reprend. */
    .fiche-hote {
      inset: auto 0 0 0;
      display: flex;
      flex-direction: column;
      width: auto;
      height: calc(100% - 8px);
      border-radius: var(--r-l) var(--r-l) 0 0;
      transform: translateY(101%);
    }

    .fiche-hote > :global(.fiche) {
      flex: 1 1 auto;
      min-height: 0;
    }

    /* Deux crans. L'apercu cache 55 % de la feuille sous le bord (`PART_CACHEE`
       dans le script, a garder egal) ; depliee, elle monte entiere. */
    .fiche-hote.ouvert {
      transform: translateY(55%);
    }

    .fiche-hote.ouvert.plein {
      transform: translateY(0);
    }

    /* Pendant le glissement le `transform` en ligne suit le doigt : une
       transition le ferait trainer derriere lui. */
    .fiche-hote.glisse {
      transition: none;
    }

    /* En apercu, la photographie est bornee plus bas : a 48dvh elle occupait
       toute la part visible, et le titre — ce qui dit sur quoi on a touche —
       restait sous le bord. Depliee, la fiche retrouve la borne de
       `DetailPanel`. */
    .fiche-hote:not(.plein) :global(.cadre) {
      max-height: 20dvh;
    }

    /* 44 px **reels** plutot qu'une zone etendue : la feuille porte
       `overflow: hidden`, qui rognerait un `::after` au-dessus d'elle. L'audit
       l'a relevee a 32 px, sous le seuil que le produit s'impose. */
    .poignee {
      display: flex;
      flex: 0 0 auto;
      align-items: center;
      justify-content: center;
      height: 44px;
      padding: 0;
      border: none;
      background: var(--fond-carte);
      cursor: grab;
      /* Le geste appartient a la poignee seule : le reste de la feuille
         defile normalement. */
      touch-action: none;
    }

    .poignee span {
      width: 40px;
      height: 4px;
      border-radius: var(--r-pilule);
      background: var(--bord-appuye);
    }

    /* --- Barre et onglets ------------------------------------------------ */
    .barre {
      min-height: 0;
      padding: calc(8px + var(--sa-haut)) calc(12px + var(--sa-droite)) 8px calc(12px + var(--sa-gauche));
      gap: 8px 12px;
    }

    .marque strong {
      font-size: 21px;
    }

    .bascule,
    .replier {
      display: none;
    }

    .hasard {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      padding: 0;
    }

    .hasard svg {
      display: block;
    }

    .libelle-hasard {
      display: none;
    }

    .onglets {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      padding: 0 var(--sa-droite) var(--sa-bas) var(--sa-gauche);
      border-top: 1px solid var(--bord);
      background: var(--fond-carte);
    }

    .onglets button {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 3px;
      min-height: 56px;
      border: none;
      background: transparent;
      color: var(--texte-faible);
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
    }

    .onglets svg {
      width: 22px;
      height: 22px;
    }

    .onglets button.actif {
      color: var(--accent);
      font-weight: 600;
    }
  }
</style>
