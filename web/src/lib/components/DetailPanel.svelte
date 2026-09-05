<script lang="ts">
  import { detail, type Detail } from '$lib/db/queries';

  interface Props {
    reference: string | null;
    onclose: () => void;
  }

  let { reference, onclose }: Props = $props();

  let fiche = $state<Detail | null>(null);
  let erreur = $state<string | null>(null);

  $effect(() => {
    const ref = reference;
    if (!ref) {
      fiche = null;
      return;
    }
    let annule = false;
    erreur = null;
    detail(ref)
      .then((resultat) => {
        if (!annule) fiche = resultat;
      })
      .catch((e) => {
        if (!annule) erreur = String(e);
      });
    return () => {
      annule = true;
    };
  });

  const ROMAINS = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
    'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI'];

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

  const nf = new Intl.NumberFormat('fr-FR');
  const popUrl = (ref: string) => `https://www.pop.culture.gouv.fr/notice/merimee/${ref}`;
</script>

<aside class="fiche" aria-live="polite">
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
    <header>
      <button class="fermer" onclick={onclose} aria-label="Fermer la fiche">×</button>
      <p class="lieu">{fiche.commune} · {fiche.departement_nom}</p>
      <h2>{fiche.titre}</h2>
      <p class="badges">
        <span class="badge {fiche.statut === 'classé' ? 'or' : fiche.statut === 'inscrit' ? 'bleu' : 'violet'}">
          {fiche.statut}{fiche.partiel ? ' (partiellement)' : ''}
        </span>
        {#if fiche.siecles.length}
          <span class="badge sourd">{fiche.siecles.map((s) => ROMAINS[s] ?? s).join(' · ')}</span>
        {/if}
        {#each fiche.periodes as periode}<span class="badge sourd">{periode}</span>{/each}
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
        <dt>Auteurs</dt><dd>{fiche.auteurs_detail.join(' ; ')}</dd>
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
        <li><a href={popUrl(fiche.reference)} target="_blank" rel="noreferrer">Notice POP {fiche.reference}</a></li>
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
              {nf.format(fiche.nb_palissy)} objets mobiliers Palissy
            </a>
          </li>
        {/if}
      </ul>
    </section>
  {/if}
</aside>

<style>
  .fiche {
    overflow-y: auto;
    border-left: 1px solid var(--bord);
    background: var(--fond);
    padding: 0 0 32px;
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
    color: #e0715e;
  }

  header {
    position: relative;
    padding: 18px 18px 14px;
    border-bottom: 1px solid var(--bord);
  }

  .fermer {
    position: absolute;
    top: 10px;
    right: 12px;
    background: none;
    border: none;
    color: var(--texte-faible);
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
  }

  .lieu {
    margin: 0 0 4px;
    font-size: 11px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--texte-faible);
  }

  h2 {
    margin: 0 26px 10px 0;
    font-size: 17px;
    font-weight: 600;
    line-height: 1.25;
    color: var(--texte);
  }

  .badges {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0;
  }

  .badge {
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 10px;
    letter-spacing: 0.04em;
    border: 1px solid currentColor;
  }

  .or { color: #e0a458; }
  .bleu { color: #4ea8de; }
  .violet { color: #b07bd4; }
  .sourd { color: var(--texte-faible); }

  dl {
    display: grid;
    grid-template-columns: 88px 1fr;
    gap: 5px 12px;
    margin: 0;
    padding: 14px 18px;
    border-bottom: 1px solid var(--bord);
    font-size: 12px;
  }

  dt {
    color: var(--texte-faible);
    font-size: 10px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    padding-top: 1px;
  }

  dd {
    margin: 0;
    color: var(--texte);
    line-height: 1.45;
  }

  section {
    padding: 14px 18px;
    border-bottom: 1px solid var(--bord);
  }

  h3 {
    margin: 0 0 8px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--texte-faible);
  }

  .actes {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 5px;
    font-size: 12px;
  }

  .actes li {
    display: flex;
    gap: 10px;
  }

  .actes time {
    flex: 0 0 118px;
    color: var(--accent);
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

  .liens {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 5px;
    font-size: 12px;
  }

  a {
    color: var(--accent);
    text-decoration: none;
  }

  a:hover {
    text-decoration: underline;
  }
</style>
