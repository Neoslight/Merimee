<script lang="ts">
  import * as Plot from '@observablehq/plot';
  import type { Cellule } from '$lib/db/queries';
  import { compact, nf, romain } from '$lib/format';
  import { palette } from '$lib/state/theme.svelte';

  interface Props {
    cellules: Cellule[];
    ecartees: number;
    siecleSelection: number[];
    plage: [number, number] | null;
    oncellule: (siecle: number, decennie: number) => void;
  }

  let { cellules, ecartees, siecleSelection, plage, oncellule }: Props = $props();

  let boite: HTMLDivElement;
  let largeur = $state(900);
  let hauteur = $state(460);

  $effect(() => {
    const observateur = new ResizeObserver(([entree]) => {
      largeur = Math.max(420, entree.contentRect.width);
      hauteur = Math.max(280, entree.contentRect.height);
    });
    observateur.observe(boite);
    return () => observateur.disconnect();
  });

  // Une cellule deja retenue par les filtres courants : elle est cerclee plutot
  // que recoloriee, pour ne pas mentir sur son effectif.
  function retenue(c: Cellule): boolean {
    const parSiecle = siecleSelection.length === 0 || siecleSelection.includes(c.siecle);
    const parAnnee = !plage || (c.decennie + 9 >= plage[0] && c.decennie <= plage[1]);
    return parSiecle && parAnnee && (siecleSelection.length > 0 || plage !== null);
  }

  $effect(() => {
    const donnees = cellules;
    const graphe = Plot.plot({
      width: largeur,
      height: hauteur,
      marginLeft: 44,
      marginRight: 12,
      marginTop: 26,
      marginBottom: 34,
      style: { background: 'transparent', color: 'var(--texte-faible)', fontSize: '10px' },
      x: { label: 'décennie de protection →', labelAnchor: 'left', tickFormat: 'd', tickRotate: -40 },
      y: { label: '↑ siècle de construction', tickFormat: (d: number) => romain(d) },
      // Racine carree : sans elle les 1 839 notices du couple 16e/1920 ecrasent
      // tout le reste de la matrice dans une seule teinte.
      //
      // La rampe s'inverse avec le theme : en sombre l'effectif fort est clair,
      // en clair il est sombre. Sans cela la matrice disparaitrait dans son
      // propre fond.
      color: {
        type: 'sqrt',
        range: [
          palette.matrice0, palette.matrice1, palette.matrice2,
          palette.matrice3, palette.matrice4
        ],
        label: 'notices'
      },
      marks: [
        Plot.cell(donnees, {
          x: 'decennie',
          y: 'siecle',
          fill: 'n',
          inset: 0.5,
          title: (d: Cellule) =>
            `${romain(d.siecle)}e siècle protégé dans les années ${d.decennie}\n${nf.format(d.n)} notices`
        }),
        Plot.cell(donnees.filter(retenue), {
          x: 'decennie',
          y: 'siecle',
          fill: 'none',
          stroke: palette.matriceCerclee,
          strokeWidth: 1.2,
          inset: 0.5
        }),
        Plot.text(
          donnees.filter((d) => d.n >= 900),
          { x: 'decennie', y: 'siecle', text: (d: Cellule) => compact.format(d.n), fill: palette.matriceTexte, fontSize: 9 }
        )
      ]
    });

    // Meme piege que la frise : `graphe.value` reste nul sur une marque non
    // interactive. La cellule se retrouve par les deux echelles a bandes.
    const ex = graphe.scale('x');
    const ey = graphe.scale('y');
    graphe.addEventListener('click', (event) => {
      if (!ex?.apply || !ey?.apply) return;
      const cadre = graphe.getBoundingClientRect();
      const x = (event as MouseEvent).clientX - cadre.left;
      const y = (event as MouseEvent).clientY - cadre.top;
      const cible = donnees.find((d) => {
        const gx = ex.apply(d.decennie) as number;
        const gy = ey.apply(d.siecle) as number;
        return (
          x >= gx && x <= gx + (ex.bandwidth ?? 0) && y >= gy && y <= gy + (ey.bandwidth ?? 0)
        );
      });
      if (cible) oncellule(cible.siecle, cible.decennie);
    });

    boite.replaceChildren(graphe);
    return () => graphe.remove();
  });
</script>

<div class="matrice">
  <header>
    <h3>Ce qui a été protégé, et quand</h3>
    <p>
      Chaque cellule croise une époque de construction et la décennie de l'arrêté.
      Cliquer pose les deux filtres.
    </p>
  </header>

  <div class="graphe" bind:this={boite}></div>

  {#if ecartees > 0}
    <!-- Ecarter sans le dire serait un mensonge par omission : les siecles
         anterieurs existent, ils sont simplement trop rares pour l'axe. -->
    <p class="note">
      {nf.format(ecartees)} croisement{ecartees > 1 ? 's' : ''} antérieur{ecartees > 1 ? 's' : ''}
      au X<sup>e</sup> siècle ne {ecartees > 1 ? 'sont' : 'est'} pas représenté{ecartees > 1 ? 's' : ''} ici.
    </p>
  {/if}
</div>

<style>
  .matrice {
    position: absolute;
    inset: 0;
    /* Au-dessus des controles MapLibre (z-index 2) : la carte reste montee. */
    z-index: 3;
    display: grid;
    grid-template-rows: auto 1fr auto;
    padding: 14px 18px 10px;
    background: var(--fond);
    overflow: hidden;
  }

  header {
    margin-bottom: 6px;
  }

  h3 {
    margin: 0;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--texte);
  }

  header p {
    margin: 3px 0 0;
    font-size: 11px;
    color: var(--texte-faible);
  }

  .graphe {
    min-height: 0;
    cursor: pointer;
  }

  .note {
    margin: 4px 0 0;
    font-size: 10px;
    color: var(--texte-faible);
  }
</style>
