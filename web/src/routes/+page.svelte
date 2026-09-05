<script lang="ts">
  import DetailPanel from '$lib/components/DetailPanel.svelte';
  import FacetPanel from '$lib/components/FacetPanel.svelte';
  import MonumentMap from '$lib/components/MonumentMap.svelte';
  import Timeline from '$lib/components/Timeline.svelte';
  import {
    auHasard,
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
    type Point,
    type Totaux
  } from '$lib/db/queries';
  import {
    countActive,
    filters,
    reset,
    toggleSiecle,
    type FacetKey
  } from '$lib/state/filters.svelte';
  import { decoder, encoder } from '$lib/state/permalien';
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
  let vueListe = $state(initial.vueListe);
  let terme = $state(initial.filtres.recherche);

  // La recherche interroge une colonne pre-normalisee (minuscules, sans
  // accents) : un LIKE sur 46 760 lignes repond en quelques ms, aucun index
  // full-text n'est necessaire.
  $effect(() => {
    const saisie = terme;
    const minuteur = setTimeout(() => {
      filters.recherche = saisie
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .trim();
    }, 180);
    return () => clearTimeout(minuteur);
  });

  // Signature profonde de l'etat : un seul point de declenchement pour tout
  // le cycle de requetes, quel que soit le filtre modifie.
  const signature = $derived(JSON.stringify(filters));

  let jeton = 0;

  $effect(() => {
    signature;
    const mien = ++jeton;
    chargement = true;
    Promise.all([
      points(filters),
      totaux(filters),
      histogrammeSiecles(filters),
      histogrammeProtections(filters),
      liste(filters),
      Promise.all(FACETTES.map((cle) => facette(filters, cle)))
    ])
      .then(([pts, tot, sie, ann, lst, fac]) => {
        // Une requete lente ne doit jamais ecraser un resultat plus recent.
        if (mien !== jeton) return;
        pointsCarte = pts;
        compteurs = tot;
        barresSiecles = sie;
        barresAnnees = ann;
        resultats = lst;
        facettes = Object.fromEntries(FACETTES.map((cle, i) => [cle, fac[i]]));
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
    const requete = encoder({ filtres: filters, selection, vueListe });
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
  $effect(() => {
    const requete = page.url.search;
    if (requete === derniereRequete) return;
    derniereRequete = requete;
    const etat = decoder(requete);
    derniereSelection = etat.selection;
    Object.assign(filters, etat.filtres);
    selection = etat.selection;
    vueListe = etat.vueListe;
    terme = etat.filtres.recherche;
  });

  // Le presse-papier peut etre refuse (contexte non securise, permission) :
  // l'echec bascule sur une selection manuelle plutot que de ne rien faire.
  let copie = $state(false);

  async function copierLien() {
    const lien = location.origin + location.pathname + derniereRequete;
    try {
      await navigator.clipboard.writeText(lien);
      copie = true;
      setTimeout(() => (copie = false), 1600);
    } catch {
      window.prompt('Copier ce lien :', lien);
    }
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
      <button class="hasard" onclick={hasard}>Au hasard</button>
      <button class="lien" onclick={copierLien}>{copie ? 'Lien copié' : 'Copier le lien'}</button>
    </div>
  </header>

  <main>
    <FacetPanel {facettes} {chargement} />

    <div class="centre">
      <div class="scene">
        <MonumentMap
          points={pointsCarte}
          {selection}
          onselect={(ref) => (selection = ref)}
          onbbox={(bbox) => (filters.bbox = bbox)}
        />

        {#if vueListe}
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

        <button class="bascule" onclick={() => (vueListe = !vueListe)}>
          {vueListe ? 'Carte' : 'Liste'}
        </button>

        {#if erreur}
          <div class="erreur"><b>Erreur DuckDB</b><p>{erreur}</p></div>
        {:else if chargement && !compteurs}
          <div class="amorce">Chargement de la base…</div>
        {/if}
      </div>

      <Timeline
        siecles={barresSiecles}
        protections={barresAnnees}
        siecleSelection={filters.siecles}
        plage={filters.anneeProtection}
        onsiecle={toggleSiecle}
        onplage={(p) => (filters.anneeProtection = p)}
      />
    </div>

    <DetailPanel reference={selection} onclose={() => (selection = null)} />
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

  .or { color: #e0a458; }
  .bleu { color: #4ea8de; }
  .faible { opacity: 0.7; }

  .raz,
  .hasard,
  .lien {
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

  .lien:hover {
    color: var(--texte);
    border-color: var(--texte-faible);
  }

  main {
    display: grid;
    grid-template-columns: 246px 1fr 340px;
    min-height: 0;
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
    z-index: 2;
    border: 1px solid var(--bord);
    background: color-mix(in srgb, var(--fond) 88%, transparent);
    backdrop-filter: blur(8px);
    color: var(--texte);
    border-radius: 6px;
    padding: 5px 12px;
    font-size: 11px;
    cursor: pointer;
  }

  .liste {
    position: absolute;
    inset: 0;
    z-index: 1;
    overflow-y: auto;
    background: var(--fond);
  }

  .liste header {
    position: sticky;
    top: 0;
    padding: 12px 16px 10px 78px;
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
    color: #e0715e;
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
</style>
