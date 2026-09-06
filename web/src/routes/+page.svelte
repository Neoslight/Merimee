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
    type Point,
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
  import { appliquer, basculer, theme } from '$lib/state/theme.svelte';
  import { amorcage, LIBELLES } from '$lib/state/amorcage.svelte';
  import { browser } from '$app/environment';
  import { pushState, replaceState } from '$app/navigation';
  import { page } from '$app/state';

  const FACETTES: FacetKey[] = [
    'statut', 'domaines', 'denominations', 'regions',
    'departements', 'auteurs', 'proprietaires', 'periodes'
  ];

  let pointsCarte = $state<Point[]>([]);
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
  let terme = $state(initial.filtres.recherche);

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

  // La recherche interroge une colonne pre-normalisee (minuscules, sans
  // accents) : un LIKE sur 46 760 lignes repond en quelques ms, aucun index
  // full-text n'est necessaire.
  $effect(() => {
    const saisie = terme;
    const minuteur = setTimeout(() => {
      filters.recherche = replier(saisie);
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
    terme = etat.filtres.recherche;
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
    if (puce.cle === 'recherche') terme = '';
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
    <div class="marque">
      <strong>Mérimée</strong>
      <i class="filet" aria-hidden="true"></i>
      <span class="sous">
        <span>Monuments historiques</span>
        <span class="dates">1840 — 2026</span>
      </span>
    </div>

    <nav class="bascule">
      {#each VUES as choix (choix.cle)}
        <button
          class:actif={vue === choix.cle}
          aria-pressed={vue === choix.cle}
          onclick={() => (vue = choix.cle)}
        >{choix.titre}</button>
      {/each}
    </nav>

    <input
      class="recherche"
      type="search"
      placeholder="Rechercher un édifice, une commune, un département…"
      bind:value={terme}
    />

    <div class="chiffres">
      {#if compteurs}
        <span><b>{nf.format(compteurs.total)}</b> notices</span>
        <span class="or">{nf.format(compteurs.classes)} classées</span>
        <span class="bleu">{nf.format(compteurs.inscrits)} inscrites</span>
        <span class="faible">{nf.format(compteurs.objets)} objets</span>
      {/if}
      <button class="filtres" aria-expanded={facettesOuvertes}
              onclick={() => (facettesOuvertes = !facettesOuvertes)}>
        Filtres{#if actifs > 0} <em>{actifs}</em>{/if}
      </button>
      <button class="hasard" onclick={hasard}>Au hasard</button>
      <button class="theme" onclick={basculer}
              title="Basculer entre thème sombre et thème clair">
        {theme.courant === 'clair' ? 'Sombre' : 'Clair'}
      </button>
      <button class="lien" onclick={copierLien}>{copie ? 'Lien copié' : 'Copier le lien'}</button>
    </div>
  </header>

  {#if puces.length > 0}
    <Jetons jetons={puces} {actifs} onretirer={retirerJeton} onreset={toutEffacer} />
  {/if}

  <main class:fiche-ouverte={selection !== null} class:tiroir-pose={tiroirPose}>
    <div class="centre">
      <div class="scene">
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
                  <em>(200 premières, les plus riches en mobilier)</em>
                {/if}
              </h3>
              {#if compteurs}
                <p>
                  {nf.format(compteurs.total - compteurs.geolocalises)} sans coordonnées,
                  absentes de la carte
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
     caracteres. */
  .barre {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 24px;
    padding: 12px 24px;
    min-height: 72px;
    background: var(--fond-carte);
    border-bottom: 1px solid var(--bord);
  }

  /* La marque passe en serif editorial et en casse normale : les capitales
     espacees la faisaient lire comme une etiquette, pas comme un titre. */
  .marque {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .marque strong {
    font-family: var(--police-titre);
    font-size: 27px;
    font-weight: 500;
    letter-spacing: -0.005em;
    line-height: 1;
    color: var(--texte);
  }

  .filet {
    width: 1px;
    height: 34px;
    background: linear-gradient(var(--bord), var(--bord-appuye), var(--bord));
  }

  .sous {
    display: flex;
    flex-direction: column;
    gap: 3px;
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

  .recherche {
    flex: 1 1 220px;
    min-width: 0;
    max-width: 420px;
    height: 40px;
    padding: 0 16px 0 38px;
    background:
      var(--icone-recherche) no-repeat 14px 50% / 15px 15px,
      color-mix(in srgb, var(--fond-creux) 72%, transparent);
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
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 10px 14px;
    margin-left: auto;
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

  /* Noms de classes conserves, teintes patrimoniales : le classe est
     terracotta, l'inscrit ocre dore. */
  .or {
    color: var(--classe-texte);
    font-weight: 600;
  }

  .bleu {
    color: var(--inscrit-texte);
    font-weight: 600;
  }

  .faible { opacity: 0.85; }

  .hasard,
  .lien,
  .theme {
    border: 1px solid var(--bord);
    background: transparent;
    color: var(--texte-faible);
    border-radius: var(--r-pilule);
    padding: 8px 15px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all var(--t-rapide);
  }

  /* L'action principale reste « Au hasard » ; le permalien s'efface derriere. */
  .hasard {
    border-color: var(--bord-appuye);
    background: var(--fond-carte);
    color: var(--inscrit-texte);
    font-weight: 600;
  }

  .hasard:hover {
    border-color: var(--inscrit);
    background: color-mix(in srgb, var(--inscrit) 10%, var(--fond-carte));
  }

  .lien:hover,
  .theme:hover {
    color: var(--texte);
    border-color: var(--bord-appuye);
  }

  /* Le tiroir se commande a toutes les largeurs, avec le compte des criteres
     poses : c'est tout ce qui en reste visible une fois referme. C'est aussi
     la seule action pleine de la barre. */
  .filtres {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    border: none;
    background: var(--plein-fond);
    color: var(--plein-texte);
    border-radius: var(--r-pilule);
    padding: 8px 15px;
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
    padding: 14px 20px 12px;
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

    /* Le selecteur de vue occupe desormais la barre : quelque chose doit
       ceder avant le champ de recherche. Le sous-titre et le compte d'objets
       sont ce qui manque le moins — les deux se relisent ailleurs. */
    .marque span,
    .chiffres .faible {
      display: none;
    }
  }

  /* Sous 1150 px le champ prend sa propre rangee plutot que de se reduire :
     `flex-basis: 100%` suffit, la barre s'enroulant deja. */
  @media (max-width: 1150px) {
    .barre {
      padding: 10px 16px;
      gap: 10px 16px;
    }

    .recherche {
      order: 3;
      flex-basis: 100%;
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

    .marque .sous,
    .marque .filet {
      display: none;
    }

    .marque strong {
      font-size: 23px;
    }

    .bascule {
      order: 2;
      flex-basis: 100%;
    }

    .chiffres {
      gap: 8px;
      font-size: 11px;
    }

    /* Sur un ecran etroit, seul le total tient : le detail par statut reste
       lisible dans la fiche et la liste. « Copier le lien » disparait au
       profit du partage natif du navigateur. */
    .chiffres .or,
    .chiffres .bleu,
    .chiffres .faible,
    .lien,
    .theme {
      display: none;
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
