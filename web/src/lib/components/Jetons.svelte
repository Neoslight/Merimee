<script lang="ts">
  import type { Jeton } from '$lib/state/filters.svelte';

  interface Props {
    jetons: Jeton[];
    /** Compte de `countActive` : une cle, pas une valeur. Le libelle du bouton
     *  de remise a zero est celui d'avant, au caractere pres. */
    actifs: number;
    onretirer: (jeton: Jeton) => void;
    onreset: () => void;
  }

  let { jetons, actifs, onretirer, onreset }: Props = $props();

  function cle(jeton: Jeton): string {
    return `${jeton.cle}:${jeton.valeur ?? ''}`;
  }
</script>

<div class="jetons">
  {#each jetons as jeton (cle(jeton))}
    <!-- Le nom accessible porte l'action, pas la seule valeur : sans cela une
         puce « architecture militaire » et l'option de meme nom dans le panneau
         de facettes deviennent deux boutons indiscernables. -->
    <button aria-label="Retirer le filtre {jeton.libelle}" onclick={() => onretirer(jeton)}>
      <span>{jeton.libelle}</span>
      <i aria-hidden="true">×</i>
    </button>
  {/each}
  <button class="raz" onclick={onreset}>
    effacer {actifs} filtre{actifs > 1 ? 's' : ''}
  </button>
</div>

<style>
  .jetons {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 7px 16px;
    border-bottom: 1px solid var(--bord);
    background: var(--fond);
  }

  button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 260px;
    padding: 3px 6px 3px 10px;
    border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--bord));
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--accent);
    font-size: 11px;
    cursor: pointer;
  }

  button span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  button i {
    font-style: normal;
    font-size: 13px;
    line-height: 1;
    opacity: 0.7;
  }

  button:hover {
    background: color-mix(in srgb, var(--accent) 22%, transparent);
  }

  button:hover i {
    opacity: 1;
  }

  /* La remise a zero n'est pas un critere : elle se distingue des puces. */
  .raz {
    padding: 3px 10px;
    border-color: var(--bord);
    background: transparent;
    color: var(--texte-faible);
  }

  .raz:hover {
    background: var(--fond-creux);
    color: var(--texte);
  }
</style>
