<script lang="ts">
  import { untrack } from 'svelte';
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
     *  revient a une bande de cles, sans titre ni gloses. */
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

  // Premiere visite sur un ecran large : la legende s'ouvre une fois, depliee,
  // puis se replie aux visites suivantes. C'est le moment ou l'on decouvre ce
  // que « classe » et « inscrit » veulent dire ; ensuite, la glose suffit. Sur
  // telephone elle ne s'impose pas : depliee, elle prendrait la moitie de la
  // carte. Preference de lecture, donc `localStorage`, jamais l'URL.
  const CLE = 'merimee-legende-vue';

  $effect(() => {
    untrack(() => {
      try {
        if (!localStorage.getItem(CLE) && window.matchMedia('(min-width: 901px)').matches) depliee = true;
        localStorage.setItem(CLE, '1');
      } catch {
        // Stockage refuse : la legende reste repliee, la glose dit l'essentiel.
      }
    });
  });
</script>

<div class="legende" class:compacte class:depliee={depliee && statut}>
  <div class="tete">
    <!-- Le titre dit de quoi parlent les couleurs. Sans lui, « classé » et
         « inscrit » etaient trois mots de metier poses sur la carte : rien ne
         disait que ce sont des niveaux de protection. -->
    <p class="titre-legende">{titre}</p>
    {#if statut}
      <button class="comprendre frappe-44" aria-expanded={depliee} onclick={() => (depliee = !depliee)}>
        {depliee ? 'Réduire' : 'Comprendre'}
      </button>
    {/if}
  </div>

  <div class="liste-cles" class:empilees={statut}>
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
      <!-- Une ligne par niveau, du plus fort au plus faible, chacune avec sa
           glose. Toucher une ligne filtre sur ce niveau : la legende sert a
           lire **et** a trier, comme les cles d'une carte qu'on pointe du
           doigt. Le texte vit dans `lib/statuts.ts`. -->
      {#each STATUTS as s (s.valeur)}
        {@const actif = statutsActifs.includes(s.valeur)}
        {@const n = compte(s.valeur)}
        <button class="cle ligne" class:actif class:eteinte={statutsActifs.length > 0 && !actif}
                aria-pressed={actif} onclick={() => onstatut(s.valeur)}>
          <i style="background:{palette[s.jeton]}"></i>
          <b>{s.libelle}</b>
          <span class="glose">{s.glose}</span>
          {#if depliee && n !== null}<span class="compte">{nf.format(n)}</span>{/if}
          {#if depliee}<span class="definition">{s.definition}</span>{/if}
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
  </div>

  {#if depliee && statut}
    <p class="note">
      Les trois ensembles sont disjoints : un édifice classé et inscrit n’est compté qu’une
      fois. Toucher une ligne restreint la carte à ce niveau.
    </p>
  {/if}
</div>

<style>
  /* `--marge-gauche` est posee par la page : la largeur du tiroir des filtres
     quand il est pose a cote de la carte. La legende ne connait pas ce
     tiroir, elle lit une variable heritee. Elle se range a droite de la
     vignette des calques, qui tient le coin. */
  .legende {
    position: absolute;
    left: calc(var(--marge-gauche, 0px) + 12px + var(--empreinte-calques) + 10px);
    bottom: 12px;
    z-index: 2;
    display: flex;
    flex-direction: column;
    gap: 7px;
    max-width: min(46vw, 360px);
    max-height: calc(100% - 140px);
    overflow-y: auto;
    overscroll-behavior: contain;
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
    /* Posee par la page quand un panneau recouvre entierement la legende. */
    visibility: var(--legende-visibilite, visible);
    --empreinte-calques: 72px;
  }

  .legende.depliee {
    max-width: min(60vw, 400px);
  }

  .tete {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
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

  .comprendre {
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

  @media (hover: hover) and (pointer: fine) {
    .comprendre:hover {
      border-color: var(--accent);
    }
  }

  .liste-cles {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 14px;
  }

  /* Les niveaux de protection se lisent en colonne, du plus fort au plus
     faible : a plat, la hierarchie ne se voyait pas. */
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

  /* Une ligne de statut est un bouton : elle filtre. Elle garde pourtant
     l'allure d'une cle de lecture — pas de pilule, pas de cadre — sans quoi
     la legende ressemblerait a un second tiroir de filtres. */
  .ligne {
    display: grid;
    grid-template-columns: 9px auto 1fr auto;
    align-items: center;
    column-gap: 6px;
    margin: 0 -6px;
    padding: 3px 6px;
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

  /* Sous 900 px la legende prend la largeur qui reste a cote de la vignette,
     et remonte au-dessus de l'attribution. */
  @media (max-width: 900px) {
    .legende,
    .legende.depliee {
      left: calc(8px + var(--empreinte-calques) + 8px);
      right: 8px;
      bottom: 36px;
      max-width: none;
      border-radius: var(--r-m);
      font-size: 10.5px;
      --empreinte-calques: 56px;
    }

    /* Legende et frise ouvertes ensemble ne laissaient qu'un quart de la
       hauteur a la carte : la legende garde ses cles — une carte sans legende
       ne se lit pas — et abandonne le reste, qui revient avec la carte. */
    .legende.compacte .tete,
    .legende.compacte .glose,
    .legende.compacte .definition,
    .legende.compacte .compte,
    .legende.compacte .note {
      display: none;
    }

    .legende.compacte .liste-cles.empilees {
      flex-direction: row;
      flex-wrap: wrap;
      gap: 4px 12px;
    }
  }
</style>
