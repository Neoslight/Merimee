<script lang="ts">
  import type { Compte } from '$lib/db/queries';
  import { filters, toggle, type FacetKey } from '$lib/state/filters.svelte';

  interface Props {
    facettes: Partial<Record<FacetKey, Compte[]>>;
    chargement: boolean;
  }

  let { facettes, chargement }: Props = $props();

  type Descripteur = { cle: FacetKey; titre: string; replie?: boolean; filtrable?: boolean };

  const SECTIONS: Descripteur[] = [
    { cle: 'statut', titre: 'Statut de protection' },
    { cle: 'domaines', titre: 'Domaine' },
    { cle: 'denominations', titre: 'Dénomination', filtrable: true },
    { cle: 'regions', titre: 'Région', replie: true },
    { cle: 'departements', titre: 'Département', replie: true, filtrable: true },
    { cle: 'auteurs', titre: 'Architecte / auteur', replie: true, filtrable: true },
    { cle: 'proprietaires', titre: 'Propriété', replie: true },
    { cle: 'periodes', titre: 'Période non datée', replie: true }
  ];

  // Les cles de facette et les cles de filtre coincident sauf pour les deux
  // colonnes scalaires, dont le libelle affiche differe de la valeur stockee.
  const CIBLES: Record<string, 'statut' | 'domaines' | 'denominations' | 'auteurs' | 'regions' | 'departements' | 'proprietaires' | 'periodes'> = {
    statut: 'statut',
    domaines: 'domaines',
    denominations: 'denominations',
    regions: 'regions',
    departements: 'departements',
    auteurs: 'auteurs',
    proprietaires: 'proprietaires',
    periodes: 'periodes'
  };

  let ouvertes = $state(new Set(SECTIONS.filter((s) => !s.replie).map((s) => s.cle)));
  let recherches = $state<Record<string, string>>({});

  function basculerSection(cle: FacetKey) {
    const suivant = new Set(ouvertes);
    if (suivant.has(cle)) suivant.delete(cle);
    else suivant.add(cle);
    ouvertes = suivant;
  }

  function selection(cle: FacetKey): string[] {
    return (filters[CIBLES[cle]] as string[]) ?? [];
  }

  function visibles(cle: FacetKey): Compte[] {
    const items = facettes[cle] ?? [];
    const terme = (recherches[cle] ?? '').trim().toLowerCase();
    if (!terme) return items;
    return items.filter((item) => item.valeur.toLowerCase().includes(terme));
  }

  const nf = new Intl.NumberFormat('fr-FR');
</script>

<aside class="panneau" class:occupe={chargement}>
  {#each SECTIONS as section (section.cle)}
    {@const actives = selection(section.cle)}
    <section>
      <button class="titre" onclick={() => basculerSection(section.cle)}>
        <span class="chevron" class:ouvert={ouvertes.has(section.cle)}>›</span>
        {section.titre}
        {#if actives.length}<em>{actives.length}</em>{/if}
      </button>

      {#if ouvertes.has(section.cle)}
        {#if section.filtrable}
          <input
            class="filtre"
            type="search"
            placeholder="filtrer…"
            bind:value={recherches[section.cle]}
          />
        {/if}
        <ul>
          {#each visibles(section.cle) as item (item.valeur)}
            <li>
              <button
                class="option"
                class:choisi={actives.includes(item.valeur)}
                onclick={() => toggle(CIBLES[section.cle], item.valeur)}
              >
                <span class="etiquette">{item.valeur}</span>
                <span class="compte">{nf.format(item.n)}</span>
              </button>
            </li>
          {:else}
            <li class="vide">aucune valeur</li>
          {/each}
        </ul>
      {/if}
    </section>
  {/each}

  <section class="palissy">
    <label for="palissy">
      Mobilier Palissy associé
      <em>{filters.nbPalissy > 0 ? `≥ ${filters.nbPalissy}` : 'tous'}</em>
    </label>
    <input
      id="palissy"
      type="range"
      min="0"
      max="500"
      step="10"
      bind:value={filters.nbPalissy}
    />
    <p>Isoler les édifices qui abritent un grand nombre d'objets classés.</p>
  </section>
</aside>

<style>
  .panneau {
    overflow-y: auto;
    border-right: 1px solid var(--bord);
    background: var(--fond);
    padding-bottom: 24px;
    transition: opacity 120ms;
  }

  .panneau.occupe {
    opacity: 0.55;
  }

  section {
    border-bottom: 1px solid var(--bord);
  }

  .titre {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    padding: 11px 14px;
    background: none;
    border: none;
    color: var(--texte);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    text-align: left;
    cursor: pointer;
  }

  .titre em {
    margin-left: auto;
    font-style: normal;
    font-size: 10px;
    color: var(--fond);
    background: var(--accent);
    border-radius: 999px;
    padding: 1px 6px;
  }

  .chevron {
    display: inline-block;
    transition: transform 120ms;
    color: var(--texte-faible);
  }

  .chevron.ouvert {
    transform: rotate(90deg);
  }

  .filtre {
    width: calc(100% - 28px);
    margin: 0 14px 8px;
    padding: 5px 8px;
    background: var(--fond-creux);
    border: 1px solid var(--bord);
    border-radius: 5px;
    color: var(--texte);
    font-size: 12px;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0 6px 10px;
    max-height: 260px;
    overflow-y: auto;
  }

  .option {
    display: flex;
    align-items: baseline;
    gap: 10px;
    width: 100%;
    padding: 4px 8px;
    background: none;
    border: none;
    border-radius: 4px;
    color: var(--texte-faible);
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }

  .option:hover {
    background: var(--fond-creux);
    color: var(--texte);
  }

  .option.choisi {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }

  .etiquette {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .compte {
    font-variant-numeric: tabular-nums;
    font-size: 11px;
    opacity: 0.75;
  }

  .vide {
    padding: 4px 14px;
    font-size: 11px;
    color: var(--texte-faible);
  }

  .palissy {
    padding: 12px 14px;
  }

  .palissy label {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--texte);
  }

  .palissy em {
    font-style: normal;
    color: var(--accent);
  }

  .palissy input {
    width: 100%;
    margin-top: 10px;
    accent-color: var(--accent);
  }

  .palissy p {
    margin: 6px 0 0;
    font-size: 11px;
    line-height: 1.4;
    color: var(--texte-faible);
  }
</style>
