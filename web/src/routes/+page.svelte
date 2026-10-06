<script lang="ts">
  import DetailPanel from '$lib/components/DetailPanel.svelte';
  import FacetPanel from '$lib/components/FacetPanel.svelte';
  import Jetons from '$lib/components/Jetons.svelte';
  import Calques from '$lib/components/Calques.svelte';
  import Legende from '$lib/components/Legende.svelte';
  import ListeResultats from '$lib/components/ListeResultats.svelte';
  import PucesFiltres from '$lib/components/PucesFiltres.svelte';
  import Recherche from '$lib/components/Recherche.svelte';
  import { CLE_FILTRE, type Suggestion } from '$lib/db/suggestions';
  import { dansMetropole, type Raccourci } from '$lib/recherche';
  import { SUPERPOSITIONS } from '$lib/carte/fonds';
  import type { Mode } from '$lib/carte/semiologie';
  import MonumentMap from '$lib/components/MonumentMap.svelte';
  import { pointsAcr } from '$lib/db/acr';
  import { estAcr } from '$lib/acr';
  import {
    auHasard,
    cardinalites,
    etiquette,
    facette,
    histogrammeProtections,
    histogrammeSiecles,
    liste,
    points,
    totaux,
    type BarreAnnee,
    type BarreSiecle,
    type Compte,
    type Ligne,
    type Totaux
  } from '$lib/db/queries';
  import {
    countActive,
    filters,
    jetonsActifs,
    replier,
    poserSaisie,
    reset,
    retirer,
    toggle,
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
  import { nf } from '$lib/format';
  import { browser } from '$app/environment';
  import { pushState, replaceState } from '$app/navigation';
  import { tick, untrack } from 'svelte';
  import { base } from '$app/paths';
  import { versCollection } from '$lib/db/points';
  import { MESSAGES_POSITION, position } from '$lib/state/position.svelte';
  import { emprise, type Bornes, type Marges } from '$lib/carte/camera';

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
  if (browser && encoder({ filtres: initial.filtres, selection: null, vue: 'carte', fond: null, acr: false }) === '') {
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

  // --- Couche Architecture contemporaine remarquable -------------------------
  // Un bonus d'affichage, hors du filtrage croise : ni `filters`, ni les
  // compteurs, ni la liste ne la voient. Masquee par defaut ; son nuage ne part
  // qu'a la premiere activation.
  let acrVisible = $state(initial.acr);
  let pointsAcrCarte = $state.raw<GeoJSON.FeatureCollection | null>(null);

  $effect(() => {
    if (!acrVisible || pointsAcrCarte) return;
    pointsAcr().then((nuage) => {
      if (nuage) pointsAcrCarte = nuage;
    });
  });

  // Masquer la couche referme la fiche ACR ouverte : elle designerait un point
  // qui n'est plus a l'ecran.
  $effect(() => {
    if (!acrVisible && estAcr(selection)) selection = null;
  });
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

  // --- Calques et legende -----------------------------------------------------
  // Ce que la carte peint et comment : choisi dans le panneau des calques,
  // nomme par la legende, peint par `MonumentMap`. La page possede l'etat
  // parce qu'aucun des trois ne possede les deux autres. Seul le fond entre
  // dans l'URL ; couleur, densite et opacite sont des reglages de lecture.
  let mode = $state<Mode>('statut');
  let densite = $state(false);
  let opaciteFond = $state(SUPERPOSITIONS.find((s) => s.cle === initial.fond)?.opacite ?? 65);
  let calquesOuverts = $state(false);
  let legendeDepliee = $state(false);
  let comptesStatut = $state.raw<Compte[] | null>(null);

  // Timeline importe Observable Plot (209 Ko minifie, ~65 Ko gzip) et partait
  // jusqu'ici dans le chunk de page, charge avant meme que `boot()` de
  // duckdb.ts puisse commencer — alors que la frise est fermee au chargement.
  // Elle n'est donc plus importee statiquement : `import()` la charge a la
  // premiere ouverture, et le composant reste `null` le temps du
  // telechargement — d'ou l'emplacement reserve du gabarit, cf. le style.
  type ComposantTimeline = (typeof import('$lib/components/Timeline.svelte'))['default'];
  let TimelineComp = $state<ComposantTimeline | null>(null);

  $effect(() => {
    if (friseOuverte && !TimelineComp) {
      import('$lib/components/Timeline.svelte').then((m) => {
        TimelineComp = m.default;
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
  let vueCarte = $state<
    | {
        vueCourante: () => VueCarte | null;
        approcher: (reference: string, anime: boolean, jusquAuBatiment?: boolean) => void;
        survoler: (lon: number, lat: number, reserve: Marges) => Promise<void>;
        cadrer: (bornes: Bornes) => void;
        centrer: (reference: string) => void;
      }
    | undefined
  >();

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
  //
  // La saisie ne filtre plus a chaque frappe : elle propose (`Recherche`), et
  // c'est un geste — Entree, une ligne choisie — qui applique. Filtrer en
  // tapant faisait tomber le corpus a « Rou » avant qu'on ait fini « Rouen ».
  async function appliquerRecherche(saisie: string, mode: Cible) {
    const mien = ++jetonTexte;
    cible = mode;
    terme = saisie;
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
      if (mien === jetonTexte) await appliquerRecherche(saisie, 'titres');
      return;
    }
    await preparer(saisie);
    if (mien !== jetonTexte) return;
    filters.texte = replier(saisie);
  }

  // Un lien qui porte `texte=` arrive avec le filtre mais sans les identifiants
  // de termes : le lexique doit les resoudre, sans quoi la clause s'efface.
  if (browser && initial.filtres.texte) {
    queueMicrotask(() => appliquerRecherche(initial.filtres.texte, 'historiques'));
  }

  /** Une recherche par mot, ou un raccourci, montre ce qu'elle a trouve : la
   *  carte cadre l'emprise des resultats s'ils tiennent en metropole. */
  let cadrerResultats = false;

  // --- Ce que la recherche propose -------------------------------------------
  function surLieu(s: Suggestion) {
    const cle = CLE_FILTRE[s.genre];
    if (cle) {
      // Region, departement : un filtre, que l'effet des lieux cadre ensuite.
      const liste = filters[cle as 'regions' | 'departements'];
      if (!liste.includes(s.libelle)) liste.push(s.libelle);
      terme = '';
    } else if (s.bornes) {
      // Une commune n'est pas une facette : la carte y va, sans rien filtrer.
      vueCarte?.cadrer(s.bornes);
    }
  }

  function surEdifice(s: Suggestion) {
    if (s.reference) ouvrirFiche(s.reference, 'recherche');
  }

  function surCategorie(s: Suggestion) {
    const cle = CLE_FILTRE[s.genre] as 'denominations' | 'domaines' | 'auteurs' | undefined;
    if (!cle) return;
    if (!filters[cle].includes(s.libelle)) filters[cle].push(s.libelle);
    terme = '';
  }

  function surRaccourci(r: Raccourci) {
    toutEffacer();
    if (r.filtres.auteurs) filters.auteurs = [...r.filtres.auteurs];
    if (r.filtres.denominations) filters.denominations = [...r.filtres.denominations];
    cadrerResultats = true;
  }

  function surTexte(texte: string, mode: Cible) {
    if (!texte) return;
    appliquerRecherche(texte, mode);
    cadrerResultats = true;
    // Au large, les resultats s'ouvrent a cote de la carte ; sur telephone, la
    // feuille monte en apercu.
    vue = 'liste';
    if (telephone) cran = 'apercu';
  }

  /** Sortir des historiques : la saisie, s'il y en a une, repart sur les
   *  titres ; sinon le mode seul change. */
  function surTitres() {
    if (terme.trim()) {
      appliquerRecherche(terme.trim(), 'titres');
    } else {
      jetonTexte += 1;
      retirer('texte');
      cible = 'titres';
    }
  }

  function surVider() {
    jetonTexte += 1;
    retirer('recherche');
    retirer('texte');
    cible = 'titres';
  }

  // Signature profonde de l'etat : un seul point de declenchement pour tout
  // le cycle de requetes, quel que soit le filtre modifie.
  const signature = $derived(JSON.stringify(filters));

  let jeton = 0;
  let jetonFacettes = 0;

  // Choisir une region ou un departement cadre la carte dessus, une fois les
  // points arrives : la selection dit elle-meme ou regarder. Seulement quand
  // on en **ajoute** un — en retirer ne doit pas faire sauter la vue.
  let cadrerLieu = false;
  let nbLieux = filters.regions.length + filters.departements.length;

  $effect(() => {
    const n = filters.regions.length + filters.departements.length;
    untrack(() => {
      if (n > nbLieux) cadrerLieu = true;
      nbLieux = n;
    });
  });

  /** Facette dont le menu de puce est ouvert. */
  let puceOuverte = $state<FacetKey | null>(null);

  // Le menu d'une puce et le tiroir des filtres montreraient deux fois les
  // memes options : l'un ferme l'autre.
  $effect(() => {
    if (puceOuverte !== null) untrack(() => (facettesOuvertes = false));
  });
  let jetonFrise = 0;

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
        if (cadrerLieu || cadrerResultats) {
          const bornes = emprise(pts.features);
          // Un lieu choisi se cadre ou qu'il soit ; une recherche par mot,
          // seulement si ses resultats tiennent en metropole.
          if (bornes && (cadrerLieu || dansMetropole(bornes))) vueCarte?.cadrer(bornes);
          cadrerLieu = false;
          cadrerResultats = false;
        }
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
  type Tri = 'pertinence' | 'alpha' | 'proximite';
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

  // Comme les facettes et la frise, la liste ne part qu'ouverte : elle vit
  // dans le volet, ferme au demarrage — deux requetes au premier ecran, le
  // nuage et les totaux, au lieu de trois.
  // La liste se pagine par 200 : « Afficher 200 de plus » releve le plafond,
  // et tout changement de filtre ou d'ordre le ramene a 200.
  const PAGE_LISTE = 200;
  let plafondListe = $state(PAGE_LISTE);

  $effect(() => {
    signature;
    tri;
    untrack(() => (plafondListe = PAGE_LISTE));
  });

  $effect(() => {
    signature;
    cleProche;
    const plafond = plafondListe;
    const ordreListe = tri === 'alpha' ? 'alpha' : 'pertinence';
    if (vue !== 'liste') return;
    const mien = ++jetonListe;
    const ici = untrack(() => proche);
    liste(filters, plafond, ici ? { lon: ici.lon, lat: ici.lat } : null, ordreListe)
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
    if (!facettesOuvertes && puceOuverte === null) return;
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

  // Les effectifs de la legende ne partent que depliee : repliee, elle ne les
  // affiche pas, et le demarrage reste a ses trois requetes. Comptes sans le
  // filtre de statut, comme une facette — cocher un niveau depuis la legende
  // ne doit pas faire tomber les deux autres a zero.
  let jetonLegende = 0;

  $effect(() => {
    signature;
    if (!legendeDepliee) return;
    const mien = ++jetonLegende;
    facette(filters, 'statut', 10)
      .then((c) => {
        if (mien === jetonLegende) comptesStatut = c;
      })
      .catch(echec(() => mien === jetonLegende));
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

  // Aucun de ces effets ne lit `vue` : basculer carte -> liste ne doit relancer
  // aucune requete tant qu'aucun filtre n'a bouge.

  // --- Permalien -----------------------------------------------------------
  // L'URL est la seule memoire partageable de l'exploration. On y ecrit par
  // remplacement : chaque clic de facette empilerait sinon une entree
  // d'historique. Seule l'ouverture d'une fiche empile, parce que refermer la
  // fiche est precisement ce que le bouton retour doit faire.
  //
  // La **fermeture**, elle, remplace. Le test etait `selection !==
  // derniereSelection`, vrai dans les deux sens : fermer a la croix empilait
  // une entree, et le bouton retour rouvrait la fiche qu'on venait de quitter.
  let derniereRequete = encoder(initial);
  let derniereSelection = initial.selection;

  $effect(() => {
    const requete = encoder({ filtres: filters, selection, vue, fond, acr: acrVisible });
    if (requete === derniereRequete) return;
    const fiche = selection !== null && selection !== derniereSelection;
    derniereRequete = requete;
    derniereSelection = selection;
    // Une chaine vide serait resolue comme « URL courante » : viser le chemin.
    const cible = requete || location.pathname;
    if (fiche) pushState(cible, {});
    else replaceState(cible, {});
  });

  // Sens inverse : apres un retour arriere, l'URL fait foi.
  //
  // C'est `location` qui est lue, sur `popstate`, et non `page.url` : avec le
  // routage superficiel (`pushState` / `replaceState`), SvelteKit garde dans
  // `page.url` l'adresse du **chargement**, et la restitue telle quelle a
  // chaque retour. Un retour arriere rejouait donc l'etat d'arrivee — la vue
  // liste retombait sur la carte, un filtre retire revenait — pendant que la
  // barre d'adresse disait autre chose.
  //
  // La comparaison se fait sur la **forme normalisee** — decodee puis reencodee
  // — et non sur la chaine brute. Un lien partage porte `c=`, que `encoder`
  // n'emet jamais : compare tel quel, il paraitrait toujours different de
  // l'etat.
  function relireUrl() {
    const etat = decoder(location.search);
    const requete = encoder(etat);
    if (requete === derniereRequete) return;
    derniereRequete = requete;
    derniereSelection = etat.selection;
    Object.assign(filters, etat.filtres);
    selection = etat.selection;
    vue = etat.vue;
    fond = etat.fond;
    acrVisible = etat.acr;
    cible = etat.filtres.texte ? 'historiques' : 'titres';
    terme = etat.filtres.texte || etat.filtres.recherche;
    // Sans cela, le predicat plein texte restait celui de l'etat quitte le
    // temps d'un aller-retour (ANO-12).
    if (etat.filtres.texte) appliquerRecherche(etat.filtres.texte, 'historiques');
  }

  // Le presse-papier peut etre refuse (contexte non securise, permission) :
  // l'echec bascule sur une selection manuelle plutot que de ne rien faire.
  let copie = $state(false);

  // Le partage natif — la feuille de partage du telephone — n'existe que la
  // ou le systeme le fournit, et ne se propose qu'au doigt : sur ordinateur,
  // copier le lien est le geste attendu.
  const partageNatif =
    browser && 'share' in navigator && window.matchMedia('(pointer: coarse)').matches;

  async function partagerLien() {
    const requete = encoder({ filtres: filters, selection, vue, fond, acr: acrVisible }, vueCarte?.vueCourante());
    try {
      await navigator.share({ title: titreFiche ?? 'Mérimée', url: location.origin + location.pathname + requete });
    } catch {
      // Partage annule par l'utilisateur, ou refuse : rien a dire.
    }
  }

  /** « Voir sur la carte » depuis la fiche. Sur telephone, la feuille redescend
   *  en apercu : la carte doit se voir. */
  function centrerFiche() {
    if (!selection) return;
    if (telephone && cran === 'plein') cran = 'apercu';
    vue = 'carte';
    vueCarte?.centrer(selection);
  }

  /** Notice survolee dans la liste, mise en evidence sur la carte. */
  let survolee = $state<string | null>(null);

  async function copierLien() {
    // Seul endroit ou la vue de carte entre dans une URL. L'URL vivante n'en
    // porte pas : un simple deplacement ne doit rien reecrire.
    const requete = encoder({ filtres: filters, selection, vue, fond, acr: acrVisible }, vueCarte?.vueCourante());
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
    jetonTexte += 1;
    terme = '';
    // Le mode de recherche revient aux titres avec le reste (ANO-19).
    cible = 'titres';
    suivreVue = false;
  }

  // --- Focus des calques -----------------------------------------------------
  // Les filtres ou une fiche ouverts par un geste deplacent le focus dedans ; le
  // refermer le rend a ce qui l'avait avant. Seul un geste utilisateur le
  // fait : un permalien pose `selection` sans jamais passer par ces fonctions,
  // et l'effet de lecture d'URL (retour arriere compris) non plus.
  //
  // Les filtres rendent le focus au bouton « Filtres », toujours visible dans la
  // rangee d'outils — inutile de capturer. La fiche, elle, s'ouvre depuis
  // plusieurs endroits (carte, liste, recherche, voisins, « au hasard »), d'ou
  // la capture du foyer courant.
  let foyerFiche: HTMLElement | null = null;
  let titreTiroir: HTMLElement | undefined = $state();
  let boutonFiltres: HTMLElement | undefined = $state();

  // `origine` dit d'ou vient le geste. Depuis la carte, on voit deja ou est le
  // point : rien ne bouge, sauf s'il tombe sous un panneau. Depuis la liste,
  // la carte se rapproche de l'edifice — sinon ouvrir une fiche a l'echelle
  // nationale ne disait pas ou il se trouve. Depuis la recherche, elle descend
  // jusqu'au batiment : on l'a nomme, on veut le voir.
  function ouvrirFiche(ref: string, origine: 'carte' | 'liste' | 'recherche' = 'carte') {
    // Toute ouverture annule l'arrivee d'un vol en cours : sa fiche ne doit
    // pas remplacer celle qu'un geste vient de demander.
    jetonVol += 1;
    const actif = document.activeElement;
    foyerFiche = actif instanceof HTMLElement && actif !== document.body ? actif : null;
    // Une feuille repliee s'ouvre en apercu ; une feuille deja ouverte garde son
    // cran — passer d'un voisin a l'autre ne doit pas la faire sauter.
    if (contenu === null) cran = 'apercu';
    selection = ref;
    // La fiche affiche d'abord « Chargement… » : `focaliser()` vise l'aside
    // lui-meme, toujours present, pas son titre qui arrive plus tard.
    tick().then(() => {
      detailPanel?.focaliser();
      if (origine !== 'carte') vueCarte?.approcher(ref, vue === 'carte', origine === 'recherche');
    });
  }

  function fermerFiche() {
    selection = null;
    // Le foyer peut avoir disparu (filtre qui retire la ligne de liste) : un
    // clic sur la carte replie alors sur le canevas, le repli le plus sense.
    // Apres `tick` : la ligne de liste etait masquee (`hidden`) sous la fiche,
    // et un element masque ne prend pas le focus.
    const foyer = foyerFiche;
    foyerFiche = null;
    tick().then(() => {
      const repli =
        foyer && document.contains(foyer) && foyer.offsetParent !== null
          ? foyer
          : document.querySelector<HTMLElement>('.maplibregl-canvas');
      repli?.focus({ preventScroll: true });
    });
  }

  // `preventScroll` : au moment du focus la feuille est encore translatee hors
  // de la scene, et le navigateur ferait defiler `.scene` pour l'y amener —
  // `overflow: hidden` masque la barre de defilement, pas le defilement.
  function ouvrirTiroir() {
    puceOuverte = null;
    // Les filtres prennent la place de la fiche dans le panneau : on ne lit
    // pas une notice en reglant la selection qui la contient peut-etre plus.
    if (selection !== null) selection = null;
    facettesOuvertes = true;
    // Sur telephone, la feuille se deplie : huit facettes ne tiennent pas dans
    // un apercu.
    if (telephone) cran = 'plein';
    tick().then(() => titreTiroir?.focus({ preventScroll: true }));
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
    // Le panneau des calques est le plus passager des calques : il part le
    // premier. Focus dedans, il a deja traite la touche lui-meme.
    if (puceOuverte !== null) {
      puceOuverte = null;
    } else if (calquesOuverts) {
      calquesOuverts = false;
    } else if (selection !== null) {
      fermerFiche();
    } else if (facettesOuvertes) {
      fermerTiroir();
    } else if (vue === 'liste') {
      vue = 'carte';
    }
  }

  // Le seuil telephone commande de l'etat : la feuille a crans, qui n'est
  // modale qu'une fois depliee, et la reserve qu'elle impose a la carte. Il
  // reste ecrit a l'identique dans la feuille de style.
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
    const petit = window.matchMedia(TELEPHONE);
    const appliquerGabarit = () => {
      telephone = petit.matches;
    };
    appliquerGabarit();
    petit.addEventListener('change', appliquerGabarit);
    return () => petit.removeEventListener('change', appliquerGabarit);
  });

  // Sur telephone, le panneau des calques part quand la feuille monte : elle
  // le recouvrirait.
  $effect(() => {
    if (contenu !== null && telephone) calquesOuverts = false;
  });

  // --- Panneau ----------------------------------------------------------------
  // Un seul emplacement pour ce qu'on lit : la liste, la fiche, les filtres.
  // Au large c'est une colonne a gauche, sous la recherche ; sur telephone,
  // la feuille du bas. La fiche passe devant les filtres, qui passent devant la
  // liste — et refermer l'un decouvre le suivant : c'est le « retour » des
  // cartes en ligne, sans pile a tenir.
  type Contenu = 'fiche' | 'filtres' | 'liste';
  const contenu = $derived<Contenu | null>(
    selection !== null ? 'fiche' : facettesOuvertes ? 'filtres' : vue === 'liste' ? 'liste' : null
  );

  /** Referme ce que montre le panneau, avec le geste propre a chaque contenu. */
  function fermerContenu() {
    if (contenu === 'fiche') fermerFiche();
    else if (contenu === 'filtres') fermerTiroir();
    else if (contenu === 'liste') vue = 'carte';
  }

  /** Sur telephone, toucher l'en-tete de la feuille repliee montre la liste. */
  function ouvrirListe() {
    vue = 'liste';
    cran = 'apercu';
  }

  // Calque actuellement modal. Le panneau ne l'est jamais au large : c'est une
  // colonne a cote de la carte, qu'on lit en la regardant. Sur telephone, la
  // feuille en **apercu** ne l'est pas non plus — elle laisse 55 % de carte
  // au-dessus d'elle, et c'est tout son interet : toucher le monument voisin
  // sans refermer. Depliee, elle couvre l'ecran et le devient.
  const calqueModal = $derived(telephone && contenu !== null && cran === 'plein' ? 'volet' : null);

  // --- Feuille a crans (telephone) -----------------------------------------
  // Trois positions : repliee (l'en-tete seul, qui donne le compte), apercu,
  // depliee — commandees par une poignee. Le glissement
  // suit le doigt par `transform`, jamais par la hauteur : la feuille a une
  // hauteur definie — c'est ce qui la fait defiler, cf. le style — et la
  // translater ne provoque aucun reflow de la notice.
  /** Part de la feuille cachee sous le bord en apercu. */
  const PART_CACHEE = 0.55;
  let hauteurScene = $state(0);
  let decalage = $state<number | null>(null);
  let saisiePoignee: { y: number; depart: number; hauteur: number; bouge: boolean } | null = null;

  /** Hauteur de la feuille repliee, en pixels : poignee et en-tete. A garder
   *  egale a `--feuille-repliee` dans le style. */
  const REPLIEE = 68;

  function basculerCran() {
    if (contenu === null) ouvrirListe();
    else cran = cran === 'plein' ? 'apercu' : 'plein';
  }

  function saisirPoignee(event: PointerEvent) {
    const poignee = event.currentTarget as HTMLElement;
    const hote = poignee.parentElement;
    if (!hote) return;
    poignee.setPointerCapture(event.pointerId);
    const hauteur = hote.getBoundingClientRect().height;
    saisiePoignee = {
      y: event.clientY,
      depart: contenu === null ? hauteur - REPLIEE : cran === 'plein' ? 0 : hauteur * PART_CACHEE,
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
    poserFeuille(fin / s.hauteur);
  }

  /** Pose la feuille lachee a `part` de sa hauteur sous le bord. Un quart de
   *  la part encore visible en apercu, tire vers le bas, referme ce que montre
   *  la feuille ; tiree vers le haut depuis le repli, elle montre la liste. */
  function poserFeuille(part: number) {
    if (part > PART_CACHEE + (1 - PART_CACHEE) * 0.25) {
      if (contenu !== null) fermerContenu();
    } else {
      if (contenu === null) vue = 'liste';
      cran = part < PART_CACHEE / 2 ? 'plein' : 'apercu';
    }
  }

  // Tirer la feuille vers le bas **depuis son contenu**, pas seulement par la
  // poignee : une bande de 44 px en haut d'une fiche etait le seul endroit qui
  // repondait, et le geste naturel — tirer la photo, le titre — ne faisait
  // rien. Le contenu garde son defilement : la feuille ne prend le geste que
  // s'il part vers le bas **et** que ce qui defile sous le doigt est deja en
  // haut. Tout le reste — remonter, lire, balayer les photos — lui revient.
  //
  // Evenements tactiles et non pointeur : un `pointermove` cesse des que le
  // navigateur commence a defiler (`pointercancel`), et c'est justement le
  // moment ou il faut pouvoir dire non au defilement.
  let voletNoeud: HTMLElement | undefined = $state();

  $effect(() => {
    const noeud = voletNoeud;
    if (!noeud || !telephone) return;
    let geste: {
      x: number;
      y: number;
      defileur: HTMLElement | null;
      etat: 'attente' | 'feuille' | 'contenu';
      depart: number;
      hauteur: number;
    } | null = null;

    /** Le conteneur qui defilerait sous le doigt, s'il y en a un. */
    const defileurSous = (cible: HTMLElement): HTMLElement | null => {
      for (let el: HTMLElement | null = cible; el && el !== noeud; el = el.parentElement) {
        const debord = getComputedStyle(el).overflowY;
        if ((debord === 'auto' || debord === 'scroll') && el.scrollHeight > el.clientHeight + 1) return el;
      }
      return null;
    };

    const debut = (event: TouchEvent) => {
      geste = null;
      if (event.touches.length !== 1 || contenu === null) return;
      const cible = event.target as HTMLElement;
      // La poignee a ses propres gestes ; une photo hors bornes se fait
      // glisser dans son cadre ; un curseur se regle a l'horizontale.
      if (cible.closest('.poignee, .cadre.glissable, input[type="range"]')) return;
      const t = event.touches[0];
      geste = { x: t.clientX, y: t.clientY, defileur: defileurSous(cible), etat: 'attente', depart: 0, hauteur: 0 };
    };

    const mouvement = (event: TouchEvent) => {
      const g = geste;
      if (!g || g.etat === 'contenu') return;
      const t = event.touches[0];
      const dy = t.clientY - g.y;
      const dx = t.clientX - g.x;
      if (g.etat === 'attente') {
        const enHaut = !g.defileur || g.defileur.scrollTop <= 0;
        // Vers le bas, en haut du contenu : rien a defiler. Le refuser des le
        // premier mouvement garde le geste annulable — un navigateur qui a
        // commence un defilement n'ecoute plus `preventDefault`.
        if (dy > 0 && enHaut && event.cancelable) event.preventDefault();
        if (Math.abs(dy) < 8 && Math.abs(dx) < 8) return;
        if (dy > 0 && enHaut && Math.abs(dy) > Math.abs(dx)) {
          g.etat = 'feuille';
          g.hauteur = noeud.getBoundingClientRect().height;
          g.depart = cran === 'plein' ? 0 : g.hauteur * PART_CACHEE;
          g.y = t.clientY;
        } else {
          g.etat = 'contenu';
          return;
        }
      }
      if (event.cancelable) event.preventDefault();
      decalage = Math.min(g.hauteur, Math.max(0, g.depart + (t.clientY - g.y)));
    };

    const fin = () => {
      const g = geste;
      geste = null;
      if (!g || g.etat !== 'feuille') return;
      const lache = decalage;
      decalage = null;
      if (lache !== null) poserFeuille(lache / g.hauteur);
    };

    const annuler = () => {
      if (geste?.etat === 'feuille') decalage = null;
      geste = null;
    };

    noeud.addEventListener('touchstart', debut, { passive: true });
    noeud.addEventListener('touchmove', mouvement, { passive: false });
    noeud.addEventListener('touchend', fin);
    noeud.addEventListener('touchcancel', annuler);
    return () => {
      noeud.removeEventListener('touchstart', debut);
      noeud.removeEventListener('touchmove', mouvement);
      noeud.removeEventListener('touchend', fin);
      noeud.removeEventListener('touchcancel', annuler);
    };
  });

  function annulerPoignee() {
    saisiePoignee = null;
    decalage = null;
  }

  /** Le pointeur est traite par `lacherPoignee` ; un `click` de detail nul
   *  vient du clavier (Entree, Espace), seul chemin qui passe ici. */
  function clavierPoignee(event: MouseEvent) {
    if (event.detail === 0) basculerCran();
  }

  // Ce que les panneaux masquent de la carte, bord par bord : elle y ramene un
  // point choisi qui tomberait dessous, et y centre ses vols. Les tailles sont
  // mesurees, pas recopiees de la feuille de style — elles changent de gabarit
  // en gabarit.
  //
  // `ficheOuverte` est un parametre et non la lecture de `selection` : « Au
  // hasard » vise la place que la fiche prendra **a l'arrivee**, alors qu'elle
  // n'est pas encore ouverte au decollage.
  let largeurPanneau = $state(0);
  let hauteurHaut = $state(0);

  function margesCarte(ficheOuverte: boolean): Marges {
    const ouvert = ficheOuverte || contenu !== null;
    if (telephone) {
      // Une feuille repliee s'ouvre en apercu, cf. `ouvrirFiche`. Depliee,
      // elle couvre tout : il n'y a plus rien a ramener.
      const position = contenu === null ? 'apercu' : cran;
      return {
        top: hauteurHaut + 12,
        bottom: !ouvert
          ? REPLIEE
          : position === 'plein'
            ? 0
            : Math.round((hauteurScene - 8) * (1 - PART_CACHEE)),
        left: 0,
        right: 0
      };
    }
    // Le panneau flotte a 12 px du bord gauche ; on lui laisse autant d'air de
    // l'autre cote.
    return { top: 0, bottom: 0, left: ouvert ? largeurPanneau + 24 : 0, right: 0 };
  }

  const marges = $derived(margesCarte(selection !== null));

  // Pose `inert` sur tout ce qui n'est pas le calque modal courant, depuis
  // l'exterieur : la carte et la frise appartiennent a d'autres composants,
  // `inert` se pose donc sur leurs racines sans qu'ils aient besoin de le
  // connaitre. Ce qui n'est pas affiche dans le panneau porte `hidden` : ni
  // visible, ni atteignable au clavier.
  $effect(() => {
    if (!browser) return;
    const modal = calqueModal;
    const scene = document.querySelector('.scene');
    const cibles = [...(scene ? Array.from(scene.children) : []), document.querySelector('.frise')].filter(
      (el): el is HTMLElement => el instanceof HTMLElement
    );
    for (const el of cibles) el.inert = modal !== null && !el.classList.contains('volet');
  });

  const VUES: { cle: Vue; titre: string }[] = [
    { cle: 'carte', titre: 'Carte' },
    { cle: 'liste', titre: 'Liste' }
  ];

  // Message de surface, qui s'efface seul : il informe d'un geste reste sans
  // effet, il n'attend pas de reponse.
  let avis = $state<string | null>(null);

  $effect(() => {
    if (!avis) return;
    const minuteur = setTimeout(() => (avis = null), 5000);
    return () => clearTimeout(minuteur);
  });

  // « Au hasard », a la maniere d'Earth : sur la carte, on vole jusqu'a
  // l'edifice et sa fiche s'ouvre a l'arrivee. La fiche en cours se referme au
  // decollage — la garder ouverte ferait survoler la France sous la notice
  // d'un edifice qu'on quitte. Un geste qui interrompt le vol n'empeche pas la
  // fiche de s'ouvrir ; un second tirage, ou une autre fiche ouverte entre
  // temps, annule l'arrivee du premier (`jetonVol`).
  //
  // Hors de la carte, ou pour une notice sans coordonnees, il n'y a pas de vol
  // a regarder : la fiche s'ouvre tout de suite.
  let jetonVol = 0;

  async function hasard() {
    const mien = ++jetonVol;
    const tire = await auHasard(filters, vue === 'carte');
    if (mien !== jetonVol) return;
    if (!tire) {
      avis = 'Aucune notice à tirer au sort avec ces filtres.';
      return;
    }
    if (vue !== 'carte' || tire.lon === null || tire.lat === null || !vueCarte) {
      ouvrirFiche(tire.reference, 'liste');
      return;
    }
    const reserve = margesCarte(true);
    if (selection !== null) selection = null;
    await vueCarte.survoler(tire.lon, tire.lat, reserve);
    if (mien !== jetonVol) return;
    ouvrirFiche(tire.reference);
  }

  const actifs = $derived(countActive(filters));
  const puces = $derived(jetonsActifs(filters));
</script>

<svelte:window onkeydown={surEchap} onpopstate={relireUrl} />

<svelte:head>
  <title>{titreFiche ? `${titreFiche} — Mérimée` : 'Mérimée — monuments historiques'}</title>
</svelte:head>

<div class="app">
  <!-- Plus de barre d'en-tete : la carte prend tout l'ecran, et ce qu'on y
       pose flotte dessus, a la maniere des cartes en ligne. `--marge-gauche`
       ecarte legende et calques du volet ouvert ; `--reserve-bas`, sur
       telephone, les pose au-dessus de la feuille repliee. -->
  <main class:volet-ouvert={contenu !== null}
        style:--hauteur-haut="{hauteurHaut}px"
        style:--marge-gauche={!telephone && contenu !== null ? `${largeurPanneau + 12}px` : '0px'}
        style:--reserve-bas={telephone ? `${REPLIEE}px` : '0px'}>
    <div class="centre">
      <div class="scene" bind:clientHeight={hauteurScene}>
        <MonumentMap
          bind:this={vueCarte}
          points={pointsCarte}
          {selection}
          vueInitiale={cadrageInitial}
          {fond}
          {opaciteFond}
          {mode}
          {densite}
          acr={acrVisible}
          pointsAcr={pointsAcrCarte}
          bind:suivreVue
          {marges}
          survol={survolee}
          {etiquette}
          onselect={(ref) => ouvrirFiche(ref)}
          onbbox={(bbox) => (filters.bbox = bbox)}
        />

        <Calques bind:ouvert={calquesOuverts} bind:fond bind:opacite={opaciteFond}
                 bind:mode bind:densite bind:acr={acrVisible}
                 nbAcr={pointsAcrCarte?.features.length ?? null} />
        <Legende {mode} {densite} acr={acrVisible} compacte={friseOuverte}
                 bind:depliee={legendeDepliee} comptes={comptesStatut}
                 statutsActifs={filters.statut} onstatut={(valeur) => toggle('statut', valeur)} />

        <!-- Le bloc du haut : la recherche, puis ce qui la prolonge — le compte,
             la vue, les filtres, les frises. Une colonne au large, la largeur
             de l'ecran sur telephone. -->
        <div class="haut" bind:clientHeight={hauteurHaut}>
          <div class="barre">
            <!-- Le titre du document. Visible au large, en tete de la carte de
                 recherche ; reserve aux lecteurs d'ecran sur telephone, ou la
                 largeur va au champ. -->
            <h1 class="marque">
              <strong>Mérimée</strong>
              <span class="sous">Monuments historiques · 1840 — 2026</span>
            </h1>
            <Recherche bind:terme historiques={cible === 'historiques'}
                       indexDisponible={indexTexte.etat !== 'indisponible'}
                       onlieu={surLieu} onedifice={surEdifice} oncategorie={surCategorie}
                       onraccourci={surRaccourci} ontexte={surTexte} ontitres={surTitres} onvider={surVider}
                       onhasard={hasard} />
          </div>

          <div class="outils">
            <!-- Un seul compteur : le total suit les filtres et c'est le seul qui
                 reponde a « combien en reste-t-il ». Region live : seul le
                 compte doit etre relu au changement ; `aria-atomic` fait relire
                 le nombre entier plutot que le seul chiffre modifie. -->
            <div class="chiffres" aria-live="polite" aria-atomic="true">
              {#if compteurs}
                <span><b>{nf.format(compteurs.total)}</b> notices</span>
              {/if}
            </div>
            <!-- La liste s'ouvre a cote de la carte au large ; sur telephone,
                 c'est la feuille du bas qui la porte. -->
            <nav class="bascule" aria-label="Vue">
              {#each VUES as choix (choix.cle)}
                <!-- Deux boutons en rang : la zone de frappe ne s'etend qu'en
                     hauteur, sinon celle de « Liste » recouvrirait « Carte ». -->
                <button class="frappe-44-v" class:actif={vue === choix.cle} aria-pressed={vue === choix.cle}
                        onclick={() => (vue = choix.cle)}>{choix.titre}</button>
              {/each}
            </nav>
            <button class="outil filtres frappe-44" aria-expanded={facettesOuvertes}
                    bind:this={boutonFiltres}
                    onclick={() => (facettesOuvertes ? fermerTiroir() : ouvrirTiroir())}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
                   stroke-linecap="round" aria-hidden="true">
                <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
                <circle cx="15" cy="7" r="2" />
                <circle cx="9" cy="17" r="2" />
              </svg>
              Filtres{#if actifs > 0} <em>{actifs}</em>{/if}
            </button>
            <!-- Le theme, sur telephone : au large il tient le coin haut droit
                 de la carte. Un seul des deux est jamais visible. -->
            <button class="theme theme-etroit frappe-44" onclick={basculer}
                    aria-label={theme.courant === 'clair' ? 'Sombre' : 'Clair'}
                    title={theme.courant === 'clair' ? 'Passer au thème sombre' : 'Passer au thème clair'}>
              {@render iconeTheme()}
            </button>
          </div>

          <!-- Les puces des facettes, puis les filtres poses, dans une meme
               rangee : ce qu'on peut regler, puis ce qui l'est. -->
          <PucesFiltres {facettes} {cardinaux} {chargement} bind:ouverte={puceOuverte} bind:suivreVue
                        bind:frise={friseOuverte}>
            {#if puces.length > 0}
              <Jetons jetons={puces} {actifs} onretirer={retirerJeton} onreset={toutEffacer} />
            {/if}
          </PucesFiltres>
        </div>

        <!-- Le thème est une pastille sans libellé : l'icone dit la destination
             (lune vers le sombre, soleil vers le clair), le nom accessible la
             nomme. -->
        <button class="theme theme-large frappe-44" onclick={basculer}
                aria-label={theme.courant === 'clair' ? 'Sombre' : 'Clair'}
                title={theme.courant === 'clair' ? 'Passer au thème sombre' : 'Passer au thème clair'}>
          {@render iconeTheme()}
        </button>

        <!-- Le volet : la liste, la fiche, les filtres, un seul a la fois.
             Colonne sous la recherche au large, feuille a crans sur telephone.
             Ce qu'il ne montre pas porte `hidden` : ni visible, ni atteignable
             au clavier — le tiroir ferme gardait douze arrets de tabulation. -->
        <div class="volet" class:ouvert={contenu !== null} class:plein={cran === 'plein'}
             class:glisse={decalage !== null} bind:clientWidth={largeurPanneau} bind:this={voletNoeud}
             role="region" aria-label={contenu === 'fiche' ? 'Fiche' : contenu === 'filtres' ? 'Filtres' : 'Notices'}
             style:transform={decalage !== null ? `translateY(${decalage}px)` : undefined}>
          <!-- Poignee de la feuille, telephone seulement. Un toucher bascule le
               cran, un glissement le deplace, tirer vers le bas referme ; au
               clavier, Entree bascule. -->
          <button class="poignee" aria-expanded={contenu !== null && cran === 'plein'}
                  aria-label={contenu === null
                    ? 'Afficher la liste'
                    : cran === 'plein'
                      ? `Réduire ${contenu === 'fiche' ? 'la fiche' : contenu === 'filtres' ? 'les filtres' : 'la liste'}`
                      : `Agrandir ${contenu === 'fiche' ? 'la fiche' : contenu === 'filtres' ? 'les filtres' : 'la liste'}`}
                  onpointerdown={saisirPoignee} onpointermove={glisserPoignee}
                  onpointerup={lacherPoignee} onpointercancel={annulerPoignee}
                  onclick={clavierPoignee}>
            <span aria-hidden="true"></span>
          </button>
          {#if contenu === null}
            <!-- La feuille repliee : ce qu'elle cache, et le geste pour le voir. -->
            <button class="entete-feuille" onclick={ouvrirListe}>
              Liste des notices
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                   stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="m6 15 6-6 6 6" />
              </svg>
            </button>
          {/if}

          <div class="colonne facettes" class:ouvert={contenu === 'filtres'} hidden={contenu !== 'filtres'}>
            <div class="entete-tiroir">
              <h2 tabindex="-1" bind:this={titreTiroir}>Filtres</h2>
              <button class="fermer-tiroir frappe-44" aria-label="Fermer les filtres"
                      onclick={fermerTiroir}>×</button>
            </div>
            <!-- La zone visible est un critere comme un autre : elle rejoint les
                 facettes plutot que les commandes d'affichage de la carte. -->
            <label class="zone">
              <input type="checkbox" bind:checked={suivreVue} />
              <span>Limiter à la zone visible sur la carte</span>
            </label>
            <FacetPanel {facettes} {cardinaux} {chargement} />
          </div>

          <div class="colonne fiche-hote" class:ouvert={contenu === 'fiche'} hidden={contenu !== 'fiche'}>
            <DetailPanel reference={selection} {copie} oncopier={copierLien}
                         retour={vue === 'liste'}
                         onpartager={partageNatif ? partagerLien : undefined}
                         oncentrer={centrerFiche}
                         onvoisin={(ref) => ouvrirFiche(ref, 'liste')}
                         bind:this={detailPanel} onclose={fermerFiche}
                         ontitre={(t) => (titreFiche = t)}
                         ondefile={() => {
                           if (telephone && cran === 'apercu' && decalage === null) cran = 'plein';
                         }} />
          </div>

          {#if vue === 'liste'}
            <div class="colonne contenu-liste" hidden={contenu !== 'liste'}>
              <ListeResultats {resultats} {compteurs} {selection} bind:tri
                              proposerProximite={position.courante !== null}
                              pertinence={Boolean(filters.texte)}
                              portee={cible === 'historiques' && indexTexte.stats
                                ? { notices: indexTexte.stats.n, inconnus: indexTexte.inconnus }
                                : null}
                              onouvrir={(ref) => {
                                survolee = null;
                                ouvrirFiche(ref, 'liste');
                              }}
                              oneffacer={toutEffacer}
                              onsurvol={(ref) => (survolee = ref)}
                              onsuite={() => (plafondListe += PAGE_LISTE)}
                              ondefile={() => {
                                if (telephone && cran === 'apercu' && decalage === null) cran = 'plein';
                              }} />
            </div>
          {/if}
        </div>

        {#if erreur}
          <div class="erreur" role="alert"><b>Erreur DuckDB</b><p>{erreur}</p></div>
        {:else if chargement && !compteurs}
          <div class="amorce">{LIBELLES[amorcage.phase]}</div>
        {:else if compteurs && compteurs.total === 0 && contenu !== 'liste'}
          <!-- Meme famille visuelle que `.amorce` / `.erreur` : une surface
               posee au centre de la scene, qui ne recouvre aucun coin — les
               commandes de la carte y vivent toutes. -->
          <div class="vide-carte" role="status">
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

        {#if avis}
          <div class="avis" role="status">{avis}</div>
        {/if}

        {#if position.erreur}
          <div class="alerte-position" role="alert">
            <p>{MESSAGES_POSITION[position.erreur]}</p>
            <button class="frappe-44" aria-label="Fermer le message"
                    onclick={() => (position.erreur = null)}>×</button>
          </div>
        {/if}
      </div>

      <!-- La frise reste un panneau du bas, sous la carte : c'est le tiers bas
           de l'ecran qu'elle rend en se repliant. Elle s'ouvre depuis le bloc
           du haut, et se referme par sa croix. -->
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
          <!-- Hauteur mesuree du panneau reel : sans elle, l'arrivee du chunk
               Plot ferait bondir la carte au moment ou <Timeline> apparait. -->
          <div class="frise-attente" aria-hidden="true"></div>
        {/if}
      {/if}
    </div>
  </main>
</div>

{#snippet iconeTheme()}
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
{/snippet}

<style>
  .app {
    display: flex;
    flex-direction: column;
    /* `100vh` compte la bande que la barre d'adresse mobile recouvre : au
       repli de celle-ci pendant un defilement, la scene changeait de hauteur,
       ce qui redimensionnait le canevas et reconstruisait les deux frises.
       `dvh` suit la hauteur reellement visible ; `vh` reste en repli. */
    height: 100vh;
    height: 100dvh;
  }

  main {
    display: grid;
    flex: 1;
    min-height: 0;
    position: relative;
    /* Largeur du bloc du haut et du volet, au large : la rangee d'outils —
       compte, vue, filtres, frises — doit y tenir sur une ligne. */
    --largeur-volet: 440px;
  }

  .centre {
    display: grid;
    grid-template-rows: 1fr auto;
    min-width: 0;
    min-height: 0;
  }

  /* La scene porte `--carte-terre` : la couleur que le fond de carte va
     peindre. C'est ce qui supprime le flash entre le montage — ou une bascule
     de theme, qui recharge la feuille de style — et le premier rendu WebGL. */
  .scene {
    position: relative;
    min-height: 0;
    /* `clip` et non `hidden` : `hidden` masque la barre de defilement mais
       laisse la scene defilable par programme — un `focus()` ou un
       `scrollIntoView` vers un calque translate la decalait de 354 px, carte
       comprise. `clip` n'en fait pas un conteneur de defilement du tout.
       `hidden` reste en repli pour les navigateurs qui ne le connaissent pas. */
    overflow: hidden;
    overflow: clip;
    background: var(--carte-terre);
  }

  /* --- Bloc du haut ----------------------------------------------------- */
  .haut {
    position: absolute;
    top: calc(12px + var(--sa-haut));
    left: calc(12px + var(--sa-gauche));
    z-index: 4;
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: var(--largeur-volet);
    max-width: calc(100% - 24px);
  }

  /* La carte de recherche : une surface posee, comme tout ce qui flotte sur la
     carte — fond plein, filet plus sombre que les terres, ombre. */
  .barre {
    /* Contre elle se positionne la liste des suggestions (`Recherche`). */
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 6px 6px 14px;
    border: 1px solid var(--bord-flottant);
    border-radius: var(--r-l);
    background: var(--fond-carte);
    box-shadow: var(--ombre-carte);
  }

  .marque {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    flex: 0 0 auto;
  }

  .marque strong {
    font-family: var(--police-titre);
    font-size: 21px;
    font-weight: 500;
    letter-spacing: -0.005em;
    line-height: 1;
    color: var(--texte);
  }

  .marque .sous {
    display: none;
  }

  /* La rangee d'outils : des pastilles posees sur la carte, pas une barre. */
  .outils {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .chiffres,
  .bascule,
  .outil,
  .theme {
    border: 1px solid var(--bord-flottant);
    background: var(--fond-carte);
    box-shadow: var(--ombre-carte);
  }

  .chiffres {
    display: flex;
    align-items: center;
    height: 34px;
    padding: 0 12px;
    border-radius: var(--r-pilule);
    font-size: 11.5px;
    color: var(--texte-tenu);
    white-space: nowrap;
  }

  .chiffres b {
    margin-right: 3px;
    font-family: var(--police-titre);
    font-size: 15px;
    font-weight: 500;
    color: var(--texte);
    font-variant-numeric: tabular-nums;
  }

  /* Selecteur de vue : un rail, la vue active est une pastille posee. */
  .bascule {
    display: flex;
    gap: 2px;
    padding: 3px;
    border-radius: var(--r-pilule);
  }

  .bascule button {
    padding: 4px 13px;
    border: none;
    border-radius: var(--r-pilule);
    background: transparent;
    color: var(--texte-faible);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all var(--t-rapide);
  }

  @media (hover: hover) and (pointer: fine) {
    .bascule button:hover {
      color: var(--texte);
    }
  }

  .bascule button.actif {
    background: var(--fond-creux);
    color: var(--texte);
    font-weight: 600;
  }

  .outil {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 34px;
    padding: 0 12px;
    border-radius: var(--r-pilule);
    color: var(--texte);
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
    transition: all var(--t-rapide);
  }

  .outil svg {
    width: 15px;
    height: 15px;
    color: var(--texte-faible);
  }

  @media (hover: hover) and (pointer: fine) {
    .outil:hover {
      border-color: var(--accent);
      color: var(--accent);
    }
  }

  .outil[aria-expanded='true'] {
    border-color: var(--inscrit);
    color: var(--inscrit-texte);
  }

  .outil em {
    min-width: 17px;
    padding: 1px 5px;
    border-radius: var(--r-pilule);
    background: var(--accent-plein);
    color: var(--texte-sur-plein);
    font-size: 10.5px;
    font-style: normal;
    font-variant-numeric: tabular-nums;
    text-align: center;
  }

  /* Le theme : une pastille sans libelle, au coin haut droit de la carte au
     large — un confort de lecture n'a pas a peser autant qu'une action. Le
     trait de l'icone est `currentColor`, il suit donc le jeton de couleur. */
  .theme {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    padding: 0;
    border-radius: 50%;
    color: var(--texte-faible);
    cursor: pointer;
  }

  .theme-large {
    position: absolute;
    top: calc(12px + var(--sa-haut));
    right: calc(12px + var(--sa-droite));
    z-index: 4;
  }

  .theme-etroit {
    display: none;
  }

  @media (hover: hover) and (pointer: fine) {
    .theme:hover {
      color: var(--texte);
    }
  }

  .theme svg {
    width: 16px;
    height: 16px;
  }

  /* --- Volet ------------------------------------------------------------
     Au large : une colonne sous le bloc du haut, de la meme largeur, qui
     flotte sur la carte sans la comprimer — l'ouvrir ne redimensionne pas le
     canevas WebGL. Ferme, il sort a gauche ; `visibility` le retire de
     l'ordre de tabulation une fois la transition finie. Pas de
     `backdrop-filter` : un flou au-dessus d'un canevas se paie a chaque image. */
  .volet {
    position: absolute;
    top: calc(12px + var(--sa-haut) + var(--hauteur-haut) + 8px);
    bottom: 12px;
    left: calc(12px + var(--sa-gauche));
    z-index: 6;
    display: flex;
    flex-direction: column;
    width: var(--largeur-volet);
    max-width: calc(100% - 24px);
    overflow: hidden;
    border: 1px solid var(--bord-flottant);
    border-radius: var(--r-l);
    /* Le fond est porte ici, jamais par ce qui defile dedans : un conteneur
       defilant opaque sous un parent translate fait croire au compositeur
       qu'il masque la carte la ou il serait sans la translation. */
    background: var(--fond-carte);
    box-shadow: var(--ombre-fiche);
    transform: translateX(calc(-100% - 24px));
    visibility: hidden;
    transition:
      transform var(--t-tiroir),
      visibility 0s var(--t-tiroir);
  }

  .volet.ouvert {
    transform: translateX(0);
    visibility: visible;
    transition: transform var(--t-tiroir);
  }

  /* `hidden` cede devant tout `display` ecrit par une classe : il faut le
     redire. */
  .volet [hidden] {
    display: none !important;
  }

  .colonne {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-height: 0;
  }

  .fiche-hote > :global(.fiche),
  .facettes > :global(.panneau),
  .contenu-liste > :global(.liste) {
    flex: 1 1 auto;
    min-height: 0;
  }

  /* Poignee et en-tete de feuille n'existent que sur telephone. */
  .poignee,
  .entete-feuille {
    display: none;
  }

  /* En-tete des filtres : le titre nomme ce qu'on regarde, la pastille le
     referme. */
  .entete-tiroir {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: space-between;
    padding: 16px 18px 10px 22px;
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

  /* La case elle-meme fait 15 px, mais c'est le label qui recoit le clic : sa
     hauteur est donc la vraie cible, portee ici a 44 px. */
  .zone {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    min-height: 44px;
    gap: 9px;
    padding: 0 22px 10px;
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

  /* --- Surfaces centrales ----------------------------------------------- */
  .amorce,
  .erreur,
  .vide-carte {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    z-index: 3;
    padding: 16px 24px;
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

  .vide-carte {
    display: grid;
    gap: 10px;
    padding: 18px 24px;
    max-width: 320px;
  }

  .vide-carte p {
    margin: 0;
  }

  .vide-carte button {
    justify-self: center;
    padding: 7px 16px;
    border: 1px solid var(--bord-appuye);
    border-radius: var(--r-pilule);
    background: transparent;
    color: var(--accent);
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

  /* L'attente du moteur quand la carte a deja ses points : une pastille en
     haut, au centre, hors des coins d'outils. */
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
     doit pas cacher l'endroit de la carte qu'on regardait. `.avis` est la
     meme surface sans bouton : elle s'efface seule. */
  .avis,
  .alerte-position {
    position: absolute;
    top: 64px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 5;
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

  .avis {
    padding: 10px 16px;
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

  /* Emplacement reserve le temps que le chunk Plot arrive, cf. le commentaire
     du script : hauteur mesuree du panneau reel, aux deux gabarits. */
  .frise-attente {
    height: 168px;
    border-top: 1px solid var(--bord);
    background: var(--frise-fond);
  }

  /* Entre telephone et ecran large, le volet et le bloc du haut se
     resserrent ; tout le reste est identique. Les surfaces du haut de la
     scene descendent sous le bloc, qui occupe davantage de la largeur. */
  @media (max-width: 1100px) {
    main {
      --largeur-volet: 400px;
    }
  }

  @media (max-width: 900px) {
    .frise-attente {
      height: 317px;
    }

    .amorce-discrete,
    .avis,
    .alerte-position {
      top: calc(var(--hauteur-haut) + 24px);
    }
  }

  /* --- Gabarit telephone --------------------------------------------------
     Le volet devient la feuille du bas, a trois crans : repliee (son en-tete
     seul), apercu, depliee. Plus d'onglets : la feuille porte la liste. */
  @media (max-width: 768px) {
    .haut {
      top: calc(8px + var(--sa-haut));
      left: calc(8px + var(--sa-gauche));
      right: calc(8px + var(--sa-droite));
      width: auto;
      max-width: none;
      gap: 6px;
    }

    .barre {
      padding: 5px 5px 5px 8px;
      gap: 6px;
    }

    /* Le titre reste dans le document, pour les lecteurs d'ecran : la largeur
       va au champ. */
    .marque {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }

    .bascule,
    .theme-large {
      display: none;
    }

    .theme-etroit {
      display: inline-flex;
      width: 34px;
      height: 34px;
      margin-left: auto;
    }

    .outils {
      flex-wrap: nowrap;
      gap: 6px;
    }

    .volet {
      top: auto;
      right: 0;
      bottom: 0;
      left: 0;
      width: auto;
      max-width: none;
      /* Hauteur **definie** : c'est ce qui fait defiler la fiche. Avec un
         simple `max-height`, la hauteur restait indefinie et la moitie de la
         notice etait inatteignable. Les crans passent par `transform`, jamais
         par la hauteur : translater ne provoque aucun reflow. */
      height: calc(100% - 8px);
      padding-bottom: var(--sa-bas);
      border-radius: var(--r-l) var(--r-l) 0 0;
      visibility: visible;
      /* Repliee : seul l'en-tete depasse. `--feuille-repliee` vaut `REPLIEE`
         dans le script. */
      --feuille-repliee: 68px;
      transform: translateY(calc(100% - var(--feuille-repliee)));
      transition: transform var(--t-tiroir);
    }

    /* Apercu : 55 % de la feuille sous le bord (`PART_CACHEE` dans le
       script, a garder egal) ; depliee, elle monte entiere. */
    .volet.ouvert {
      transform: translateY(55%);
    }

    .volet.ouvert.plein {
      transform: translateY(0);
    }

    /* Pendant le glissement le `transform` en ligne suit le doigt : une
       transition le ferait trainer derriere lui. */
    .volet.glisse {
      transition: none;
    }

    /* En apercu, la photographie est bornee plus bas : a 48dvh elle occupait
       toute la part visible, et le titre restait sous le bord. */
    .volet:not(.plein) :global(.cadre) {
      max-height: 20dvh;
    }

    /* 44 px **reels** plutot qu'une zone etendue : la feuille porte
       `overflow: hidden`, qui rognerait un `::after` au-dessus d'elle. */
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

    .entete-feuille {
      display: flex;
      flex: 0 0 auto;
      align-items: center;
      justify-content: center;
      gap: 6px;
      height: 32px;
      margin-top: -8px;
      padding: 0 16px;
      border: none;
      background: transparent;
      color: var(--texte-moyen);
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }

    .entete-feuille svg {
      width: 16px;
      height: 16px;
    }

    /* Les surfaces flottantes du pied s'effacent tant que la feuille monte :
       elles seraient dessous, et garderaient leurs boutons dans l'ordre de
       tabulation. Meme procede que les marges : une variable heritee. */
    main.volet-ouvert {
      --legende-visibilite: hidden;
    }
  }
</style>
