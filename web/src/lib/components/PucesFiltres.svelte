<script lang="ts">
  import { tick, type Snippet } from 'svelte';
  import FacetPanel from '$lib/components/FacetPanel.svelte';
  import { filters, type FacetKey } from '$lib/state/filters.svelte';
  import type { Compte } from '$lib/db/queries';

  interface Props {
    facettes: Partial<Record<FacetKey, Compte[]>>;
    cardinaux: Partial<Record<FacetKey, number>>;
    chargement: boolean;
    /** Facette dont le menu est ouvert. Liee a la page : les comptes de
     *  facette ne partent que si un menu ou le tiroir les montre. */
    ouverte: FacetKey | null;
    suivreVue: boolean;
    /** Les deux frises, epoque et protection : deux filtres qu'on regle en
     *  brossant un histogramme, d'ou leur puce en tete de rangee. */
    frise: boolean;
    /** Les filtres poses, apres les puces de facette, dans la meme rangee. */
    children?: Snippet;
  }

  let {
    facettes,
    cardinaux,
    chargement,
    ouverte = $bindable(),
    suivreVue = $bindable(),
    frise = $bindable(),
    children
  }: Props = $props();

  /** Les facettes qu'on regle le plus souvent, chacune a un geste. Les autres
   *  — propriete, periode non datee, mobilier — restent dans « Filtres ». */
  const PUCES: { cle: FacetKey; titre: string }[] = [
    { cle: 'statut', titre: 'Protection' },
    { cle: 'domaines', titre: 'Domaine' },
    { cle: 'denominations', titre: 'Type d’édifice' },
    { cle: 'regions', titre: 'Région' },
    { cle: 'departements', titre: 'Département' },
    { cle: 'auteurs', titre: 'Architecte' }
  ];

  function poses(cle: FacetKey): number {
    const valeur = (filters as unknown as Record<string, unknown>)[cle];
    return Array.isArray(valeur) ? valeur.length : 0;
  }

  const titreOuvert = $derived(PUCES.find((p) => p.cle === ouverte)?.titre ?? '');

  // Le menu se pose sous la puce qui l'ouvre. Il vit hors de la rangee —
  // qui defile, et le rognerait — en `position: fixed`, place a l'ouverture.
  let boutons: Record<string, HTMLButtonElement> = {};
  let menu: HTMLElement | undefined = $state();
  let place = $state({ haut: 0, gauche: 0 });

  async function basculer(cle: FacetKey) {
    if (ouverte === cle) {
      fermer();
      return;
    }
    const boite = boutons[cle]?.getBoundingClientRect();
    if (boite) {
      const largeur = Math.min(360, window.innerWidth - 16);
      place = {
        haut: boite.bottom + 6,
        gauche: Math.max(8, Math.min(boite.left, window.innerWidth - largeur - 8))
      };
    }
    ouverte = cle;
    await tick();
    menu?.focus({ preventScroll: true });
  }

  async function fermer(rendreFocus = true) {
    const cle = ouverte;
    ouverte = null;
    await tick();
    if (rendreFocus && cle) boutons[cle]?.focus({ preventScroll: true });
  }

  /** `preventDefault` : l'ecouteur `Echap` global de la page ignore un
   *  evenement deja traite. */
  function clavier(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    fermer();
  }

  // Sur telephone la rangee defile et deborde : un fondu marque le bord coupe,
  // sans quoi une puce tranchee net passait pour la derniere. Au large elle
  // s'enroule (cf. la page) et ne deborde plus.
  let rangee: HTMLElement | undefined = $state();
  let debordGauche = $state(false);
  let debordDroite = $state(false);

  function mesurer() {
    const r = rangee;
    if (!r) return;
    debordGauche = r.scrollLeft > 2;
    debordDroite = r.scrollLeft + r.clientWidth < r.scrollWidth - 2;
  }

  $effect(() => {
    const r = rangee;
    if (!r) return;
    mesurer();
    // La largeur change avec la fenetre, le contenu avec chaque filtre pose :
    // les deux se surveillent.
    const taille = new ResizeObserver(mesurer);
    taille.observe(r);
    const contenu = new MutationObserver(mesurer);
    contenu.observe(r, { childList: true, subtree: true, characterData: true });
    return () => {
      taille.disconnect();
      contenu.disconnect();
    };
  });

  // Toucher ailleurs referme le menu, comme tout menu.
  $effect(() => {
    if (ouverte === null) return;
    const cle = ouverte;
    const ailleurs = (event: PointerEvent) => {
      const cible = event.target as Node;
      if (menu?.contains(cible) || boutons[cle]?.contains(cible)) return;
      fermer(false);
    };
    window.addEventListener('pointerdown', ailleurs);
    return () => window.removeEventListener('pointerdown', ailleurs);
  });
</script>

<!-- La rangee defile a l'horizontale plutot que de s'enrouler : elle garde une
     hauteur fixe, et le volet qui s'ouvre dessous ne saute pas a chaque filtre
     pose. Au large, elle s'enroule (cf. la page). -->
<div class="rangee" class:debord-gauche={debordGauche} class:debord-droite={debordDroite}
     role="group" aria-label="Filtres rapides" bind:this={rangee} onscroll={mesurer}>
  <!-- Le nom est le libelle : « Frises », l'etat dit par `aria-expanded`. La
       croix du panneau garde « Masquer les frises » ; deux boutons de meme nom
       seraient indiscernables. -->
  <button class="puce frises frappe-44-v" class:posee={frise} aria-expanded={frise}
          onclick={() => (frise = !frise)}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
         stroke-linecap="round" aria-hidden="true">
      <path d="M4 20h16M7 20v-6M11 20V8M15 20v-9M19 20v-4" />
    </svg>
    Frises
  </button>
  {#each PUCES as puce (puce.cle)}
    {@const n = poses(puce.cle)}
    <button class="puce frappe-44-v" class:posee={n > 0} aria-expanded={ouverte === puce.cle}
            aria-controls="menu-puce" bind:this={boutons[puce.cle]} onclick={() => basculer(puce.cle)}>
      {puce.titre}{#if n > 0}<em>{n}</em>{/if}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>
  {/each}
  <!-- Un critere comme un autre : la carte restreint le corpus a ce qu'elle
       montre. -->
  <button class="puce frappe-44-v" class:posee={suivreVue} aria-pressed={suivreVue}
          onclick={() => (suivreVue = !suivreVue)}>Zone visible</button>
  {@render children?.()}
</div>

{#if ouverte}
  <div class="menu-puce" id="menu-puce" role="dialog" aria-label={titreOuvert} tabindex="-1"
       bind:this={menu} onkeydown={clavier}
       style:top="{place.haut}px" style:left="{place.gauche}px">
    <div class="entete">
      <h2>{titreOuvert}</h2>
      <button class="fermer frappe-44" aria-label="Fermer {titreOuvert}" onclick={() => fermer()}>×</button>
    </div>
    <!-- Remontee a chaque puce : la section ouverte est un etat du panneau,
         et celui de la puce precedente ne vaut pas pour la suivante. -->
    {#key ouverte}
      <FacetPanel {facettes} {cardinaux} {chargement} seules={[ouverte]} />
    {/key}
  </div>
{/if}

<style>
  .rangee {
    display: flex;
    gap: 6px;
    min-width: 0;
    overflow-x: auto;
    /* Le defilement se fait au doigt ; une barre sous des
       pilules posees sur la carte serait un trait de plus sans rien dire. */
    scrollbar-width: none;
    overscroll-behavior-x: contain;
    padding: 1px 1px 2px;
  }

  .rangee::-webkit-scrollbar {
    display: none;
  }

  /* Le bord coupe se fond : une puce tranchee net passait pour la derniere. */
  .rangee.debord-droite {
    mask-image: linear-gradient(to right, black calc(100% - 44px), transparent);
  }

  .rangee.debord-gauche {
    mask-image: linear-gradient(to left, black calc(100% - 44px), transparent);
  }

  .rangee.debord-gauche.debord-droite {
    mask-image: linear-gradient(to right, transparent, black 44px, black calc(100% - 44px), transparent);
  }

  .puce {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 5px;
    height: 32px;
    padding: 0 10px 0 12px;
    border: 1px solid var(--bord-flottant);
    border-radius: var(--r-pilule);
    background: var(--fond-carte);
    color: var(--texte-moyen);
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
    transition: all var(--t-rapide);
  }

  .puce svg {
    width: 13px;
    height: 13px;
    color: var(--texte-tenu);
  }

  @media (hover: hover) and (pointer: fine) {
    .puce:hover {
      border-color: var(--bord-appuye);
      color: var(--texte);
    }
  }

  /* Une facette posee, ou la zone visible active : l'ocre des choix retenus. */
  .puce.posee {
    border-color: var(--inscrit);
    background: color-mix(in srgb, var(--inscrit) 12%, var(--fond-carte));
    color: var(--inscrit-texte);
    font-weight: 600;
  }

  .puce[aria-expanded='true'] {
    border-color: var(--inscrit);
  }

  .puce em {
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

  /* Le menu d'une facette : une surface posee, sous la puce, qui reprend la
     section du tiroir — meme recherche, memes pilules, memes comptes. */
  .menu-puce {
    position: fixed;
    z-index: 9;
    display: flex;
    flex-direction: column;
    width: min(360px, calc(100vw - 16px));
    max-height: min(60vh, 520px);
    border: 1px solid var(--bord-flottant);
    border-radius: var(--r-l);
    background: var(--fond-carte);
    box-shadow: var(--ombre-fiche);
    outline: none;
  }

  .entete {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px 0 22px;
  }

  h2 {
    margin: 0;
    font-family: var(--police-titre);
    font-size: 18px;
    font-weight: 500;
    color: var(--texte);
  }

  .fermer {
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

  @media (hover: hover) and (pointer: fine) {
    .fermer:hover {
      background: var(--fond-creux);
      color: var(--texte);
    }
  }

  .menu-puce > :global(.panneau) {
    flex: 1 1 auto;
    min-height: 0;
  }
</style>
