<script lang="ts">
  import { untrack } from 'svelte';
  import { facette, type Compte } from '$lib/db/queries';
  import { filters, toggle, type FacetKey } from '$lib/state/filters.svelte';

  interface Props {
    facettes: Partial<Record<FacetKey, Compte[]>>;
    /** Valeurs distinctes par facette, sous les filtres courants. Dit ce que le
     *  plafond des 40 valeurs cache : « 40 sur 7 040 ». */
    cardinaux: Partial<Record<FacetKey, number>>;
    chargement: boolean;
  }

  let { facettes, cardinaux, chargement }: Props = $props();

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

  // Resultats de recherche par section, qui remplacent la liste recue en props
  // tant qu'un terme est saisi.
  let trouvees = $state<Partial<Record<FacetKey, Compte[]>>>({});
  let jeton = 0;

  // La liste des props est plafonnee aux 40 valeurs les plus frequentes : la
  // filtrer en JavaScript ne verrait jamais `Baltard Victor` (5 notices) parmi
  // 7 040 auteurs. La recherche redescend donc dans DuckDB, pour la seule
  // section concernee — aucune requete tant qu'aucun terme n'est tape.
  $effect(() => {
    // Les comptes viennent d'etre recalcules : nos surcharges doivent suivre.
    facettes;

    const actifs = SECTIONS
      .map((section) => ({ cle: section.cle, terme: (recherches[section.cle] ?? '').trim() }))
      .filter((x) => x.terme.length > 0);

    const mien = ++jeton;
    if (!actifs.length) {
      trouvees = {};
      return;
    }

    const minuteur = setTimeout(() => {
      Promise.all(actifs.map((x) => facette(filters, x.cle, 60, x.terme)))
        .then((listes) => {
          if (mien !== jeton) return;
          trouvees = Object.fromEntries(actifs.map((x, i) => [x.cle, listes[i]]));
        })
        .catch(() => {
          // Repli defini : la section revient a la liste des props plutot que
          // de rester sur un resultat qui ne correspond plus au terme.
          if (mien === jeton) trouvees = {};
        });
    }, 180);
    return () => clearTimeout(minuteur);
  });

  // Le curseur Palissy etait le seul filtre du produit lie directement a
  // `filters`. Un `<input type="range">` emet `input` a chaque pas franchi :
  // un glissement de 0 a 500 par pas de 10 pouvait empiler cinquante cycles de
  // requetes sur la connexion unique, que le jeton monotone ecarte a
  // l'affichage mais dont le moteur paie chaque execution. Il ecrit donc dans
  // un etat local — affiche sans delai — qui ne descend dans `filters` qu'apres
  // 180 ms, le meme delai que la recherche de facette ci-dessus.
  let nbPalissyLocal = $state(filters.nbPalissy);

  $effect(() => {
    const vise = nbPalissyLocal;
    // `filters` est lu hors dependance : sans cela l'ecriture differee
    // rejouerait l'effet qui l'a produite.
    if (vise === untrack(() => filters.nbPalissy)) return;
    const minuteur = setTimeout(() => (filters.nbPalissy = vise), 180);
    return () => clearTimeout(minuteur);
  });

  // `reset()` et le retrait de la puce ecrivent dans `filters` sans passer par
  // le curseur : la poignee doit les suivre.
  $effect(() => {
    nbPalissyLocal = filters.nbPalissy;
  });

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
    return trouvees[cle] ?? facettes[cle] ?? [];
  }

  const nf = new Intl.NumberFormat('fr-FR');

  /** Ce qu'annonce le titre d'une section : le total des valeurs distinctes,
   *  et, section ouverte, la part reellement affichee. */
  function cardinal(cle: FacetKey, montrees: number, ouverte: boolean): string {
    const total = cardinaux[cle];
    if (total === undefined) return '';
    if (!ouverte) return nf.format(total);
    return montrees < total ? `${montrees} sur ${nf.format(total)}` : nf.format(total);
  }
</script>

<aside class="panneau" class:occupe={chargement}>
  {#each SECTIONS as section (section.cle)}
    {@const actives = selection(section.cle)}
    {@const ouverte = ouvertes.has(section.cle)}
    {@const options = visibles(section.cle)}
    <section>
      <button class="titre" onclick={() => basculerSection(section.cle)}>
        <span class="chevron" class:ouvert={ouverte}>›</span>
        <span class="nom-section">{section.titre}</span>
        {#if actives.length}<em>{actives.length}</em>{/if}
        {#if cardinal(section.cle, options.length, ouverte)}
          <span class="cardinal">{cardinal(section.cle, options.length, ouverte)}</span>
        {/if}
      </button>

      {#if ouverte}
        {#if section.filtrable}
          <input
            class="filtre"
            type="search"
            placeholder="filtrer…"
            bind:value={recherches[section.cle]}
          />
        {/if}
        <ul>
          {#each options as item (item.valeur)}
            <li>
              <!-- Le statut de protection est la seule facette au code couleur :
                   la pilule cochee prend l'aplat terracotta du classe. -->
              <button
                class="option"
                class:choisi={actives.includes(item.valeur)}
                class:statut-classe={section.cle === 'statut' && item.valeur === 'classé'}
                aria-pressed={actives.includes(item.valeur)}
                onclick={() => toggle(CIBLES[section.cle], item.valeur)}
              >
                <!-- Le libelle est coupe a 200 px par l'ellipse, et certaines
                     denominations en font 389 : « architecture hospitaliere,
                     d'assis… » ne se devine pas. Le `title` est le seul moyen
                     d'atteindre la valeur entiere — au pointeur comme aux
                     technologies d'assistance. -->
                <span class="etiquette" title={item.valeur}>{item.valeur}</span>
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
      <em>{nbPalissyLocal > 0 ? `≥ ${nbPalissyLocal}` : 'tous'}</em>
    </label>
    <input
      id="palissy"
      type="range"
      min="0"
      max="500"
      step="10"
      bind:value={nbPalissyLocal}
    />
    <p>Isoler les édifices qui abritent un grand nombre d'objets classés.</p>
  </section>
</aside>

<style>
  .panneau {
    overflow-y: auto;
    /* Cf. `.liste` : un tiroir modal ne rend pas son geste a la page. */
    overscroll-behavior: contain;
    background: var(--fond-carte);
    padding: 4px 22px 28px;
    transition: opacity var(--t-rapide);
  }

  .panneau.occupe {
    opacity: 0.6;
  }

  section {
    padding: 18px 0;
    border-bottom: 1px solid color-mix(in srgb, var(--bord) 65%, transparent);
  }

  section:last-of-type {
    border-bottom: none;
  }

  /* L'en-tete est une cible **isolee** : elle peut prendre ses 44 px en
     hauteur reelle, ce qui coute une vingtaine de pixels par section dans un
     tiroir qui defile deja. Les pilules d'options, elles, restent a 30 px :
     ce sont des cibles en grille, elles passent le seuil AA de WCAG 2.2
     (24 px), et les porter a 44 changerait la densite du tiroir — c'est un
     arbitrage, pas un oubli. */
  .titre {
    display: flex;
    align-items: center;
    min-height: 44px;
    gap: 9px;
    width: 100%;
    padding: 0 0 11px;
    background: none;
    border: none;
    color: var(--texte);
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    text-align: left;
    cursor: pointer;
    transition: color var(--t-rapide);
  }

  .titre:hover {
    color: var(--accent);
  }

  /* Le libelle prend la place restante : c'est lui qui pousse le badge et la
     cardinalite a droite. Deux `margin-left: auto` se partageraient l'espace
     et poseraient le badge au milieu. */
  .nom-section {
    flex: 1;
  }

  .titre em {
    font-style: normal;
    font-size: 10.5px;
    letter-spacing: 0;
    text-transform: none;
    color: var(--texte-sur-plein);
    background: var(--accent-plein);
    border-radius: var(--r-pilule);
    padding: 1px 7px;
  }

  /* Ce que la liste plafonnee a 40 valeurs ne disait pas : combien il y en a. */
  .cardinal {
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0;
    text-transform: none;
    color: var(--texte-tenu);
    font-variant-numeric: tabular-nums;
  }

  .chevron {
    display: inline-block;
    color: var(--texte-tenu);
    transition: transform var(--t-rapide);
  }

  .chevron.ouvert {
    transform: rotate(90deg);
  }

  .filtre {
    width: 100%;
    height: 34px;
    margin: 0 0 10px;
    padding: 0 12px 0 32px;
    background:
      var(--icone-recherche) no-repeat 11px 50% / 13px 13px,
      var(--fond-creux);
    border: 1px solid var(--bord);
    border-radius: var(--r-s);
    color: var(--texte);
    font-size: 12px;
    transition: border-color var(--t-rapide);
  }

  .filtre:focus {
    outline: none;
    border-color: var(--inscrit);
  }

  /* Les options deviennent des pilules selectionnables : une liste de lignes
     ne dit pas qu'un critere est un objet qu'on pose et qu'on retire. */
  ul {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 268px;
    overflow-y: auto;
    /* Liste defilante imbriquee dans `.panneau`, lui-meme defilant : sans
       confinement, arriver au bout de l'une passe le geste a l'autre. */
    overscroll-behavior: contain;
  }

  .option {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    width: auto;
    padding: 6px 13px;
    border: 1px solid var(--bord);
    border-radius: var(--r-pilule);
    background: var(--fond-carte);
    color: var(--texte-moyen);
    font-size: 12.5px;
    font-weight: 500;
    text-align: left;
    cursor: pointer;
    transition: all var(--t-rapide);
  }

  .option:hover {
    border-color: var(--inscrit);
    background: color-mix(in srgb, var(--inscrit) 10%, var(--fond-carte));
    color: var(--inscrit-texte);
  }

  .option.choisi {
    border-color: var(--inscrit);
    background: color-mix(in srgb, var(--inscrit) 14%, transparent);
    color: var(--inscrit-texte);
    font-weight: 600;
  }

  /* Le statut de protection est la seule facette au code couleur. */
  .option.choisi.statut-classe {
    border-color: var(--classe);
    background: var(--classe);
    color: var(--texte-sur-plein);
  }

  .etiquette {
    flex: 0 1 auto;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .compte {
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: var(--texte-tenu);
  }

  .option.choisi .compte {
    color: inherit;
    opacity: 0.7;
  }

  .vide {
    padding: 4px 2px;
    font-size: 11.5px;
    color: var(--texte-tenu);
  }

  .palissy {
    padding: 18px 0 0;
  }

  .palissy label {
    display: flex;
    justify-content: space-between;
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--texte);
  }

  .palissy em {
    font-style: normal;
    letter-spacing: 0;
    text-transform: none;
    font-size: 11.5px;
    color: var(--inscrit-texte);
  }

  .palissy input {
    width: 100%;
    height: 16px;
    margin-top: 12px;
    accent-color: var(--inscrit);
  }

  .palissy p {
    margin: 8px 0 0;
    font-size: 11.5px;
    line-height: 1.5;
    color: var(--texte-faible);
  }
</style>
