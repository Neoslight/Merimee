<script lang="ts">
  import DetailPanel from '$lib/components/DetailPanel.svelte';
  import FacetPanel from '$lib/components/FacetPanel.svelte';
  import Jetons from '$lib/components/Jetons.svelte';
  import Matrice from '$lib/components/Matrice.svelte';
  import MonumentMap from '$lib/components/MonumentMap.svelte';
  import Timeline from '$lib/components/Timeline.svelte';
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
  import { browser } from '$app/environment';
  import { pushState, replaceState } from '$app/navigation';
  import { page } from '$app/state';

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
  let facettes = $state<Partial<Record<FacetKey, Compte[]>>>({});
  let barresSiecles = $state<BarreSiecle[]>([]);
  let barresAnnees = $state<BarreAnnee[]>([]);
  let cardinaux = $state<Partial<Record<FacetKey, number>>>({});
  let compteurs = $state<Totaux | null>(null);
  let resultats = $state<Ligne[]>([]);
  // L'URL est lue avant le premier cycle de requetes : un lien partage ne doit
  // pas provoquer un aller-retour « corpus complet puis filtre ».
  const initial = decoder(browser ? location.search : '');
  Object.assign(filters, initial.filtres);

  let selection = $state<string | null>(initial.selection);
  let chargement = $state(true);
  let erreur = $state<string | null>(null);
  let vue = $state<Vue>(initial.vue);
  // Le fond historique vit ici et non dans la carte : c'est la page qui
  // ecrit l'URL, et le fond en fait partie. Son opacite, elle, reste dans le
  // composant — dosage de lecture, pas etat d'exploration.
  let fond = $state<FondHistorique | null>(initial.fond);
  let croisement = $state<DonneesMatrice>({ cellules: [], ecartees: 0 });
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
    { vueCourante: () => VueCarte | null; delierVue: () => void } | undefined
  >();

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

  $effect(() => {
    signature;
    // La matrice croise monuments et protections : elle ne se calcule que
    // lorsqu'elle est a l'ecran.
    const veutMatrice = vue === 'matrice';
    const mien = ++jeton;
    chargement = true;
    Promise.all([
      points(filters),
      totaux(filters),
      histogrammeSiecles(filters),
      histogrammeProtections(filters),
      liste(filters),
      Promise.all(FACETTES.map((cle) => facette(filters, cle))),
      cardinalites(filters),
      veutMatrice ? matrice(filters) : Promise.resolve(croisement)
    ])
      .then(([pts, tot, sie, ann, lst, fac, card, mat]) => {
        // Une requete lente ne doit jamais ecraser un resultat plus recent.
        if (mien !== jeton) return;
        pointsCarte = pts;
        compteurs = tot;
        barresSiecles = sie;
        barresAnnees = ann;
        resultats = lst;
        facettes = Object.fromEntries(FACETTES.map((cle, i) => [cle, fac[i]]));
        cardinaux = card;
        croisement = mat;
        erreur = null;
        chargement = false;
      })
      .catch((e) => {
        if (mien !== jeton) return;
        erreur = e instanceof Error ? e.message : String(e);
        chargement = false;
      });
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
    if (puce.cle === 'bbox') vueCarte?.delierVue();
  }

  function toutEffacer() {
    reset();
    terme = '';
    vueCarte?.delierVue();
  }

  // Le seuil telephone (768 px) est purement graphique — la fiche remonte du
  // bas au lieu de glisser du cote — et vit donc dans la feuille de style.
  // Celui-ci commande de l'etat : tiroir referme, frise repliee, voile pose.
  const ETROIT = '(max-width: 900px)';
  let etroit = $state(false);
  let facettesOuvertes = $state(false);
  let friseOuverte = $state(true);

  $effect(() => {
    if (!browser) return;
    const moyen = window.matchMedia(ETROIT);
    const appliquerGabarit = () => {
      etroit = moyen.matches;
      friseOuverte = !moyen.matches;
      // Le tiroir est ouvert par defaut des qu'il y a la place de le poser a
      // cote de la carte, referme sinon : c'est un calque, il ne prend rien.
      facettesOuvertes = !moyen.matches;
    };
    appliquerGabarit();
    moyen.addEventListener('change', appliquerGabarit);
    return () => moyen.removeEventListener('change', appliquerGabarit);
  });

  // Ouvrir une fiche sur un ecran etroit doit refermer le tiroir des filtres,
  // sinon la fiche s'ouvre derriere lui. Au large les deux calques cohabitent.
  $effect(() => {
    if (selection && etroit) facettesOuvertes = false;
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
    if (ref) selection = ref;
  }

  const nf = new Intl.NumberFormat('fr-FR');
  const actifs = $derived(countActive(filters));
  const puces = $derived(jetonsActifs(filters));
  // Le tiroir ne se pose a cote de la carte qu'au large : c'est le seul cas ou
  // la legende et l'attribution, ancrees en bas a gauche, doivent s'ecarter
  // pour ne pas passer dessous. Une classe plutot qu'une chaine de pixels : la
  // largeur n'est ecrite qu'une fois, dans `--largeur-tiroir`.
  const tiroirPose = $derived(facettesOuvertes && !etroit);
</script>

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
          <button
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
        <button class="hasard" onclick={hasard}>Au hasard</button>
      </div>
    </div>

    <!-- Un seul compteur : le total suit les filtres et c'est le seul qui
         reponde a « combien en reste-t-il ». Classes, inscrites et objets se
         relisent dans le tiroir, ou la facette « statut » les donne deja
         croises — les repeter ici etait une triple lecture du meme etat. -->
    <div class="chiffres">
      {#if compteurs}
        <span><b>{nf.format(compteurs.total)}</b> notices</span>
      {/if}
      <!-- Le libelle est porte par `aria-label` et non par le texte : l'icone
           dit la destination (lune vers le sombre, soleil vers le clair), le
           nom accessible la nomme. -->
      <button class="theme" onclick={basculer}
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
      <div class="scene" class:tiroir-ouvert={facettesOuvertes}>
        <MonumentMap
          bind:this={vueCarte}
          points={pointsCarte}
          {selection}
          vueInitiale={cadrageInitial}
          bind:fond
          onselect={(ref) => (selection = ref)}
          onbbox={(bbox) => (filters.bbox = bbox)}
        />

        {#if vue === 'matrice'}
          <Matrice
            cellules={croisement.cellules}
            ecartees={croisement.ecartees}
            siecleSelection={filters.siecles}
            plage={filters.anneeProtection}
            oncellule={choisirCellule}
          />
        {/if}

        {#if vue === 'liste'}
          <div class="liste">
            <header>
              <h3>
                {compteurs ? nf.format(compteurs.total) : '—'} notices
                {#if compteurs && compteurs.total > resultats.length}
                  <em>
                    (200 premières, {filters.texte
                      ? 'les plus pertinentes'
                      : 'les plus riches en mobilier'})
                  </em>
                {/if}
              </h3>
              {#if compteurs}
                <p>
                  {nf.format(compteurs.total - compteurs.geolocalises)} sans coordonnées,
                  absentes de la carte
                </p>
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
                    onclick={() => (selection = ligne.reference)}
                  >
                    <span class="nom">{ligne.titre}</span>
                    <span class="meta">
                      {ligne.commune} · {ligne.departement_nom}
                      {#if ligne.nb_palissy > 0}· {nf.format(ligne.nb_palissy)} objets{/if}
                    </span>
                  </button>
                </li>
              {/each}
            </ul>
          </div>
        {/if}

        {#if erreur}
          <div class="erreur"><b>Erreur DuckDB</b><p>{erreur}</p></div>
        {:else if chargement && !compteurs}
          <div class="amorce">{LIBELLES[amorcage.phase]}</div>
        {/if}

        <!-- Le tiroir se commande depuis le coin de la carte, la ou il
             s'ouvre, et non plus depuis la barre. Il s'efface tant qu'il est
             ouvert : la croix de l'en-tete du tiroir est alors le seul geste
             de fermeture, et le bouton revient avec elle. -->
        {#if !facettesOuvertes}
          <button class="filtres" aria-expanded="false"
                  onclick={() => (facettesOuvertes = true)}>
            Filtres{#if actifs > 0} <em>{actifs}</em>{/if}
          </button>
        {/if}

        <!-- Les deux panneaux sont des calques : la carte garde sa pleine
             largeur et les ouvrir ne provoque aucun redimensionnement du
             canevas WebGL. Ils vivent dans la scene, pas dans `main`, pour
             laisser la frise entierement visible sous eux. -->
        <div class="colonne facettes" class:ouvert={facettesOuvertes}>
          <div class="entete-tiroir">
            <h2>Filtres</h2>
            <button class="fermer-tiroir" aria-label="Fermer les filtres"
                    onclick={() => (facettesOuvertes = false)}>×</button>
          </div>
          <FacetPanel {facettes} {cardinaux} {chargement} />
        </div>

        {#if etroit && facettesOuvertes}
          <!-- Fermer en touchant a cote : le geste attendu sur un tiroir. Au
               large le tiroir ne recouvre rien, il n'y a rien a voiler. -->
          <button class="voile" aria-label="Fermer les filtres"
                  onclick={() => (facettesOuvertes = false)}></button>
        {/if}

        <div class="colonne fiche-hote" class:ouvert={selection !== null}>
          <DetailPanel reference={selection} {copie} oncopier={copierLien}
                       onclose={() => (selection = null)} />
        </div>
      </div>

      {#if etroit}
        <button class="replier" aria-expanded={friseOuverte}
                onclick={() => (friseOuverte = !friseOuverte)}>
          {friseOuverte ? 'Masquer les frises' : 'Afficher les frises'}
        </button>
      {/if}

      {#if friseOuverte}
      <Timeline
        siecles={barresSiecles}
        protections={barresAnnees}
        siecleSelection={filters.siecles}
        plage={filters.anneeProtection}
        onsiecle={toggleSiecle}
        onsiecles={(choix) => (filters.siecles = choix)}
        onplage={(p) => (filters.anneeProtection = p)}
      />
      {/if}
    </div>
  </main>
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
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
    padding: 12px 24px;
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
    height: 40px;
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

  .cible:hover:not(:disabled) {
    color: var(--texte);
    border-color: var(--inscrit);
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

  .recherche {
    flex: 1 1 auto;
    min-width: 0;
    height: 40px;
    padding: 0 16px 0 38px;
    background:
      var(--icone-recherche) no-repeat 14px 50% / 15px 15px,
      var(--fond-creux);
    border: 1px solid var(--bord);
    border-radius: var(--r-pilule);
    color: var(--texte);
    font-size: 13px;
    transition:
      border-color var(--t-rapide),
      background-color var(--t-rapide);
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
  .hasard {
    flex: 0 0 auto;
    height: 40px;
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

  .hasard:hover {
    border-color: var(--inscrit);
    background: color-mix(in srgb, var(--inscrit) 10%, var(--fond-carte));
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

  .theme:hover {
    color: var(--texte);
    border-color: var(--bord-appuye);
  }

  .theme svg {
    width: 16px;
    height: 16px;
  }

  /* Le tiroir se commande depuis le coin ou il s'ouvre, avec le compte des
     criteres poses : c'est tout ce qui en reste visible une fois referme.
     z-index 4 : au-dessus de la liste et de la matrice (3), qui recouvrent la
     scene et pour lesquelles les filtres comptent autant, mais sous le voile
     (5) et le tiroir (6), qu'il n'a pas a percer. */
  .filtres {
    position: absolute;
    top: 12px;
    left: 12px;
    z-index: 4;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    border: none;
    background: var(--plein-fond);
    color: var(--plein-texte);
    border-radius: var(--r-pilule);
    padding: 9px 16px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    box-shadow: var(--ombre-bouton);
    transition: opacity var(--t-rapide);
  }

  .filtres:hover {
    opacity: 0.85;
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

  .bascule button:hover {
    background: color-mix(in srgb, var(--bord) 60%, transparent);
    color: var(--texte);
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

  /* La scene est en ardoise dans les deux themes : le fond de carte s'y pose
     sans filet, et le theme ne pilote que l'interface. */
  .scene {
    position: relative;
    min-height: 0;
    overflow: hidden;
    background: var(--ardoise);
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

  .liste button:hover {
    background: var(--fond-creux);
  }

  .liste button.choisi {
    background: var(--accent-doux);
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

  /* --- Les deux calques ---------------------------------------------------
     Aucun `backdrop-filter` : un flou plein ecran au-dessus d'un canevas WebGL
     se paie a chaque image. Fond opaque, ombre portee. */
  .colonne {
    position: absolute;
    display: grid;
    min-height: 0;
    transition: transform var(--t-tiroir);
  }

  .facettes {
    inset: 0 auto 0 0;
    z-index: 6;
    grid-template-rows: auto 1fr;
    width: var(--largeur-tiroir);
    transform: translateX(-100%);
    box-shadow: var(--ombre-tiroir);
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

  .fermer-tiroir:hover {
    background: var(--fond-creux);
    color: var(--texte);
  }

  /* La fiche ne compresse plus la carte : elle flotte par-dessus, et seulement
     quand une notice est choisie. L'invite « selectionnez un point » n'a donc
     plus 392 px a occuper en permanence. Le decalage de sortie compte la marge,
     sinon l'ombre reste visible sur le bord. */
  .fiche-hote {
    inset: 12px 12px 12px auto;
    z-index: 7;
    width: var(--largeur-fiche);
    border-radius: var(--r-l);
    overflow: hidden;
    transform: translateX(calc(100% + 16px));
    box-shadow: var(--ombre-fiche);
  }

  .fiche-hote.ouvert {
    transform: translateX(0);
  }

  .voile,
  .replier {
    display: none;
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
      padding: 10px 16px;
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
      padding: 10px 12px;
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

    .replier {
      display: block;
      width: 100%;
      border: none;
      border-top: 1px solid var(--bord);
      background: var(--fond);
      color: var(--texte-faible);
      padding: 7px;
      font-size: 11px;
      cursor: pointer;
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

    .fiche-hote {
      inset: auto 0 0 0;
      width: auto;
      max-height: 82%;
      border-radius: var(--r-l) var(--r-l) 0 0;
      transform: translateY(101%);
    }

    .fiche-hote.ouvert {
      transform: translateY(0);
    }
  }
</style>
