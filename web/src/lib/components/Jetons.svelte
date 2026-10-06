<script lang="ts">
  import type { Jeton } from '$lib/state/filters.svelte';

  interface Props {
    jetons: Jeton[];
    onretirer: (jeton: Jeton) => void;
  }

  /* La remise a zero n'est plus ici : en bout de rangee, elle partait hors
     champ des que trois filtres etaient poses. Elle vit a cote du bouton
     « Filtres » (`.raz`, dans la page). */
  let { jetons, onretirer }: Props = $props();

  function cle(jeton: Jeton): string {
    return `${jeton.cle}:${jeton.valeur ?? ''}`;
  }
</script>

<div class="jetons">
  {#each jetons as jeton (cle(jeton))}
    <!-- Le nom accessible porte l'action, pas la seule valeur : sans cela une
         puce « architecture militaire » et l'option de meme nom dans le panneau
         de facettes deviennent deux boutons indiscernables. -->
    <button class="frappe-44-v" aria-label="Retirer le filtre {jeton.libelle}" onclick={() => onretirer(jeton)}>
      <span>{jeton.libelle}</span>
      <i aria-hidden="true">×</i>
    </button>
  {/each}
</div>

<style>
  /* Les filtres poses suivent les puces de facette dans la meme rangee, qui
     defile : ils ne s'enroulent pas. Poses sur la carte, ils ont un fond
     plein — une teinte translucide prendrait la couleur du sol. */
  .jetons {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 6px;
  }

  button {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 9px;
    max-width: 260px;
    height: 32px;
    padding: 0 9px 0 13px;
    border: 1px solid color-mix(in srgb, var(--inscrit) 45%, var(--fond-carte));
    border-radius: var(--r-pilule);
    background: color-mix(in srgb, var(--inscrit) 11%, var(--fond-carte));
    color: var(--inscrit-texte);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all var(--t-rapide);
  }

  button span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* La croix est un glyphe fin dessine en CSS, pas un « x » typographique
     epais : deux filets croises sur le caractere, masque par `font-size: 0`. */
  button i {
    display: block;
    width: 10px;
    height: 10px;
    font-size: 0;
    background:
      linear-gradient(currentColor, currentColor) no-repeat center / 11px 1.3px,
      linear-gradient(currentColor, currentColor) no-repeat center / 1.3px 11px;
    transform: rotate(45deg);
    opacity: 0.7;
    transition: opacity var(--t-rapide);
  }

  @media (hover: hover) and (pointer: fine) {
    button:hover {
      background: color-mix(in srgb, var(--inscrit) 20%, var(--fond-carte));
    }

    button:hover i {
      opacity: 1;
    }
  }
</style>
