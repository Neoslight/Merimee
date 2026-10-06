<script lang="ts">
  import { tick } from 'svelte';
  import { base } from '$app/paths';
  import { palette, theme } from '$lib/state/theme.svelte';
  import { SUPERPOSITIONS, type Superposition } from '$lib/carte/fonds';
  import { TRANCHES, type Mode } from '$lib/carte/semiologie';
  import { nf } from '$lib/format';

  interface Props {
    /** Panneau deplie. Lie a la page : `Echap` global et la feuille de fiche
     *  sur telephone le referment aussi. */
    ouvert: boolean;
    fond: Superposition | null;
    opacite: number;
    mode: Mode;
    densite: boolean;
    acr: boolean;
    /** Notices de la couche ACR situees, une fois son nuage charge. */
    nbAcr: number | null;
  }

  let {
    ouvert = $bindable(),
    fond = $bindable(),
    opacite = $bindable(),
    mode = $bindable(),
    densite = $bindable(),
    acr = $bindable(),
    nbAcr
  }: Props = $props();

  /** Vignettes statiques, produites par `scripts/vignettes-calques.mjs` : un
   *  apercu de chaque fond sans qu'aucun octet IGN ne parte avant qu'on l'ait
   *  choisi. Le plan suit le theme. */
  const vignette = (nom: string) => `${base}/calques/${nom}.jpg`;
  const vignettePlan = $derived(vignette(theme.courant === 'clair' ? 'plan-clair' : 'plan-sombre'));

  /** La vignette du coin propose **l'autre** fond, a la maniere des cartes
   *  en ligne : Cassini sur le plan — la fonction la plus singuliere du site,
   *  qui restait cachee derriere une pastille de 31 px — et le plan des qu'un
   *  fond est pose, pour dire par ou l'on revient. */
  const apercuCoin = $derived(fond ? vignettePlan : vignette('cassini'));

  /** Densite et fond superpose repondent a deux questions incompatibles :
   *  l'une agrege, l'autre situe. Choisir l'un eteint l'autre. */
  function choisirFond(cle: Superposition | null) {
    if (cle === fond) return;
    fond = cle;
    const choisi = SUPERPOSITIONS.find((s) => s.cle === cle);
    // Chaque fond arrive a son dosage : une photo se lit pleine, une carte
    // ancienne laisse transparaitre le plan qu'elle recouvre.
    if (choisi) {
      opacite = choisi.opacite;
      densite = false;
    }
  }

  function choisirPoints(choix: Mode | 'densite') {
    if (choix === 'densite') {
      densite = !densite;
      if (densite) fond = null;
      return;
    }
    mode = choix;
    densite = false;
  }

  let boutonCoin: HTMLButtonElement | undefined = $state();
  let titre: HTMLElement | undefined = $state();
  let panneau: HTMLElement | undefined = $state();

  async function ouvrir() {
    ouvert = true;
    await tick();
    titre?.focus({ preventScroll: true });
  }

  async function fermer(rendreFocus = true) {
    ouvert = false;
    await tick();
    if (rendreFocus) boutonCoin?.focus({ preventScroll: true });
  }

  /** `preventDefault` : l'ecouteur `Echap` global de la page ignore un
   *  evenement deja traite — sans lui, il fermerait aussi la fiche derriere. */
  function clavier(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    fermer();
  }

  // Toucher la carte a cote referme le panneau, comme un menu. Pas de voile :
  // le geste doit aussi atteindre la carte qu'on touche.
  $effect(() => {
    if (!ouvert) return;
    const ailleurs = (event: PointerEvent) => {
      const cible = event.target as Node;
      if (panneau?.contains(cible) || boutonCoin?.contains(cible)) return;
      fermer(false);
    };
    window.addEventListener('pointerdown', ailleurs);
    return () => window.removeEventListener('pointerdown', ailleurs);
  });
</script>

<!-- La vignette se range au pied, a droite de la legende : un apercu, pas une
     icone. Elle ouvre le panneau plutot que de basculer d'emblee — il y a
     quatre fonds, pas deux. -->
<button class="coin" class:actif={fond !== null} aria-expanded={ouvert}
        aria-controls="panneau-calques" bind:this={boutonCoin}
        onclick={() => (ouvert ? fermer() : ouvrir())}>
  <img src={apercuCoin} alt="" />
  <span>Calques</span>
</button>

{#if ouvert}
  <div class="panneau-calques" id="panneau-calques" role="dialog" aria-labelledby="titre-calques"
       bind:this={panneau} onkeydown={clavier} tabindex="-1">
    <div class="entete">
      <h2 id="titre-calques" tabindex="-1" bind:this={titre}>Calques</h2>
      <button class="fermer frappe-44" aria-label="Fermer les calques" onclick={() => fermer()}>×</button>
    </div>

    <section aria-labelledby="calques-fond">
      <h3 id="calques-fond">Fond de carte</h3>
      <div class="tuiles">
        <button class="tuile" aria-pressed={fond === null} onclick={() => choisirFond(null)}>
          <img src={vignettePlan} alt="" />
          <span class="nom">Plan</span>
        </button>
        {#each SUPERPOSITIONS as s (s.cle)}
          <button class="tuile" aria-pressed={fond === s.cle} onclick={() => choisirFond(s.cle)}
                  title="{s.titre} ({s.epoque}) — {s.poids}">
            <img src={vignette(s.cle)} alt="" />
            <span class="nom">{s.titre}</span>
            <!-- La periode dit ce que la superposition apporte ; un `title`
                 ne se lit pas au tactile. -->
            <span class="epoque">{s.epoque}</span>
          </button>
        {/each}
      </div>
      {#if fond}
        <!-- Le curseur natif apporte le clavier et le tactile sans rien ecrire. -->
        <label class="dosage">
          <span>Opacité</span>
          <output>{opacite} %</output>
          <input type="range" min="0" max="100" step="5" bind:value={opacite}
                 aria-label="Opacité du fond historique" />
        </label>
      {/if}
    </section>

    <section aria-labelledby="calques-points">
      <h3 id="calques-points">Colorer les points</h3>
      <div class="tuiles">
        <!-- Les apercus sont dessines en CSS avec les teintes de la palette :
             ils suivent le theme sans image a produire. -->
        <button class="tuile mode" aria-pressed={!densite && mode === 'statut'}
                onclick={() => choisirPoints('statut')}>
          <span class="nuancier">
            <i style="background:{palette.classe}; left:22%; top:30%"></i>
            <i style="background:{palette.inscrit}; left:58%; top:24%"></i>
            <i style="background:{palette.inscrit}; left:40%; top:58%"></i>
            <i style="background:{palette.mixte}; left:68%; top:62%"></i>
          </span>
          <span class="nom">Statut</span>
        </button>
        <button class="tuile mode" aria-pressed={!densite && mode === 'epoque'}
                onclick={() => choisirPoints('epoque')}>
          <span class="nuancier">
            {#each TRANCHES as t, i (t.cle)}
              <i style="background:{palette[t.cle]}; left:{14 + i * 16}%; top:{i % 2 ? 58 : 30}%"></i>
            {/each}
          </span>
          <span class="nom">Époque</span>
        </button>
        <button class="tuile mode" aria-pressed={densite} onclick={() => choisirPoints('densite')}>
          <span class="nuancier"
                style="background:radial-gradient(circle at 42% 46%, {palette.chaleur4}, {palette.chaleur3} 18%, {palette.chaleur2} 34%, {palette.chaleur1} 52%, transparent 72%), radial-gradient(circle at 74% 70%, {palette.chaleur2}, transparent 30%), {palette.carteTerre}"></span>
          <span class="nom">Densité</span>
        </button>
      </div>
    </section>

    <section aria-labelledby="calques-plus">
      <h3 id="calques-plus">En plus</h3>
      <!-- Un corpus en plus, pas un reglage de lecture : aucun filtre ne s'y
           applique, les compteurs ne le voient pas. -->
      <button class="tuile large" aria-pressed={acr} onclick={() => (acr = !acr)}>
        <span class="nuancier">
          <i style="background:{palette.acr}; left:30%; top:34%"></i>
          <i style="background:{palette.acr}; left:58%; top:56%"></i>
        </span>
        <span class="texte">
          <span class="nom">Architecture contemporaine remarquable</span>
          <span class="epoque">
            {nbAcr !== null ? `${nf.format(nbAcr)} édifices labellisés` : 'label du ministère'} · hors filtres
          </span>
        </span>
      </button>
    </section>

    <p class="credits">Vignettes : © CARTO, © OpenStreetMap, IGN, BnF.</p>
  </div>
{/if}

<style>
  /* La vignette, element de la rangee du pied (`.pied`, dans la page), apres
     la legende. */
  .coin {
    position: relative;
    flex: 0 0 auto;
    z-index: 3;
    width: 72px;
    height: 72px;
    padding: 0;
    overflow: hidden;
    border: 2px solid var(--fond-carte);
    border-radius: var(--r-m);
    background: var(--carte-terre);
    box-shadow: var(--ombre-carte);
    cursor: pointer;
    transition: border-color var(--t-rapide);
    /* Recouverte par la feuille de fiche sur telephone, comme la legende. */
    visibility: var(--legende-visibilite, visible);
  }

  .coin img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /* Le libelle se lit sur l'image : un degrade sombre sous un texte clair,
     dans les deux themes — c'est l'image qui fait le fond, pas le theme. */
  .coin span {
    position: absolute;
    inset: auto 0 0;
    padding: 14px 4px 4px;
    background: linear-gradient(transparent, var(--voile-image));
    color: var(--texte-sur-image);
    font-size: 10.5px;
    font-weight: 600;
    text-align: center;
  }

  /* Un fond est pose : le filet ocre le dit, sinon une carte ancienne
     resterait a l'ecran sans rien qui signale d'ou elle vient. */
  .coin.actif,
  .coin[aria-expanded='true'] {
    border-color: var(--inscrit);
  }

  /* Pose au-dessus de la rangee du pied, depuis son bord gauche. */
  .panneau-calques {
    position: absolute;
    left: 0;
    bottom: calc(100% + 10px);
    z-index: 5;
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 340px;
    max-height: calc(100dvh - 200px);
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 12px 14px 10px;
    border: 1px solid var(--bord-flottant);
    border-radius: var(--r-l);
    background: var(--fond-carte);
    box-shadow: var(--ombre-carte);
    outline: none;
  }

  .entete {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .entete h2 {
    margin: 0;
    font-family: var(--police-titre);
    font-size: 19px;
    font-weight: 500;
    color: var(--texte);
    outline: none;
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

  section {
    display: grid;
    gap: 7px;
  }

  h3 {
    margin: 0;
    font-size: 9.5px;
    font-weight: 600;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--texte-tenu);
  }

  .tuiles {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
  }

  /* Une tuile : l'apercu, son nom dessous. L'etat choisi est un filet ocre
     autour de l'apercu, comme la vignette du coin. */
  .tuile {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 3px;
    min-width: 0;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--texte-moyen);
    text-align: center;
    cursor: pointer;
  }

  .tuile img,
  .nuancier {
    position: relative;
    display: block;
    width: 100%;
    aspect-ratio: 1;
    object-fit: cover;
    border: 2px solid var(--bord);
    border-radius: var(--r-m);
    background: var(--carte-terre);
    transition: border-color var(--t-rapide);
  }

  .nuancier i {
    position: absolute;
    width: 11px;
    height: 11px;
    border-radius: 50%;
    border: 1.5px solid var(--carte-liseret);
  }

  @media (hover: hover) and (pointer: fine) {
    .tuile:hover img,
    .tuile:hover .nuancier {
      border-color: var(--bord-appuye);
    }
  }

  .tuile[aria-pressed='true'] img,
  .tuile[aria-pressed='true'] .nuancier {
    border-color: var(--inscrit);
  }

  .tuile[aria-pressed='true'] .nom {
    color: var(--inscrit-texte);
    font-weight: 600;
  }

  .nom {
    overflow: hidden;
    font-size: 11px;
    line-height: 1.25;
    text-overflow: ellipsis;
  }

  .epoque {
    font-size: 9.5px;
    line-height: 1.2;
    color: var(--texte-tenu);
  }

  /* La couche ACR tient une rangee : son nom est long, et c'est un corpus en
     plus, pas un fond parmi d'autres. */
  .tuile.large {
    flex-direction: row;
    align-items: center;
    gap: 10px;
    text-align: left;
  }

  .tuile.large .nuancier {
    flex: 0 0 54px;
    width: 54px;
  }

  .tuile.large .texte {
    display: grid;
    gap: 2px;
  }

  .tuile.large .nom {
    white-space: normal;
  }

  .dosage {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 3px 6px;
    font-size: 10.5px;
    color: var(--texte-faible);
  }

  .dosage input {
    grid-column: 1 / -1;
    width: 100%;
    margin: 0;
    accent-color: var(--inscrit);
    cursor: pointer;
  }

  /* Chiffres tabulaires : sans eux, passer de « 5 % » a « 100 % » decale le
     libelle a chaque cran du curseur. */
  .dosage output {
    font-variant-numeric: tabular-nums;
    color: var(--texte-moyen);
  }

  .credits {
    margin: 0;
    font-size: 9.5px;
    color: var(--texte-tenu);
  }

  @media (max-width: 900px) {
    .coin {
      width: 56px;
      height: 56px;
    }

    .coin span {
      padding-top: 10px;
      font-size: 9.5px;
    }
  }

  /* Sur telephone le panneau est une feuille basse, pleine largeur : quatre
     tuiles de 72 px n'y tiendraient pas autrement. `fixed` : la rangee du pied
     n'a pas la largeur de l'ecran. */
  @media (max-width: 768px) {
    /* Au-dessus de la feuille du volet, repliee au pied de l'ecran. */
    .panneau-calques {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 8;
      width: auto;
      max-height: 78%;
      padding-bottom: calc(12px + var(--sa-bas));
      border-radius: var(--r-l) var(--r-l) 0 0;
    }
  }
</style>
