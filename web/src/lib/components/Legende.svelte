<script lang="ts">
  import { palette } from '$lib/state/theme.svelte';
  import { STATUTS } from '$lib/statuts';
  import { TRANCHES, type Mode } from '$lib/carte/semiologie';
  import { nf } from '$lib/format';
  import type { Compte } from '$lib/db/queries';

  interface Props {
    mode: Mode;
    densite: boolean;
    /** Couche Architecture contemporaine affichee : sa cle s'ajoute. */
    acr: boolean;
    /** La frise occupe le bas de l'ecran : sur gabarit etroit, la legende
     *  depliee revient a une bande de cles, sans titre ni gloses. */
    compacte: boolean;
    /** Definitions et effectifs depliees. Liee a la page, qui ne demande les
     *  effectifs que dans ce cas. */
    depliee: boolean;
    /** Effectif par statut, filtres courants appliques **sauf** celui du
     *  statut — comme une facette, sans quoi cocher un niveau ferait tomber
     *  les deux autres a zero. `null` tant qu'ils ne sont pas arrives. */
    comptes: Compte[] | null;
    /** Valeurs de statut cochees dans les filtres. */
    statutsActifs: string[];
    onstatut: (valeur: string) => void;
  }

  let {
    mode,
    densite,
    acr,
    compacte,
    depliee = $bindable(),
    comptes,
    statutsActifs,
    onstatut
  }: Props = $props();

  /** La legende des statuts est la seule a avoir quelque chose a expliquer :
   *  une epoque se lit d'elle-meme, une densite aussi. */
  const statut = $derived(!densite && mode === 'statut');

  const titre = $derived(
    densite ? 'Densité de monuments' : mode === 'statut' ? 'Niveau de protection' : 'Époque de construction'
  );

  function compte(valeur: string): number | null {
    return comptes?.find((c) => c.valeur === valeur)?.n ?? (comptes ? 0 : null);
  }

  /** Notices dont le statut n'est ni classe, ni inscrit, ni les deux : 448
   *  dans le corpus, typologie absente ou illisible. Dites seulement quand la
   *  selection en contient. */
  const nonPrecises = $derived(
    (comptes ?? [])
      .filter((c) => !STATUTS.some((s) => s.valeur === c.valeur))
      .reduce((total, c) => total + c.n, 0)
  );
</script>

<!-- Repliee, la legende n'est qu'une rangee de cles : elle dit les couleurs
     sans occuper la carte. Depliee a la demande (« ? »), elle titre, glose,
     definit et compte. Elle s'ouvrait seule a la premiere visite et prenait
     alors un tiers de l'ecran : c'est le geste qui la deplie, plus l'arrivee. -->
<div class="legende" class:compacte class:depliee role="group" aria-labelledby="titre-legende">
  <div class="tete">
    <!-- Le titre dit de quoi parlent les couleurs ; repliee, il reste lu par
         les lecteurs d'ecran, qui nomment le groupe avec lui. -->
    <p class="titre-legende" class:lecteur-seul={!depliee} id="titre-legende">{titre}</p>
    {#if depliee}
      <button class="reduire frappe-44" aria-expanded="true" onclick={() => (depliee = false)}>Réduire</button>
    {/if}
  </div>

  <div class="liste-cles" class:empilees={statut && depliee}>
    {#if densite}
      <!-- Sous la densite, les teintes de statut ne disent plus rien : la
           legende montre la rampe qui est effectivement a l'ecran. -->
      <span class="cle">
        <i class="rampe"
           style="background:linear-gradient(90deg,{palette.chaleur1},{palette.chaleur2},{palette.chaleur3},{palette.chaleur4})"
        ></i>
        de quelques notices à plusieurs centaines
      </span>
    {:else if statut}
      <!-- Une cle par niveau, du plus fort au plus faible. Toucher une cle
           filtre sur ce niveau : la legende sert a lire **et** a trier. Le
           texte vit dans `lib/statuts.ts`. -->
      {#each STATUTS as s (s.valeur)}
        {@const actif = statutsActifs.includes(s.valeur)}
        {@const n = compte(s.valeur)}
        <button class="cle ligne" class:actif class:eteinte={statutsActifs.length > 0 && !actif}
                aria-pressed={actif} title={depliee ? undefined : `${s.libelle} — ${s.glose}`}
                onclick={() => onstatut(s.valeur)}>
          <i style="background:{palette[s.jeton]}"></i>
          <b>{s.libelle}</b>
          {#if depliee}
            <span class="glose">{s.glose}</span>
            {#if n !== null}<span class="compte">{nf.format(n)}</span>{/if}
            <span class="definition">{s.definition}</span>
          {/if}
        </button>
      {/each}
      {#if depliee && nonPrecises > 0}
        <span class="ligne muette">
          <i style="background:{palette.statutNul}"></i>
          <b>Non précisé</b>
          <span class="glose">statut absent de la notice</span>
          <span class="compte">{nf.format(nonPrecises)}</span>
        </span>
      {/if}
    {:else}
      {#each TRANCHES as tranche (tranche.cle)}
        <span class="cle"><i style="background:{palette[tranche.cle]}"></i>{tranche.titre}</span>
      {/each}
    {/if}
    {#if acr}
      <span class="cle"><i style="background:{palette.acr}"></i>archi. contemporaine</span>
    {/if}
    {#if !depliee}
      <!-- Le seul chemin vers les definitions : un « ? » au bout des cles,
           plutot qu'un bouton libelle qui doublait la largeur de la legende. -->
      <button class="comprendre frappe-44" aria-expanded="false" aria-label="Comprendre la légende"
              title="Comprendre la légende" onclick={() => (depliee = true)}>?</button>
    {/if}
  </div>

  {#if depliee && statut}
    <p class="note">
      Les trois ensembles sont disjoints : un édifice classé et inscrit n’est compté qu’une
      fois. Toucher une ligne restreint la carte à ce niveau.
    </p>
  {/if}
</div>

<style>
  /* La legende est un element de la rangee du pied (`.pied`, dans la page) :
     elle ne se positionne pas elle-meme, la vignette des calques se range a
     sa droite. */
  .legende {
    position: relative;
    z-index: 2;
    display: flex;
    flex: 0 1 auto;
    flex-direction: column;
    gap: 7px;
    min-width: 0;
    max-width: 360px;
    max-height: calc(100dvh - 220px);
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 6px 7px 6px 12px;
    border: 1px solid var(--bord-flottant);
    border-radius: var(--r-l);
    background: color-mix(in srgb, var(--fond) 94%, transparent);
    box-shadow: var(--ombre-carte);
    /* Pas de flou au-dessus d'un canevas WebGL : il se paie a chaque image. */
    backdrop-filter: none;
    font-size: 11px;
    color: var(--texte-faible);
    /* Posee par la page quand un panneau recouvre entierement la legende. */
    visibility: var(--legende-visibilite, visible);
  }

  .legende.depliee {
    max-width: min(60vw, 400px);
    padding: 10px 14px 11px;
    font-size: 11.5px;
  }

  .tete {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .legende:not(.depliee) .tete {
    display: contents;
  }

  /* Meme voix que les intitules du panneau des calques : un titre, pas une cle. */
  .titre-legende {
    margin: 0;
    font-size: 9.5px;
    font-weight: 600;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--texte-tenu);
  }

  .lecteur-seul {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
    padding: 0;
    margin: -1px;
  }

  .reduire {
    flex: 0 0 auto;
    padding: 2px 9px;
    border: 1px solid var(--bord);
    border-radius: var(--r-pilule);
    background: transparent;
    color: var(--accent);
    font-size: 10.5px;
    font-weight: 600;
    cursor: pointer;
    transition: border-color var(--t-rapide);
  }

  .comprendre {
    flex: 0 0 auto;
    width: 20px;
    height: 20px;
    padding: 0;
    border: 1px solid var(--bord);
    border-radius: 50%;
    background: transparent;
    color: var(--texte-moyen);
    font-size: 11px;
    font-weight: 700;
    line-height: 1;
    cursor: pointer;
    transition:
      border-color var(--t-rapide),
      color var(--t-rapide);
  }

  @media (hover: hover) and (pointer: fine) {
    .reduire:hover,
    .comprendre:hover {
      border-color: var(--accent);
      color: var(--accent);
    }
  }

  .liste-cles {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 12px;
  }

  /* Depliee, les niveaux de protection se lisent en colonne, du plus fort au
     plus faible : a plat, la hierarchie ne se voyait pas. */
  .liste-cles.empilees {
    flex-direction: column;
    flex-wrap: nowrap;
    align-items: stretch;
    gap: 2px;
  }

  .cle {
    display: flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }

  .cle i,
  .ligne i {
    flex: 0 0 auto;
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

  /* Une cle de statut est un bouton : elle filtre. Elle garde pourtant
     l'allure d'une cle de lecture — pas de pilule, pas de cadre — sans quoi
     la legende ressemblerait a une seconde rangee de filtres. */
  .ligne {
    margin: 0 -4px;
    padding: 2px 4px;
    border: none;
    border-radius: var(--r-s);
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
    transition:
      background var(--t-rapide),
      opacity var(--t-rapide);
  }

  .empilees .ligne {
    display: grid;
    grid-template-columns: 9px auto 1fr auto;
    align-items: center;
    column-gap: 6px;
    margin: 0 -6px;
    padding: 3px 6px;
  }

  @media (hover: hover) and (pointer: fine) {
    .ligne:not(.muette):hover {
      background: var(--fond-creux);
    }
  }

  .ligne.actif {
    background: var(--accent-doux);
  }

  /* Un niveau filtre, les autres reculent : la carte ne montre plus qu'eux. */
  .ligne.eteinte {
    opacity: 0.5;
  }

  .ligne.muette {
    cursor: default;
  }

  .ligne b {
    font-weight: 600;
    color: var(--texte);
  }

  .glose {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .compte {
    color: var(--texte-moyen);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .definition {
    grid-column: 2 / -1;
    margin: 2px 0 5px;
    white-space: normal;
    line-height: 1.45;
    color: var(--texte-moyen);
  }

  .note {
    margin: 2px 0 0;
    padding-top: 7px;
    border-top: 1px solid var(--bord);
    line-height: 1.45;
    font-size: 10.5px;
  }

  @media (max-width: 900px) {
    .legende,
    .legende.depliee {
      max-width: none;
      border-radius: var(--r-m);
      font-size: 10.5px;
    }

    /* Legende depliee et frise ouvertes ensemble ne laissaient qu'un quart de
       la hauteur a la carte : la legende garde ses cles — une carte sans
       legende ne se lit pas — et abandonne le reste. */
    .legende.compacte .glose,
    .legende.compacte .definition,
    .legende.compacte .compte,
    .legende.compacte .note {
      display: none;
    }
  }
</style>
