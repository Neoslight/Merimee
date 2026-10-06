<script lang="ts">
  import { suggestions as chercher, type Suggestion } from '$lib/db/suggestions';
  import { RACCOURCIS, surligner, type Raccourci } from '$lib/recherche';
  import { nf } from '$lib/format';

  interface Props {
    /** Ce que montre le champ. Lie a la page : un lien partage ou un retour
     *  arriere le reecrit. */
    terme: string;
    /** La recherche en cours vise les historiques, pas les titres. */
    historiques: boolean;
    /** L'index plein texte est servi par ce deploiement. */
    indexDisponible: boolean;
    onlieu: (s: Suggestion) => void;
    onedifice: (s: Suggestion) => void;
    oncategorie: (s: Suggestion) => void;
    onraccourci: (r: Raccourci) => void;
    ontexte: (texte: string, cible: 'titres' | 'historiques') => void;
    /** Quitter la recherche dans les historiques, champ vide compris. */
    ontitres: () => void;
    onvider: () => void;
    onhasard: () => void;
  }

  let {
    terme = $bindable(),
    historiques,
    indexDisponible,
    onlieu,
    onedifice,
    oncategorie,
    onraccourci,
    ontexte,
    ontitres,
    onvider,
    onhasard
  }: Props = $props();

  /** Une ligne de la liste deroulante, quelle que soit sa famille. */
  type Choix =
    | { type: 'texte'; cible: 'titres' | 'historiques' }
    | { type: 'suggestion'; suggestion: Suggestion }
    | { type: 'raccourci'; raccourci: Raccourci };

  const GROUPES: { titre: string; genres: Suggestion['genre'][] }[] = [
    { titre: 'Lieux', genres: ['commune', 'departement', 'region'] },
    { titre: 'Édifices', genres: ['edifice'] },
    { titre: 'Catégories', genres: ['denomination', 'domaine', 'auteur'] }
  ];

  const PRECISION: Record<Suggestion['genre'], string> = {
    commune: 'commune',
    departement: 'département',
    region: 'région',
    edifice: '',
    denomination: 'type d’édifice',
    domaine: 'domaine',
    auteur: 'architecte, auteur'
  };

  let trouvees = $state.raw<Suggestion[]>([]);
  let focalise = $state(false);
  let ferme = $state(false);
  let active = $state(-1);
  let champ: HTMLInputElement | undefined = $state();
  let racine: HTMLElement | undefined = $state();

  const saisie = $derived(terme.trim());

  // Les suggestions partent 150 ms apres la derniere frappe, et seule la
  // derniere reponse compte : un jeton ecarte les precedentes.
  let jeton = 0;
  $effect(() => {
    const texte = saisie;
    const mien = ++jeton;
    if (texte.length < 2) {
      trouvees = [];
      return;
    }
    const minuteur = setTimeout(() => {
      chercher(texte)
        .then((liste) => {
          if (mien === jeton) trouvees = liste;
        })
        .catch(() => {
          if (mien === jeton) trouvees = [];
        });
    }, 150);
    return () => clearTimeout(minuteur);
  });

  /** Les lignes, dans l'ordre ou le clavier les parcourt. */
  const choix = $derived.by<Choix[]>(() => {
    if (saisie.length < 2) return RACCOURCIS.map((raccourci) => ({ type: 'raccourci', raccourci }));
    const lignes: Choix[] = [{ type: 'texte', cible: 'titres' }];
    for (const groupe of GROUPES) {
      for (const s of trouvees) if (groupe.genres.includes(s.genre)) lignes.push({ type: 'suggestion', suggestion: s });
    }
    if (indexDisponible) lignes.push({ type: 'texte', cible: 'historiques' });
    return lignes;
  });

  const ouvert = $derived(focalise && !ferme && choix.length > 0);

  // Une frappe rouvre la liste et repart de la premiere ligne. La frappe, et
  // non tout changement du champ : apres un choix, la page vide le champ, et
  // la liste des raccourcis se rouvrait par-dessus ce qu'on venait de poser.
  function frappe() {
    ferme = false;
    active = -1;
  }

  function choisir(c: Choix) {
    ferme = true;
    active = -1;
    if (c.type === 'raccourci') {
      onraccourci(c.raccourci);
    } else if (c.type === 'texte') {
      ontexte(saisie, c.cible);
    } else {
      const s = c.suggestion;
      if (s.genre === 'edifice') onedifice(s);
      else if (s.genre === 'commune' || s.genre === 'departement' || s.genre === 'region') onlieu(s);
      else oncategorie(s);
    }
  }

  function clavier(event: KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      ferme = false;
      if (!choix.length) return;
      // Le cycle passe par le champ lui-meme (-1), comme une liste native.
      const n = choix.length;
      if (event.key === 'ArrowDown') active = active + 1 >= n ? -1 : active + 1;
      else active = active <= -1 ? n - 1 : active - 1;
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (active >= 0 && choix[active]) choisir(choix[active]);
      else if (saisie) choisir({ type: 'texte', cible: historiques ? 'historiques' : 'titres' });
    } else if (event.key === 'Escape' && ouvert) {
      // La liste part la premiere ; le champ se vide au second `Echap`, comme
      // tout champ de recherche. `preventDefault` : l'ecouteur global ignore
      // un evenement deja traite.
      event.preventDefault();
      ferme = true;
      active = -1;
    }
  }

  /** La liste se ferme quand le focus quitte le champ et sa liste. */
  function sortie(event: FocusEvent) {
    const vers = event.relatedTarget as Node | null;
    if (vers && racine?.contains(vers)) return;
    focalise = false;
  }

  // `/` amene au champ depuis n'importe ou, comme sur les cartes en ligne —
  // sauf depuis un autre champ, ou c'est un caractere.
  function raccourciClavier(event: KeyboardEvent) {
    if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
    const cible = event.target as HTMLElement | null;
    if (cible && (cible.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(cible.tagName))) return;
    event.preventDefault();
    champ?.focus();
  }

  function vider() {
    terme = '';
    onvider();
    champ?.focus();
  }

  const idLigne = (i: number) => `suggestion-${i}`;
</script>

<svelte:window onkeydown={raccourciClavier} />

<!-- Le champ et sa liste forment un seul composant (motif « combobox » de
     l'ARIA) : le focus reste dans le champ, la ligne active se dit par
     `aria-activedescendant`. La liste se pose sous la carte de recherche,
     `.barre`, qui la positionne. -->
<div class="champ" bind:this={racine} onfocusout={sortie}>
  <input
    class="recherche"
    type="search"
    role="combobox"
    aria-expanded={ouvert}
    aria-controls="suggestions"
    aria-autocomplete="list"
    aria-activedescendant={ouvert && active >= 0 ? idLigne(active) : undefined}
    aria-label={historiques ? 'Rechercher dans le texte des historiques' : 'Rechercher un lieu, un édifice, un architecte'}
    placeholder={historiques ? 'Chercher dans les historiques…' : 'Rechercher un lieu, un édifice…'}
    bind:value={terme}
    bind:this={champ}
    onfocus={() => (focalise = true)}
    onclick={() => (ferme = false)}
    oninput={frappe}
    onkeydown={clavier}
  />
  {#if terme}
    <button class="vider frappe-44" aria-label="Effacer la recherche" onclick={vider}>×</button>
  {/if}
  {#if historiques}
    <!-- Le mode se dit dans le champ, et s'y quitte : la recherche repasse aux
         titres, communes et departements. -->
    <button class="cible actif" aria-pressed="true" title="Revenir à la recherche par titre et lieu"
            onclick={ontitres}>Historiques</button>
  {/if}
  <!-- « Au hasard » est un de, comme le bouton qui fait voyager les globes en
       ligne. Le nom accessible porte les mots. -->
  <button class="hasard" aria-label="Au hasard" title="Voler vers un monument au hasard" onclick={onhasard}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
         stroke-linejoin="round" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="3.5" />
      <circle cx="9" cy="9" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="15" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="9" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="9" cy="15" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  </button>

  {#if ouvert}
    <ul class="suggestions" id="suggestions" role="listbox" aria-label="Suggestions">
      {#if saisie.length < 2}
        <li class="groupe" role="presentation">Explorer</li>
      {/if}
      {#each choix as c, i (i)}
        {@const precedent = choix[i - 1]}
        {#if c.type === 'suggestion' && (precedent?.type !== 'suggestion' || GROUPES.findIndex((g) => g.genres.includes(precedent.suggestion.genre)) !== GROUPES.findIndex((g) => g.genres.includes(c.suggestion.genre)))}
          <li class="groupe" role="presentation">
            {GROUPES.find((g) => g.genres.includes(c.suggestion.genre))?.titre}
          </li>
        {/if}
        <!-- La souris choisit au `mousedown` : au `click`, le champ aurait deja
             perdu le focus et la liste serait partie. -->
        <li class="ligne" class:active={active === i} id={idLigne(i)} role="option" aria-selected={active === i}
            onmousedown={(e) => { e.preventDefault(); choisir(c); }}
            onmousemove={() => (active = i)}>
          {#if c.type === 'raccourci'}
            <span class="libelle">{c.raccourci.libelle}</span>
            <span class="detail">{c.raccourci.detail}</span>
          {:else if c.type === 'texte'}
            <span class="libelle">
              {c.cible === 'titres' ? 'Toutes les notices contenant' : 'Chercher dans les historiques'}
              <b>« {saisie} »</b>
            </span>
            <span class="detail">{c.cible === 'titres' ? 'titre, commune, département' : 'le texte des notices — 3,8 Mo au premier usage'}</span>
          {:else}
            {@const s = c.suggestion}
            {@const d = surligner(s.libelle, saisie)}
            <span class="libelle">
              {#if d}{d.avant}<b>{d.trouve}</b>{d.apres}{:else}{s.libelle}{/if}
            </span>
            <span class="detail">
              {[PRECISION[s.genre], s.precision, s.genre === 'edifice' ? null : `${nf.format(s.n)} notices`]
                .filter(Boolean)
                .join(' · ')}
            </span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  /* Le champ, ses boutons, et sa liste. `position: static` : la liste se
     positionne contre la carte de recherche (`.barre`, dans la page), pour en
     prendre toute la largeur. */
  .champ {
    display: flex;
    flex: 1 1 auto;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  /* 44 px et non 40 : un `<input>` n'accepte pas de pseudo-element, donc la
     zone de frappe etendue lui est interdite — sa hauteur reelle est la seule
     cible qu'il ait. */
  .recherche {
    flex: 1 1 auto;
    min-width: 0;
    height: 44px;
    padding: 0 36px 0 34px;
    background:
      var(--icone-recherche) no-repeat 12px 50% / 15px 15px,
      var(--fond-creux);
    border: 1px solid transparent;
    border-radius: var(--r-m);
    color: var(--texte);
    font-size: 13px;
    text-overflow: ellipsis;
    transition:
      border-color var(--t-rapide),
      background-color var(--t-rapide);
  }

  /* Sous 16 px, Safari iOS zoome toute la page a la mise au point du champ et
     ne la dezoome pas en sortant. Au doigt seulement. */
  @media (pointer: coarse) {
    .recherche {
      font-size: 16px;
    }
  }

  .recherche::placeholder {
    color: var(--texte-tenu);
  }

  .recherche:focus {
    outline: 2px solid var(--inscrit);
    outline-offset: -2px;
    background-color: var(--fond-carte);
  }

  /* La croix native varie d'un navigateur a l'autre et ne se voit pas en
     sombre : le champ porte la sienne. */
  .recherche::-webkit-search-cancel-button {
    display: none;
  }

  .vider {
    flex: 0 0 auto;
    width: 28px;
    height: 28px;
    margin-left: -38px;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--texte-faible);
    font-size: 17px;
    line-height: 1;
    cursor: pointer;
  }

  @media (hover: hover) and (pointer: fine) {
    .vider:hover {
      background: var(--fond-creux);
      color: var(--texte);
    }
  }

  .cible {
    flex: 0 0 auto;
    height: 32px;
    padding: 0 10px;
    border: 1px solid var(--plein-fond);
    border-radius: var(--r-pilule);
    background: var(--plein-fond);
    color: var(--plein-texte);
    font-size: 11px;
    white-space: nowrap;
    cursor: pointer;
  }

  .hasard {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 1px solid var(--bord-appuye);
    border-radius: var(--r-m);
    background: var(--fond-carte);
    color: var(--inscrit-texte);
    cursor: pointer;
    transition: all var(--t-rapide);
  }

  .hasard svg {
    width: 20px;
    height: 20px;
  }

  @media (hover: hover) and (pointer: fine) {
    .hasard:hover {
      border-color: var(--inscrit);
      background: color-mix(in srgb, var(--inscrit) 10%, var(--fond-carte));
    }
  }

  .suggestions {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    right: 0;
    z-index: 10;
    max-height: min(70vh, 560px);
    margin: 0;
    padding: 6px;
    overflow-y: auto;
    overscroll-behavior: contain;
    list-style: none;
    border: 1px solid var(--bord-flottant);
    border-radius: var(--r-l);
    background: var(--fond-carte);
    box-shadow: var(--ombre-fiche);
  }

  .groupe {
    padding: 10px 10px 4px;
    font-size: 9.5px;
    font-weight: 600;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--texte-tenu);
  }

  .ligne {
    display: grid;
    gap: 1px;
    padding: 8px 10px;
    border-radius: var(--r-s);
    cursor: pointer;
  }

  .ligne.active {
    background: var(--fond-creux);
  }

  .libelle {
    overflow: hidden;
    font-size: 13px;
    color: var(--texte);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .libelle b {
    font-weight: 700;
  }

  .detail {
    overflow: hidden;
    font-size: 11px;
    color: var(--texte-faible);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
