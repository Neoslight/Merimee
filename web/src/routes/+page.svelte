<script lang="ts">
  import DetailPanel from '$lib/components/DetailPanel.svelte';
  import FacetPanel from '$lib/components/FacetPanel.svelte';
  import Matrice from '$lib/components/Matrice.svelte';
  import MonumentMap from '$lib/components/MonumentMap.svelte';
  import Timeline from '$lib/components/Timeline.svelte';
  import {
    auHasard,
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
    replier,
    reset,
    toggleSiecle,
    type FacetKey
  } from '$lib/state/filters.svelte';
  import { decoder, encoder, type Vue, type VueCarte } from '$lib/state/permalien';
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
  let croisement = $state<DonneesMatrice>({ cellules: [], ecartees: 0 });
  let terme = $state(initial.filtres.recherche);

  // Position de depart de la carte, portee par le lien partage et par lui seul.
  const cadrageInitial = initial.cadrage;
  let vueCarte = $state<{ vueCourante: () => VueCarte | null } | undefined>();

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
      veutMatrice ? matrice(filters) : Promise.resolve(croisement)
    ])
      .then(([pts, tot, sie, ann, lst, fac, mat]) => {
        // Une requete lente ne doit jamais ecraser un resultat plus recent.
        if (mien !== jeton) return;
        pointsCarte = pts;
        compteurs = tot;
        barresSiecles = sie;
        barresAnnees = ann;
        resultats = lst;
        facettes = Object.fromEntries(FACETTES.map((cle, i) => [cle, fac[i]]));
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
    const requete = encoder({ filtres: filters, selection, vue });
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
    terme = etat.filtres.recherche;
  });

  // Le presse-papier peut etre refuse (contexte non securise, permission) :
  // l'echec bascule sur une selection manuelle plutot que de ne rien faire.
  let copie = $state(false);

  async function copierLien() {
    // Seul endroit ou la vue de carte entre dans une URL. L'URL vivante n'en
    // porte pas : un simple deplacement ne doit rien reecrire.
    const requete = encoder({ filtres: filters, selection, vue }, vueCarte?.vueCourante());
    const lien = location.origin + location.pathname + requete;
    try {
      await navigator.clipboard.writeText(lien);
      copie = true;
      setTimeout(() => (copie = false), 1600);
    } catch {
      window.prompt('Copier ce lien :', lien);
    }
  }

  // Sous 900 px la grille a trois colonnes ne tient pas : les deux panneaux
  // deviennent des calques, et la frise se replie. L'etat d'ouverture depend
  // du gabarit, il est donc lu au montage plutot que devine.
  const ETROIT = '(max-width: 900px)';
  let etroit = $state(false);
  let facettesOuvertes = $state(false);
  let friseOuverte = $state(true);

  $effect(() => {
    if (!browser) return;
    const requete = window.matchMedia(ETROIT);
    const appliquer = () => {
      etroit = requete.matches;
      friseOuverte = !requete.matches;
      if (!requete.matches) facettesOuvertes = false;
    };
    appliquer();
    requete.addEventListener('change', appliquer);
    return () => requete.removeEventListener('change', appliquer);
  });

  // Ouvrir une fiche au telephone doit refermer le tiroir des filtres, sinon
  // la fiche s'ouvre derriere lui.
  $effect(() => {
    if (selection) facettesOuvertes = false;
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
</script>

<div class="app">
  <header class="barre">
    <div class="marque">
      <strong>MÉRIMÉE</strong>
      <span>monuments historiques · 1840 – 2026</span>
    </div>

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
      {#if actifs > 0}
        <button class="raz" onclick={reset}>effacer {actifs} filtre{actifs > 1 ? 's' : ''}</button>
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

  <main>
    <div class="colonne facettes" class:ouvert={facettesOuvertes}>
      {#if etroit}
        <!-- Le voile ne laisse qu'une bande de 60 px a cote du tiroir : trop
             etroit pour etre la seule maniere de le refermer. -->
        <button class="fermer-tiroir" onclick={() => (facettesOuvertes = false)}>
          Fermer les filtres
        </button>
      {/if}
      <FacetPanel {facettes} {chargement} />
    </div>

    {#if etroit && facettesOuvertes}
      <!-- Fermer en touchant a cote : le geste attendu sur un tiroir. -->
      <button class="voile" aria-label="Fermer les filtres"
              onclick={() => (facettesOuvertes = false)}></button>
    {/if}

    <div class="centre">
      <div class="scene">
        <MonumentMap
          bind:this={vueCarte}
          points={pointsCarte}
          {selection}
          vueInitiale={cadrageInitial}
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

        <nav class="bascule">
          {#each VUES as choix (choix.cle)}
            <button
              class:actif={vue === choix.cle}
              aria-pressed={vue === choix.cle}
              onclick={() => (vue = choix.cle)}
            >{choix.titre}</button>
          {/each}
        </nav>

        {#if erreur}
          <div class="erreur"><b>Erreur DuckDB</b><p>{erreur}</p></div>
        {:else if chargement && !compteurs}
          <div class="amorce">{LIBELLES[amorcage.phase]}</div>
        {/if}
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
        onplage={(p) => (filters.anneeProtection = p)}
      />
      {/if}
    </div>

    <div class="colonne fiche-hote" class:ouvert={selection !== null}>
      <DetailPanel reference={selection} onclose={() => (selection = null)} />
    </div>
  </main>
</div>

<style>
  .app {
    display: grid;
    grid-template-rows: auto 1fr;
    height: 100vh;
  }

  .barre {
    display: grid;
    grid-template-columns: 260px 1fr auto;
    align-items: center;
    gap: 18px;
    padding: 0 16px;
    height: 52px;
    border-bottom: 1px solid var(--bord);
  }

  .marque {
    display: flex;
    flex-direction: column;
    line-height: 1.25;
  }

  .marque strong {
    font-size: 13px;
    letter-spacing: 0.22em;
    color: var(--accent);
  }

  .marque span {
    font-size: 10px;
    letter-spacing: 0.04em;
    color: var(--texte-faible);
  }

  .recherche {
    width: 100%;
    max-width: 460px;
    padding: 7px 12px;
    background: var(--fond-creux);
    border: 1px solid var(--bord);
    border-radius: 6px;
    color: var(--texte);
    font-size: 13px;
  }

  .recherche:focus {
    outline: none;
    border-color: var(--accent);
  }

  .chiffres {
    display: flex;
    align-items: center;
    gap: 14px;
    font-size: 11px;
    color: var(--texte-faible);
  }

  .chiffres b {
    color: var(--texte);
    font-variant-numeric: tabular-nums;
  }

  .or { color: var(--classe); }
  .bleu { color: var(--inscrit); }
  .faible { opacity: 0.7; }

  .raz,
  .hasard,
  .lien,
  .theme {
    border: 1px solid var(--bord);
    background: transparent;
    color: var(--texte-faible);
    border-radius: 999px;
    padding: 4px 12px;
    font-size: 11px;
    cursor: pointer;
  }

  /* L'action principale reste « Au hasard » ; le permalien s'efface derriere. */
  .hasard {
    border-color: var(--accent);
    color: var(--accent);
  }

  .lien:hover,
  .theme:hover {
    color: var(--texte);
    border-color: var(--texte-faible);
  }

  main {
    display: grid;
    grid-template-columns: 246px 1fr 340px;
    min-height: 0;
    position: relative;
  }

  /* Les enveloppes existent pour que la page pilote la mise en page des deux
     panneaux sans reaching dans leur CSS interne. */
  .colonne {
    display: grid;
    min-height: 0;
  }

  .filtres,
  .replier,
  .voile,
  .fermer-tiroir {
    display: none;
  }

  .centre {
    display: grid;
    grid-template-rows: 1fr auto;
    min-width: 0;
    min-height: 0;
  }

  .scene {
    position: relative;
    min-height: 0;
    background: var(--fond-creux);
  }

  .bascule {
    position: absolute;
    top: 12px;
    left: 12px;
    z-index: 4;
    display: flex;
    gap: 1px;
    padding: 1px;
    border: 1px solid var(--bord);
    background: color-mix(in srgb, var(--fond) 88%, transparent);
    backdrop-filter: blur(8px);
    border-radius: 7px;
  }

  .bascule button {
    border: none;
    background: transparent;
    color: var(--texte-faible);
    border-radius: 6px;
    padding: 4px 11px;
    font-size: 11px;
    cursor: pointer;
  }

  .bascule button.actif {
    background: var(--fond-creux);
    color: var(--accent);
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

  .liste header {
    position: sticky;
    top: 0;
    /* Degage le selecteur de vue, pose en absolu au-dessus. */
    padding: 12px 16px 10px 200px;
    border-bottom: 1px solid var(--bord);
    background: var(--fond);
  }

  .liste h3 {
    margin: 0;
    font-size: 12px;
    font-weight: 600;
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
    padding: 6px;
  }

  .liste button {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    padding: 7px 10px;
    background: none;
    border: none;
    border-radius: 5px;
    text-align: left;
    cursor: pointer;
  }

  .liste button:hover {
    background: var(--fond-creux);
  }

  .liste button.choisi {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }

  .nom {
    font-size: 13px;
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
    padding: 14px 22px;
    border: 1px solid var(--bord);
    border-radius: 8px;
    background: var(--fond);
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

  @media (max-width: 1200px) {
    main {
      grid-template-columns: 220px 1fr 300px;
    }
  }

  /* --- Gabarit etroit -----------------------------------------------------
     Une seule colonne : la scene occupe l'ecran, les deux panneaux passent
     en calques. Un lien partage s'ouvre le plus souvent sur un telephone. */
  @media (max-width: 900px) {
    .barre {
      grid-template-columns: 1fr auto;
      grid-template-rows: auto auto;
      height: auto;
      padding: 8px 12px;
      gap: 8px 12px;
    }

    .marque span {
      display: none;
    }

    .recherche {
      grid-column: 1 / -1;
      grid-row: 2;
    }

    .chiffres {
      gap: 8px;
      font-size: 11px;
      flex-wrap: wrap;
      justify-content: flex-end;
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

    .chiffres {
      flex-wrap: nowrap;
    }

    .filtres {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      border: 1px solid var(--accent);
      background: transparent;
      color: var(--accent);
      border-radius: 999px;
      padding: 4px 12px;
      font-size: 11px;
      cursor: pointer;
    }

    .filtres em {
      font-style: normal;
      font-variant-numeric: tabular-nums;
    }

    main {
      grid-template-columns: 1fr;
    }

    .facettes {
      position: absolute;
      inset: 0 auto 0 0;
      z-index: 6;
      grid-template-rows: auto 1fr;
      width: min(84vw, 320px);
      transform: translateX(-100%);
      transition: transform 160ms ease;
      box-shadow: 0 0 32px rgb(var(--voile) / 55%);
    }

    .facettes.ouvert {
      transform: translateX(0);
    }

    .fermer-tiroir {
      display: block;
      border: none;
      border-bottom: 1px solid var(--bord);
      background: var(--fond-creux);
      color: var(--accent);
      padding: 10px;
      font-size: 12px;
      text-align: left;
      cursor: pointer;
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

    /* La fiche remonte du bas et n'occupe l'ecran que si une notice est
       choisie : l'invite « selectionnez un point » n'a pas de place ici. */
    .fiche-hote {
      position: absolute;
      inset: auto 0 0 0;
      z-index: 7;
      max-height: 82%;
      transform: translateY(101%);
      transition: transform 200ms ease;
      box-shadow: 0 -8px 32px rgb(var(--voile) / 55%);
    }

    .fiche-hote.ouvert {
      transform: translateY(0);
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

    .liste header {
      padding-left: 16px;
      padding-top: 44px;
    }

    .bascule {
      top: 8px;
      left: 8px;
    }
  }
</style>
