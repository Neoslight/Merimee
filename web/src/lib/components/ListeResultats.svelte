<script lang="ts">
  import { formaterDistance, nf } from '$lib/format';
  import { palette } from '$lib/state/theme.svelte';
  import { STATUTS } from '$lib/statuts';
  import type { Ligne, Totaux } from '$lib/db/queries';

  interface Props {
    resultats: Ligne[];
    compteurs: Totaux | null;
    selection: string | null;
    /** Ordre de la liste. `null` tant qu'aucune position n'est connue :
     *  proposer un tri par distance sans position serait un bouton mort. */
    tri: 'pertinence' | 'proximite';
    proposerProximite: boolean;
    /** Le classement est celui du plein texte (BM25), pas du mobilier. */
    pertinence: boolean;
    /** La recherche vise les historiques : sa portee se dit. */
    portee: { notices: number; inconnus: string[] } | null;
    onouvrir: (reference: string) => void;
    oneffacer: () => void;
    /** Defilement de la liste : en feuille d'apercu, la page la deplie. */
    ondefile?: () => void;
  }

  let {
    resultats,
    compteurs,
    selection,
    tri = $bindable(),
    proposerProximite,
    pertinence,
    portee,
    onouvrir,
    oneffacer,
    ondefile
  }: Props = $props();

  const proche = $derived(tri === 'proximite' && proposerProximite);

  /** La teinte du point sur la carte, pour qu'une ligne et son point se
   *  reconnaissent. */
  function teinte(statut: string): string {
    const s = STATUTS.find((x) => x.valeur === statut);
    return s ? palette[s.jeton] : palette.statutNul;
  }

  // Les mots inconnus du lexique, une fois chacun : « 1, 1 » ne disait rien
  // de plus que « 1 ».
  const inconnus = $derived(portee ? [...new Set(portee.inconnus)] : []);
</script>

<!-- L'en-tete reste hors de ce qui defile, et non en `sticky` dedans : un
     element opaque dans un conteneur defilant, sous la feuille translatee du
     telephone, fait croire au compositeur de Chromium qu'il masque la carte
     la ou il serait sans la translation. -->
<div class="liste">
  <header>
    <h3>
      {compteurs ? nf.format(compteurs.total) : '—'} notices
      {#if compteurs && compteurs.total > resultats.length}
        <em>
          (200 premières, {proche
            ? 'les plus proches'
            : pertinence
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
    {#if proposerProximite}
      <div class="tri" role="group" aria-label="Ordre de la liste">
        <button class="frappe-44-v" class:actif={tri === 'pertinence'} aria-pressed={tri === 'pertinence'}
                onclick={() => (tri = 'pertinence')}>
          {pertinence ? 'Pertinence' : 'Mobilier'}
        </button>
        <button class="frappe-44-v" class:actif={tri === 'proximite'} aria-pressed={tri === 'proximite'}
                onclick={() => (tri = 'proximite')}>À proximité</button>
      </div>
    {/if}
    <!-- Le plafond de la recherche plein texte se dit : une notice sur deux ne
         porte aucun historique, et un resultat vide serait autrement
         indiscernable d'un filtre trop serre. -->
    {#if portee}
      <p class="portee">
        Recherche dans les {nf.format(portee.notices)} notices qui portent un historique.
        {#if inconnus.length}
          <b>
            {inconnus.map((mot) => `« ${mot} »`).join(', ')}
            n’apparai{inconnus.length > 1 ? 'ssent' : 't'} dans aucun.
          </b>
        {/if}
      </p>
    {/if}
  </header>
  <div class="defile" onscroll={(e) => { if ((e.currentTarget as HTMLElement).scrollTop > 0) ondefile?.(); }}>
    <ul>
      {#each resultats as ligne (ligne.reference)}
        <li>
          <button class:choisi={selection === ligne.reference} onclick={() => onouvrir(ligne.reference)}>
            <i class="pastille" style="background:{teinte(ligne.statut)}" aria-hidden="true"></i>
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
      <!-- En mode historiques, `.portee` dit deja pourquoi — le plafond
           structurel et les mots inconnus — pas de doublon, seul le bouton
           s'ajoute. -->
      <div class="vide-liste" role="status">
        {#if !portee}
          <p>Aucune notice ne correspond à ces filtres.</p>
        {/if}
        <button onclick={oneffacer}>Effacer les filtres</button>
      </div>
    {/if}
  </div>
</div>

<style>
  .liste {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  header {
    flex: 0 0 auto;
    padding: 14px 18px 12px;
    border-bottom: 1px solid var(--bord);
  }

  .defile {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    /* Sans cela, tirer vers le bas en haut de la liste remonte au navigateur
       et declenche le pull-to-refresh : rechargement complet du wasm et perte
       de l'exploration en cours. */
    overscroll-behavior: contain;
  }

  h3 {
    margin: 0;
    font-family: var(--police-titre);
    font-size: 17px;
    font-weight: 500;
    color: var(--texte);
  }

  h3 em {
    font-style: normal;
    font-weight: 400;
    font-size: 13px;
    color: var(--texte-faible);
  }

  header p {
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

  /* Bascule d'ordre de la liste : un rail, l'option retenue est une pastille. */
  .tri {
    display: inline-flex;
    gap: 2px;
    margin-top: 8px;
    padding: 2px;
    background: var(--fond-creux);
    border-radius: var(--r-pilule);
  }

  .tri button {
    padding: 5px 13px;
    border: none;
    border-radius: var(--r-pilule);
    background: transparent;
    color: var(--texte-faible);
    font-size: 11.5px;
    font-weight: 500;
    cursor: pointer;
  }

  .tri button.actif {
    background: var(--fond-carte);
    color: var(--texte);
    font-weight: 600;
    box-shadow: 0 2px 6px -2px rgb(var(--voile) / 18%);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 6px;
  }

  li button {
    display: grid;
    grid-template-columns: 9px 1fr;
    align-items: baseline;
    column-gap: 9px;
    row-gap: 2px;
    width: 100%;
    padding: 8px 12px;
    border: none;
    border-radius: var(--r-s);
    background: none;
    text-align: left;
    cursor: pointer;
    transition: background var(--t-rapide);
  }

  @media (hover: hover) and (pointer: fine) {
    li button:hover {
      background: var(--fond-creux);
    }
  }

  li button.choisi {
    background: var(--accent-doux);
  }

  .pastille {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    transform: translateY(-1px);
  }

  .nom {
    font-size: 13.5px;
    font-weight: 500;
    color: var(--texte);
  }

  .meta {
    grid-column: 2;
    font-size: 11px;
    color: var(--texte-faible);
  }

  .meta .distance {
    font-weight: 600;
    color: var(--position);
  }

  /* Pose au fil de la liste plutot qu'en surface flottante : elle n'a rien a
     recouvrir, contrairement a son equivalent sur la carte. */
  .vide-liste {
    display: grid;
    gap: 10px;
    padding: 24px 20px;
    text-align: center;
    color: var(--texte-faible);
    font-size: 12.5px;
  }

  .vide-liste p {
    margin: 0;
  }

  .vide-liste button {
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
    .vide-liste button:hover {
      border-color: var(--accent);
    }
  }
</style>
