<script lang="ts">
  import { detail, type Detail } from '$lib/db/queries';
  import { formaterDistance, nf, romain } from '$lib/format';
  import { distanceMetres } from '$lib/geo';
  import { position } from '$lib/state/position.svelte';
  import { cadre as calculerCadre, estRecadree, glisserCadrage, extraireCredit } from '$lib/photo';
  import { filters } from '$lib/state/filters.svelte';

  interface Props {
    reference: string | null;
    /** Etat transitoire du presse-papier, partage avec le bouton de la barre :
     *  une seule implementation du permalien, deux endroits ou l'appeler. */
    copie: boolean;
    oncopier: () => void;
    onclose: () => void;
    /** Le titre affiche remonte a la page, qui en fait le `<title>` du
     *  document. Optionnel : un appelant sans onglet a nommer n'a rien a
     *  fournir. */
    ontitre?: (titre: string | null) => void;
    /** Le contenu vient de defiler. En feuille d'apercu sur telephone, c'est
     *  le signal que la page attend pour deplier la feuille : on ne lit pas un
     *  historique dans 45 % d'ecran. */
    ondefile?: () => void;
  }

  let { reference, copie, oncopier, onclose, ontitre, ondefile }: Props = $props();

  /** Distance a l'utilisateur, si sa position est connue et la notice situee. */
  const distance = $derived.by(() => {
    const ici = position.courante;
    if (!ici || !fiche || fiche.lon === null || fiche.lat === null) return null;
    return distanceMetres(ici.lon, ici.lat, fiche.lon, fiche.lat);
  });

  let fiche = $state<Detail | null>(null);
  let erreur = $state<string | null>(null);

  $effect(() => {
    const ref = reference;
    if (!ref) {
      fiche = null;
      ontitre?.(null);
      return;
    }
    let annule = false;
    erreur = null;
    detail(ref)
      .then((resultat) => {
        if (!annule) {
          fiche = resultat;
          ontitre?.(resultat.titre);
        }
      })
      .catch((e) => {
        if (!annule) {
          erreur = String(e);
          ontitre?.(null);
        }
      });
    return () => {
      annule = true;
    };
  });

  function dateActe(acte: Detail['actes'][number]): string {
    if (acte.annee === null) return 'date inconnue';
    if (acte.mois === null) return String(acte.annee);
    const jour = acte.jour ?? 1;
    return new Date(Date.UTC(acte.annee, acte.mois - 1, jour)).toLocaleDateString('fr-FR', {
      day: acte.jour ? 'numeric' : undefined,
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC'
    });
  }

  const popUrl = (ref: string) => `https://www.pop.culture.gouv.fr/notice/merimee/${ref}`;

  // Les identifiants stockes disent leur base par leur prefixe. Attestes dans
  // le corpus : PM (119 203), IM (4 217), EM (3 006) et PP (154) viennent de la
  // colonne Palissy ; IA (7 470) et PA (743) des renvois Merimee. JA et AC
  // (76 au total) ne sont pas identifies : les envoyer vers une notice
  // fabriquee serait un lien mort, ils partent vers la recherche POP.
  const BASES: Record<string, string> = {
    PA: 'merimee', IA: 'merimee', EA: 'merimee',
    PM: 'palissy', IM: 'palissy', EM: 'palissy', PP: 'palissy'
  };

  function lienNotice(identifiant: string): string {
    const base = BASES[identifiant.slice(0, 2).toUpperCase()];
    return base
      ? `https://www.pop.culture.gouv.fr/notice/${base}/${identifiant}`
      : `https://www.pop.culture.gouv.fr/search/list?mainSearch=%22${identifiant}%22`;
  }

  // Une notice porte jusqu'a 2 225 objets : rendre toutes les ancres d'un coup
  // figerait la fiche. On deplie par paquets.
  const PAQUET = 50;
  let montres = $state(PAQUET);

  // Remise a zero au changement de notice, sinon une fiche pauvre heriterait
  // du depliage de la precedente.
  $effect(() => {
    reference;
    montres = PAQUET;
    imageChoisie = 0;
    cassees = [];
  });

  // --- Photographie -------------------------------------------------------
  // La base Merimee ne porte aucun lien vers une image. Les noms de fichiers
  // viennent de l'instantane Wikidata (P380 -> P18) porte par les fragments :
  // 84,6 % des notices en ont un, aucune requete supplementaire n'est emise.
  const COMMONS = 'https://commons.wikimedia.org';

  let imageChoisie = $state(0);
  // Un fichier supprime de Commons depuis l'instantane rend un 404. On l'ecarte
  // au lieu de laisser l'icone d'image brisee, et la section ne disparait que
  // si toutes les images de la notice sont tombees.
  let cassees = $state<string[]>([]);
  let credit = $state<{ auteur: string; licence: string } | null>(null);

  const images = $derived((fiche?.commons ?? []).filter((nom) => !cassees.includes(nom)));
  const courante = $derived(images[Math.min(imageChoisie, images.length - 1)] ?? null);

  /**
   * Le cadre epouse le rapport de la photographie, borne des deux cotes.
   *
   * Le 4/3 fixe recadrait tout : une tour en portrait perdait sa fleche, un
   * phototype en bandeau ses deux bords — au moment precis ou l'image sert a
   * identifier l'edifice. Sans borne en revanche, un bandeau se reduirait a un
   * trait et un tirage vertical repousserait le titre hors de l'ecran. Entre
   * les bornes rien n'est coupe ; au-dela, l'image se recadre et se fait
   * glisser dans son cadre.
   */
  let rapport = $state<number | null>(null);
  let cadrageX = $state(50);
  let cadrageY = $state(50);

  const cadre = $derived(calculerCadre(rapport));
  /** Hors bornes : l'image deborde son cadre, donc elle se fait glisser. */
  const recadree = $derived(estRecadree(rapport));

  // Chaque photographie a son rapport : mesure et cadrage repartent a zero,
  // sinon la suivante heriterait du cadre de la precedente.
  $effect(() => {
    courante;
    rapport = null;
    cadrageX = 50;
    cadrageY = 50;
  });

  function mesurer(image: HTMLImageElement) {
    if (image.naturalWidth && image.naturalHeight) {
      rapport = image.naturalWidth / image.naturalHeight;
    }
  }

  /**
   * Glissement dans un cadre borne.
   *
   * `object-position` s'exprime en pourcents de la **part cachee** : le pixel
   * se convertit donc par cette part, recalculee depuis le rapport reel et la
   * boite affichee. Une fraction fixe deriverait avec la largeur de la fiche,
   * qui change de gabarit en gabarit.
   */
  let glissement: { x: number; y: number; px: number; py: number } | null = null;

  function saisir(event: PointerEvent) {
    if (!recadree) return;
    const boite = event.currentTarget as HTMLElement;
    boite.setPointerCapture(event.pointerId);
    glissement = { x: event.clientX, y: event.clientY, px: cadrageX, py: cadrageY };
  }

  function deplacer(event: PointerEvent) {
    if (!glissement || rapport === null) return;
    const boite = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const resultat = glisserCadrage({
      rapport,
      boiteWidth: boite.width,
      boiteHeight: boite.height,
      depart: glissement,
      pointeur: { x: event.clientX, y: event.clientY }
    });
    cadrageX = resultat.x;
    cadrageY = resultat.y;
  }

  function relacher() {
    glissement = null;
  }

  function signalerCassee(nom: string) {
    if (!cassees.includes(nom)) cassees = [...cassees, nom];
  }

  const vignette = (nom: string, largeur: number) =>
    `${COMMONS}/wiki/Special:FilePath/${encodeURIComponent(nom)}?width=${largeur}`;

  const pageFichier = (nom: string) => `${COMMONS}/wiki/File:${encodeURIComponent(nom)}`;

  /**
   * Auteur et licence, lus a la volee sur l'API Commons.
   *
   * La plupart de ces photographies sont sous CC-BY-SA : le credit est une
   * obligation, pas un ornement. Il n'est jamais bloquant — l'image s'affiche
   * d'abord, le credit se pose quand il arrive, et un echec laisse le lien
   * vers la page du fichier, qui porte l'information complete.
   */
  $effect(() => {
    const nom = courante;
    credit = null;
    if (!nom) return;
    let annule = false;
    const url =
      `${COMMONS}/w/api.php?action=query&format=json&origin=*` +
      `&prop=imageinfo&iiprop=extmetadata&titles=${encodeURIComponent(`File:${nom}`)}`;
    fetch(url)
      .then((r) => r.json())
      .then((donnees) => {
        if (annule) return;
        const resultat = extraireCredit(donnees);
        if (resultat) credit = resultat;
      })
      .catch(() => {
        // Reseau ou API muets : le lien vers la page du fichier reste.
      });
    return () => {
      annule = true;
    };
  });

  // --- Filtrage par auteur ---------------------------------------------------
  // Un clic ajoute l'auteur au filtre courant, jamais ne le retire : ce n'est
  // pas une case a cocher, juste un raccourci vers le tiroir des facettes.
  // Ecriture en place, comme `toggle()` : reaffecter la cle ferait perdre le
  // proxy reactif que `$state` a pose sur le tableau.
  function filtrerAuteur(nom: string) {
    if (!filters.auteurs.includes(nom)) filters.auteurs.push(nom);
  }

  // --- Focus ------------------------------------------------------------
  // Point d'entree pour la page : elle l'appelle apres un geste d'ouverture,
  // jamais au chargement d'un permalien. L'aside est toujours present, meme
  // pendant le chargement de la notice — le viser evite d'attendre le titre,
  // qui n'arrive qu'une fois la requete resolue.
  let noeud: HTMLElement | undefined;

  export function focaliser() {
    noeud?.focus();
  }
</script>

<aside class="fiche" tabindex="-1" bind:this={noeud}
       onscroll={() => { if (noeud && noeud.scrollTop > 0) ondefile?.(); }}>
  {#if !reference}
    <div class="attente">
      <h2>Fiche du monument</h2>
      <p>Sélectionnez un point sur la carte ou une notice dans la liste.</p>
    </div>
  {:else if erreur}
    <div class="attente"><p class="erreur">{erreur}</p></div>
  {:else if !fiche}
    <div class="attente"><p>Chargement de la notice {reference}…</p></div>
  {:else}
    <!-- L'image passe en tete de fiche : c'est elle qui identifie l'edifice
         avant son nom. Les deux commandes s'y posent en pastilles, faute de
         place au-dessus. -->
    <div class="hero" class:nu={!courante}>
      {#if courante}
        <figure class="photo">
          <div class="cadre" class:glissable={recadree} style="aspect-ratio: {cadre}">
            <!-- Les gestes sont portes par l'image et non par le cadre : un
                 `<div>` qui ecoute le pointeur reclame un role ARIA, et aucun
                 ne decrit honnetement un cadre de photographie. L'image, elle,
                 remplit exactement ce cadre — la boite mesuree est la meme. -->
            <img
              src={vignette(courante, 800)}
              alt="Photographie de {fiche.titre}"
              loading="lazy"
              draggable="false"
              style="object-fit: {recadree ? 'cover' : 'contain'};
                     object-position: {cadrageX}% {cadrageY}%"
              onload={(e) => mesurer(e.currentTarget as HTMLImageElement)}
              onerror={() => signalerCassee(courante)}
              onpointerdown={saisir} onpointermove={deplacer}
              onpointerup={relacher} onpointercancel={relacher}
            />
          </div>
          {#if images.length > 1}
            <div class="bande">
              {#each images as nom, i (nom)}
                <button class:choisi={nom === courante} onclick={() => (imageChoisie = i)}
                        aria-label="Photographie {i + 1}">
                  <img src={vignette(nom, 120)} alt="" loading="lazy"
                       onerror={() => signalerCassee(nom)} />
                </button>
              {/each}
            </div>
          {/if}
          <figcaption>
            {#if credit?.auteur}<span class="auteur">{credit.auteur}</span>{/if}
            <a href={pageFichier(courante)} target="_blank" rel="noreferrer">
              {credit?.licence || 'Wikimedia Commons'}
            </a>
            {#if recadree}<span class="cadrage">glisser pour cadrer</span>{/if}
          </figcaption>
        </figure>
      {/if}

      <button class="pastille fermer frappe-44" onclick={onclose} aria-label="Fermer la fiche">
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <polyline points="8.5,2.5 4,7 8.5,11.5" stroke="currentColor" stroke-width="1.5"
                    stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <!-- Le nom accessible differe du libelle de la barre : deux boutons de
           meme nom seraient indiscernables, pour un lecteur d'ecran comme pour
           un test. -->
      <button class="pastille copier frappe-44" onclick={oncopier}
              aria-label="Copier le lien de la notice">
        {#if copie}
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <polyline points="2.5,7.5 5.5,10.5 11.5,3.5" stroke="currentColor"
                      stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        {:else}
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <rect x="1.75" y="1.75" width="7.5" height="7.5" rx="1.6"
                  stroke="currentColor" stroke-width="1.3" />
            <rect x="4.75" y="4.75" width="7.5" height="7.5" rx="1.6"
                  stroke="currentColor" stroke-width="1.3" fill="var(--fond-carte)" />
          </svg>
        {/if}
      </button>
    </div>

    <header>
      <p class="lieu">
        {fiche.commune} · {fiche.departement_nom}
        {#if distance !== null}<span class="distance">à {formaterDistance(distance)} de vous</span>{/if}
      </p>
      <h2>{fiche.titre}</h2>
      <p class="badges">
        <span class="badge {fiche.statut === 'classé' ? 'or' : fiche.statut === 'inscrit' ? 'bleu' : 'violet'}">
          {fiche.statut}{fiche.partiel ? ' (partiellement)' : ''}
        </span>
        {#if fiche.siecles.length}
          <span class="badge sourd">{fiche.siecles.map(romain).join(' · ')}</span>
        {/if}
        {#each fiche.periodes as periode}<span class="badge sourd">{periode}</span>{/each}
      </p>
      <p class="actions">
        <a href={popUrl(fiche.reference)} target="_blank" rel="noreferrer">
          Notice POP {fiche.reference} ↗
        </a>
        <!-- Les campagnes photographiques du ministere couvrent la plupart des
             notices que Wikimedia ignore, mais elles sont sous droits reserves :
             on les compte et on y renvoie, on ne les reproduit pas. -->
        {#if fiche.memoire}
          <a class="renvoi-photo" href={popUrl(fiche.reference)} target="_blank" rel="noreferrer">
            {fiche.memoire}
            {fiche.memoire > 1 ? 'photographies' : 'photographie'} sur POP ↗
          </a>
        {/if}
      </p>
    </header>

    <dl>
      {#if fiche.adresse || fiche.lieudit}
        <dt>Localisation</dt>
        <dd>{[fiche.adresse, fiche.lieudit].filter(Boolean).join(' — ')}</dd>
      {/if}
      {#if fiche.denominations.length}
        <dt>Dénomination</dt><dd>{fiche.denominations.join(', ')}</dd>
      {/if}
      {#if fiche.domaines.length}
        <dt>Domaine</dt><dd>{fiche.domaines.join(', ')}</dd>
      {/if}
      {#if fiche.auteurs_detail.length}
        <dt>Auteurs</dt>
        <dd>
          {fiche.auteurs_detail.join(' ; ')}
          {#if fiche.auteurs.length}
            <!-- Raccourci vers le filtre, pas une redite : `auteurs_detail`
                 garde la forme brute du champ source, ces pastilles visent la
                 liste consolidee qu'utilise deja la facette. -->
            <div class="pastilles-auteurs">
              {#each fiche.auteurs as nom (nom)}
                <button class="pastille-auteur frappe-44-v" onclick={() => filtrerAuteur(nom)}
                        aria-label="Filtrer sur l'auteur {nom}">{nom}</button>
              {/each}
            </div>
          {/if}
        </dd>
      {/if}
      {#if fiche.siecle_detail}
        <dt>Campagne principale</dt><dd>{fiche.siecle_detail}</dd>
      {/if}
      {#if fiche.proprietaires.length}
        <dt>Propriété</dt><dd>{fiche.proprietaires.join(', ')}</dd>
      {/if}
      {#if fiche.cadastre}
        <dt>Cadastre</dt><dd>{fiche.cadastre}</dd>
      {/if}
    </dl>

    <section>
      <h3>Actes de protection</h3>
      <ol class="actes">
        {#each fiche.actes as acte}
          <li><time>{dateActe(acte)}</time><span>{acte.libelle}</span></li>
        {:else}
          <li class="sourd">aucun acte daté dans la notice</li>
        {/each}
      </ol>
      {#if fiche.precision_protection}
        <p class="precision">{fiche.precision_protection}</p>
      {/if}
    </section>

    {#if fiche.historique}
      <section>
        <h3>Historique</h3>
        <p class="texte">{fiche.historique}</p>
      </section>
    {/if}

    {#if fiche.observations}
      <section>
        <h3>Observations</h3>
        <p class="texte">{fiche.observations}</p>
      </section>
    {/if}

    <section>
      <h3>Ressources</h3>
      <ul class="liens">
        {#if fiche.archiv_mh}
          <li><a href={fiche.archiv_mh} target="_blank" rel="noreferrer">Dossier Archiv-MH</a></li>
        {/if}
        {#each fiche.liens_externes as lien, i}
          <li><a href={lien} target="_blank" rel="noreferrer">Arrêté / document {i + 1}</a></li>
        {/each}
        {#if fiche.nb_palissy > 0}
          <li>
            <a href={`https://www.pop.culture.gouv.fr/search/list?base=%5B%22Palissy%22%5D&mainSearch=%22${fiche.reference}%22`}
               target="_blank" rel="noreferrer">
              Rechercher les {nf.format(fiche.nb_palissy)} objets dans POP
            </a>
          </li>
        {/if}
      </ul>
    </section>

    {#if fiche.palissy.length}
      <section>
        <h3>Objets mobiliers <em>{nf.format(fiche.palissy.length)}</em></h3>
        <ul class="jetons">
          {#each fiche.palissy.slice(0, montres) as identifiant (identifiant)}
            <li>
              <a href={lienNotice(identifiant)} target="_blank" rel="noreferrer">{identifiant}</a>
            </li>
          {/each}
        </ul>
        {#if fiche.palissy.length > montres}
          <button class="plus" onclick={() => (montres += PAQUET)}>
            voir {nf.format(Math.min(PAQUET, fiche.palissy.length - montres))} objets de plus
            <em>({nf.format(fiche.palissy.length - montres)} restants)</em>
          </button>
        {/if}
      </section>
    {/if}

    {#if fiche.renvois.length}
      <section>
        <h3>Notices liées <em>{nf.format(fiche.renvois.length)}</em></h3>
        <ul class="jetons">
          {#each fiche.renvois.slice(0, PAQUET) as identifiant (identifiant)}
            <li>
              <a href={lienNotice(identifiant)} target="_blank" rel="noreferrer">{identifiant}</a>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  {/if}
</aside>

<style>
  .fiche {
    overflow-y: auto;
    /* En feuille du bas sur telephone, la fiche est une modale : son geste de
       defilement ne remonte pas a la page. */
    overscroll-behavior: contain;
    background: var(--fond-carte);
    padding: 0 0 8px;
  }

  .attente {
    padding: 26px 18px;
    color: var(--texte-faible);
    font-size: 12px;
    line-height: 1.5;
  }

  .attente h2 {
    margin: 0 0 6px;
    font-size: 12px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--texte);
  }

  .erreur {
    color: var(--erreur);
  }

  .hero {
    position: relative;
  }

  /* Sans photographie, la fiche s'ouvre sur son titre. Le cadre « aucune
     photographie » occupait un tiers du panneau pour ne rien dire que la
     fiche ne dise deja : la denomination et le domaine sont juste dessous.
     Reste la hauteur des deux pastilles, qui se posaient sur l'image — et
     leur filet, sans lequel elles disparaitraient sur le fond du panneau. */
  .hero.nu {
    height: 62px;
  }

  .hero.nu .pastille {
    border: 1px solid var(--bord);
    box-shadow: none;
  }

  /* Pastilles posees sur l'image : il n'y a pas de place au-dessus, et une
     barre d'outils dediee couterait une rangee pour deux commandes. */
  .pastille {
    position: absolute;
    top: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    border: none;
    border-radius: 50%;
    background: color-mix(in srgb, var(--fond-carte) 92%, transparent);
    color: var(--texte);
    cursor: pointer;
    box-shadow: 0 6px 18px -6px rgb(var(--voile) / 35%);
    transition: background var(--t-rapide);
  }

  @media (hover: hover) and (pointer: fine) {
    .pastille:hover {
      background: var(--fond-carte);
    }
  }

  .fermer {
    left: 20px;
  }

  .copier {
    right: 20px;
  }

  header {
    padding: 18px 22px 22px;
    border-bottom: 1px solid color-mix(in srgb, var(--bord) 70%, transparent);
  }

  .lieu {
    margin: 0 0 6px;
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--texte-tenu);
  }

  /* La distance n'est pas un toponyme : elle quitte les capitales espacees du
     lieu et prend la couleur du point de position, qui la relie a lui. */
  .distance {
    display: inline-block;
    margin-left: 8px;
    font-weight: 600;
    letter-spacing: 0;
    text-transform: none;
    color: var(--position);
  }

  /* Le serif s'arrete au titre et au texte d'archive. Applique aux libelles de
     facette ou aux nombres a 10 px, il les rendrait illisibles. */
  h2 {
    margin: 0 0 14px;
    font-family: var(--police-titre);
    font-size: 32px;
    font-weight: 500;
    line-height: 1.1;
    letter-spacing: -0.01em;
    color: var(--texte);
    text-wrap: pretty;
  }

  .badges {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
    margin: 0;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 5px 12px;
    border: 1px solid var(--bord);
    border-radius: var(--r-pilule);
    font-size: 11.5px;
    font-weight: 600;
    letter-spacing: 0.01em;
  }

  /* Statut classe : pastille terracotta pleine, la seule de la fiche. */
  .or {
    border-color: var(--classe);
    background: var(--classe);
    color: var(--texte-sur-plein);
  }

  .or::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--texte-sur-plein) 85%, transparent);
  }

  .bleu {
    border-color: var(--inscrit);
    background: color-mix(in srgb, var(--inscrit) 14%, transparent);
    color: var(--inscrit-texte);
  }

  .violet {
    border-color: var(--mixte);
    background: color-mix(in srgb, var(--mixte) 12%, transparent);
    color: var(--mixte);
  }

  .sourd {
    border-color: var(--bord);
    color: var(--texte-faible);
    font-weight: 500;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin: 18px 0 0;
  }

  .actions a {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 1px solid var(--bord);
    border-radius: var(--r-pilule);
    padding: 9px 17px;
    font-size: 12px;
    font-weight: 600;
    color: var(--texte-moyen);
    transition: all var(--t-rapide);
  }

  /* Second renvoi vers la meme page : il repond a une autre question — « ou
     sont les photographies que Wikimedia n'a pas ? » — mais il ne doit pas
     peser autant que le premier, d'ou une pilule sans filet. */
  .actions a.renvoi-photo {
    border-color: transparent;
    padding-left: 2px;
    padding-right: 2px;
    font-weight: 500;
    color: var(--texte-faible);
  }

  @media (hover: hover) and (pointer: fine) {
    /* Annule le survol general ci-dessous : cette pilule ne doit pas peser
       autant que le premier renvoi. Repetee plutot que partagee, pour rester
       dans la meme media query que la regle qu'elle contredit. */
    .actions a.renvoi-photo:hover {
      border-color: transparent;
      padding-left: 2px;
      padding-right: 2px;
      font-weight: 500;
    }

    .actions a:hover {
      border-color: var(--inscrit);
      color: var(--inscrit-texte);
      text-decoration: none;
    }
  }

  .photo {
    margin: 0;
    padding: 10px 10px 0;
  }

  /* Le cadre porte le rapport, l'image le remplit : c'est lui qu'on mesure
     pour convertir un glissement en cadrage, et lui qui reserve la place
     avant que l'image arrive — sinon chaque photographie pousserait la fiche
     vers le bas au moment ou on commence a la lire. */
  .cadre {
    display: block;
    width: 100%;
    aspect-ratio: 4 / 3;
    border-radius: var(--r-m);
    background: var(--fond-creux);
    overflow: hidden;
  }

  .cadre > img {
    display: block;
    width: 100%;
    height: 100%;
    /* Le glissement natif de l'image ferait concurrence au notre. */
    user-select: none;
    -webkit-user-drag: none;
  }

  /* Seule une image hors bornes se fait glisser : la main ne s'ouvre que
     lorsqu'il y a quelque chose a decouvrir. `touch-action` doit ceder le
     geste au doigt, mais uniquement dans ce cas — ailleurs la fiche defile. */
  .cadre.glissable {
    cursor: grab;
    touch-action: none;
  }

  .cadre.glissable:active {
    cursor: grabbing;
  }

  .bande {
    display: flex;
    gap: 6px;
    padding: 8px 0 0;
  }

  .bande button {
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--r-s);
    background: none;
    cursor: pointer;
    overflow: hidden;
    line-height: 0;
    transition: border-color var(--t-rapide);
  }

  .bande button.choisi {
    border-color: var(--classe);
  }

  .bande img {
    width: 54px;
    height: 40px;
    object-fit: cover;
  }

  figcaption {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 8px;
    padding: 8px 12px 0;
    font-size: 10px;
    color: var(--texte-tenu);
  }

  .cadrage {
    margin-left: auto;
    font-style: italic;
  }

  .auteur {
    max-width: 60%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Deux colonnes, pas trois : la pastille flotte dans le `dt`, une colonne
     dediee ne ferait que perdre 24 px de largeur de texte. */
  dl {
    display: grid;
    grid-template-columns: 104px 1fr;
    gap: 9px 10px;
    margin: 0;
    padding: 18px 22px;
    border-bottom: 1px solid color-mix(in srgb, var(--bord) 70%, transparent);
    font-size: 12.5px;
  }

  dt {
    color: var(--texte-faible);
  }

  dt::before {
    content: '';
    display: block;
    float: left;
    width: 5px;
    height: 5px;
    margin: 6px 9px 0 0;
    border-radius: 50%;
    background: var(--inscrit);
  }

  dd {
    margin: 0;
    color: var(--texte);
    line-height: 1.45;
  }

  /* Raccourci de filtrage, pas une facette de plus : memes jetons que les
     pilules d'options du tiroir, en plus discret puisqu'il vit dans un `dd`
     et non dans une liste de criteres poses. */
  .pastilles-auteurs {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-top: 7px;
  }

  .pastille-auteur {
    padding: 3px 11px;
    border: 1px solid var(--bord);
    border-radius: var(--r-pilule);
    background: var(--fond-creux);
    color: var(--texte-moyen);
    font-size: 11px;
    cursor: pointer;
    transition: all var(--t-rapide);
  }

  @media (hover: hover) and (pointer: fine) {
    .pastille-auteur:hover {
      border-color: var(--inscrit);
      background: color-mix(in srgb, var(--inscrit) 10%, var(--fond-carte));
      color: var(--inscrit-texte);
    }
  }

  section {
    padding: 18px 22px;
    border-bottom: 1px solid color-mix(in srgb, var(--bord) 70%, transparent);
  }

  section:last-child {
    border-bottom: none;
    padding-bottom: 26px;
  }

  h3 {
    margin: 0 0 11px;
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--texte-tenu);
  }

  .actes {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
    font-size: 12.5px;
  }

  .actes li {
    display: flex;
    gap: 12px;
  }

  .actes time {
    flex: 0 0 118px;
    color: var(--classe-texte);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .actes span {
    color: var(--texte);
  }

  .precision,
  .texte {
    margin: 10px 0 0;
    font-size: 12px;
    line-height: 1.55;
    color: var(--texte-faible);
  }

  /* L'historique est un texte d'archive, pas une metadonnee : il recoit la
     mesure et l'interligne d'un texte suivi, et un filet de citation. */
  .texte {
    max-width: 62ch;
    padding-left: 14px;
    border-left: 2px solid var(--bord-appuye);
    font-family: var(--police-titre);
    font-size: 15px;
    line-height: 1.65;
    color: var(--texte-moyen);
  }

  .liens {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 7px;
    font-size: 12.5px;
  }

  h3 em {
    font-style: normal;
    font-variant-numeric: tabular-nums;
    color: var(--texte);
  }

  /* Identifiants POP : une grille de jetons courts tient bien plus d'entrees
     qu'une liste verticale, et reste balayable a l'oeil. */
  .jetons {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .jetons a {
    display: block;
    padding: 3px 8px;
    border: 1px solid var(--bord);
    border-radius: var(--r-s);
    transition: all var(--t-rapide);
    background: var(--fond-creux);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: var(--texte-faible);
  }

  @media (hover: hover) and (pointer: fine) {
    .jetons a:hover {
      color: var(--inscrit-texte);
      border-color: var(--inscrit);
      text-decoration: none;
    }
  }

  .plus {
    margin-top: 8px;
    border: 1px solid var(--bord);
    background: transparent;
    color: var(--accent);
    border-radius: var(--r-pilule);
    padding: 6px 14px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: border-color var(--t-rapide);
  }

  @media (hover: hover) and (pointer: fine) {
    .plus:hover {
      border-color: var(--accent);
    }
  }

  .plus em {
    font-style: normal;
    color: var(--texte-faible);
  }

  a {
    color: var(--accent);
    text-decoration: none;
  }

  @media (hover: hover) and (pointer: fine) {
    a:hover {
      text-decoration: underline;
    }
  }

  /* Sur gabarit etroit la fiche remonte en feuille pleine largeur, et le cadre,
     qui suit le rapport reel du fichier, prenait alors pres de 570 px de haut :
     le titre de l'edifice — la seule chose qui dise sur quoi on a clique —
     arrivait coupe en deux par le bord de l'ecran. La hauteur affichee est donc
     bornee ici, et **seulement ici**. Le rapport lui-meme n'est pas touche :
     `object-fit` continue de faire son travail dans le cadre reduit, et le
     couple bornes 0,68 / 1,9 reste la regle sur les gabarits ou la fiche est
     une colonne. */
  @media (max-width: 768px) {
    .cadre {
      max-height: 48dvh;
    }

    /* La feuille remonte du bas : sur iPhone, la barre d'accueil (home
       indicator) chevauche le bas du panneau sans cette reserve. */
    .fiche {
      padding-bottom: calc(8px + var(--sa-bas));
    }
  }
</style>
