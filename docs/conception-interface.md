# Règles de conception — interface

Déplacé de `CLAUDE.md`. Couvre `+page.svelte`, `app.css`, `app.html`, et les
composants `FacetPanel`, `Jetons`, `Timeline`, `DetailPanel`. Lire
cette page avant de toucher à la mise en page, au focus, au clavier ou à
l'accessibilité.

**Plus de barre d'en-tête : la carte prend tout l'écran** (phase 4 de
`PLAN_REFONTE_INTERFACE.md`). Ce qu'on y pose flotte dessus, à la manière des cartes en
ligne :

- **le bloc du haut** (`.haut`), en haut à gauche, large de `--largeur-volet` (440 px,
  400 sous 1 100 px, toute la largeur sur téléphone) : la carte de recherche (`.barre` —
  le titre `Mérimée`, le champ, « Historiques », le dé « Au hasard »), puis la rangée
  d'outils (`.outils` — le compteur, la bascule Carte / Liste, Filtres, Frises), puis
  les puces des filtres posés. La rangée d'outils doit tenir sur une ligne : c'est ce
  qui fixe la largeur ;
- **le titre est un `<h1>`** : visible au large, en tête de la carte de recherche ;
  réservé aux lecteurs d'écran sur téléphone, où la largeur va au champ ;
- **un seul compteur** (`.chiffres`), qui suit les filtres et porte `aria-live="polite"`
  et `aria-atomic="true"` : c'est le compte qui doit être relu au changement, et en
  entier ;
- **le thème est une pastille sans libellé**, au coin haut droit de la carte au large,
  au bout de la rangée d'outils sur téléphone — deux boutons, un seul jamais visible
  (`display: none` sur l'autre, que `getByRole` ignore). L'icône dit la destination,
  l'`aria-label` la nomme (`Clair` / `Sombre`) ;
- **les commandes de MapLibre descendent en bas à droite** au-dessus de l'attribution,
  sur téléphone sous le bloc du haut (cf. `docs/conception-carte.md`).

**Les deux panneaux repliables sont fermés au chargement, à toutes les largeurs.** Le
tiroir des filtres s'ouvrait dès qu'il y avait la place de le poser à côté de la carte,
et la frise dès 900 px : il fallait donc refermer deux calques avant de voir ce qu'on
vient voir. Ils ne répondent plus qu'au geste, et le seuil de 900 px ne commande plus
que `etroit` — le voile et la fiche qui referme le tiroir derrière elle. Deux
conséquences :

- **le démarrage n'émet plus que trois requêtes au lieu de quatorze.** Les effets qui
  portent facettes, cardinalités et histogrammes dépendent de ces deux drapeaux ; fermés,
  ils ne partent pas, et l'ouverture les rejoue ;
- **le franchissement du seuil ne referme plus rien non plus.** Rétrécir une fenêtre
  laisse le tiroir ouvert sur la carte, voile compris. C'est un état que le geste
  dénoue, pas une panne — mais la suite e2e, elle, doit le refermer avant d'éprouver le
  bouton flottant, qui s'efface tant que le tiroir est ouvert.

**Le bouton « Filtres » vit dans la rangée d'outils** et reste visible tiroir
ouvert : `aria-expanded` dit son état, un second appui referme. Il porte le nombre de
critères posés.

**Sous les outils, une rangée de puces** (`PucesFiltres.svelte`), à la manière des
cartes en ligne : « Frises », six facettes courantes (Protection, Domaine, Type
d'édifice, Région, Département, Architecte), « Zone visible », puis les filtres posés
(`Jetons`, mêmes puces qu'avant, même `.raz`). Cinq points :

- **la rangée défile à l'horizontale**, elle ne s'enroule pas : sa hauteur est fixe, et
  le volet qui s'ouvre dessous (`--hauteur-haut`) ne saute pas à chaque filtre posé ;
- **une puce de facette ouvre un menu** qui reprend la section du tiroir
  (`FacetPanel seules={[cle]}`, remonté par `{#key}` à chaque puce) — même recherche,
  mêmes pilules, mêmes comptes. Le menu vit hors de la rangée, qui le rognerait, en
  `position: fixed` placé sous la puce à l'ouverture. `Échap` le referme et rend le
  focus à la puce ; un toucher à côté aussi ;
- **le menu et le tiroir des filtres s'excluent** : ils montreraient deux fois les mêmes
  options, deux boutons de même nom pour un lecteur d'écran ;
- **les comptes de facette ne partent qu'avec un menu ou le tiroir ouvert** (`puceOuverte`
  rejoint `facettesOuvertes` dans l'effet) ;
- **les facettes rares** — propriété, période non datée, seuil de mobilier — restent dans
  « Filtres » : une puce par critère rarement réglé allongerait la rangée pour rien.

**La frise est un panneau, pas un socle.** Trois décisions tenues ensemble :

- **elle suit le thème.** Le bandeau ardoise dans les deux thèmes a été abandonné : il
  posait une bande sombre sous une page claire, alors que seul le **fond de carte** a
  une raison de rester sombre — le liseré des points et la rampe de densité le
  supposent, une frise ne suppose rien. En clair, `--barre-sourde` (les siècles non
  retenus) doit rester un gris **chaud** et non un gris de texte : sur le calcaire, un
  gris neutre passe pour une barre désactivée ;
- **elle se replie à toutes les largeurs.** Elle s'ouvre depuis le bouton « Frises » de
  la rangée d'outils (`aria-expanded`), se referme par lui ou par sa croix — qui garde
  seule le nom « Masquer les frises » : deux boutons de même nom seraient
  indiscernables ;
- **les deux axes répondent aux mêmes gestes** : clic pour une valeur, glissement pour
  une plage, et recliquer la même valeur l'efface.

**Les deux frises ont désormais un chemin clavier complet**, sur le même
`role="application"` que le pointeur. Les flèches gauche/droite déplacent un curseur
(par siècle pour l'axe des époques — une échelle à bandes, l'index avance dans les
données affichées, pas par arithmétique sur le siècle — par année pour l'axe des
protections), `Début`/`Fin` vont aux extrémités, `Entrée`/`Espace` rejouent
`basculerAnnee`/`onsiecle` (sélectionner ou désélectionner la valeur focalisée, comme
un clic), et `Majuscule`+flèche étend une plage depuis une ancre posée au premier
appui, en rejouant `appliquerPlageAnnees`/`appliquerPlageSiecles` à chaque pas — mêmes
fonctions que le pointeur, aucun nouveau chemin vers les filtres. Le curseur est un
calque Svelte de plus (`.curseur-clavier`), au même titre que le voile de brossage :
jamais une marque Plot, sinon chaque pas clavier reconstruirait le graphique ; un
`<span class="lecteur-seul" aria-live="polite">` annonce la valeur focalisée et son
effectif pour un lecteur d'écran. `role="application"` reste le rôle le plus honnête
ici — l'a11y-lint de Svelte ne le reconnaît pas comme « interactif » pour autoriser
`tabindex`/`onkeydown`, d'où les `svelte-ignore` qui les accompagnent, mais c'est
précisément ce que ce rôle signifie à un lecteur d'écran : gérer soi-même les touches.

**Chaque frise mesure sa propre colonne.** Les deux graphiques partageaient la largeur
observée sur la première piste : celle des années, qui occupe 1,6 fois la colonne de
gauche, était donc **dessinée à la largeur de sa voisine** et laissait un tiers de sa
place vide à droite — l'espace où logeaient justement les bornes. Un `ResizeObserver`
observe désormais les deux boîtes, et `.piste` porte `min-width: 0` : sans lui un
élément de grille prend la largeur de son contenu, et un graphique dimensionné sur la
mesure entretiendrait sa propre croissance. Le test compare boîte et SVG, à 4 px près.

**`replaceChildren` efface tout, y compris ce que Svelte a rendu.** Le voile de
brossage vivait dans le même `<div>` que le graphique : chaque rafraîchissement des
données le supprimait avec l'ancre où Svelte le réinsère, si bien qu'un lien portant
`annees=` arrivait sans voile et qu'il ne revenait plus. La toile est désormais un
nœud à part (`.toile`), enfant du même conteneur positionné : Plot y règne, Svelte rend
le voile et le curseur clavier à côté.

**`echelleX` est réactif, `inverseX` non.** Le premier est lu par l'aperçu de brossage,
qui doit se redessiner dès que le graphique est reconstruit : en simple `let`, un lien
portant `annees=` arrivait **sans son voile**, l'échelle étant encore nulle au premier
calcul de `$derived`. Le second n'est lu que dans un gestionnaire d'événement, donc
toujours après. Invisible tant que les bornes affichaient la plage en chiffres.

**Un seul volet pour ce qu'on lit : la liste, la fiche, les filtres** (`.volet`).
Au large, une colonne sous le bloc du haut, de la même largeur ; sur téléphone, la
feuille du bas. Quatre points à ne pas défaire :

- **un seul contenu à la fois, par priorité** : la fiche devant les filtres, les filtres
  devant la liste (`contenu`, dérivé de `selection`, `facettesOuvertes` et `vue`).
  Refermer l'un découvre le suivant — c'est le « retour » des cartes en ligne, sans pile
  à tenir. Ouvrir les filtres referme la fiche ;
- **ce que le volet ne montre pas porte `hidden`** : ni visible, ni atteignable au
  clavier. Le tiroir fermé gardait douze arrêts de tabulation, translaté hors de la
  scène. `.volet [hidden]` redit `display: none !important`, sans quoi le `display` d'une
  classe l'emporte ;
- **c'est un calque**, jamais une colonne de grille : l'ouvrir ne redimensionne pas le
  canevas WebGL (`01-amorcage-et-donnees.spec.ts` le mesure). La carte reçoit ce qu'il
  masque par `marges` (cf. `docs/conception-carte.md`, « Caméra ») : un point choisi
  dessous est ramené à côté ;
- **le fond est porté par le volet**, jamais par ce qui défile dedans (`.fiche`, le
  `.panneau` des facettes, la liste) ; l'en-tête de la liste est hors de ce qui défile,
  plus en `sticky` dedans. Un élément opaque dans un conteneur défilant, sous la
  feuille translatée du téléphone, fait croire au compositeur de Chromium qu'il masque
  la carte là où il serait sans la translation — cf. `docs/contraintes.md`.

`MonumentMap`, `Calques` et `Legende` lisent `--marge-gauche` (le volet ouvert au
large) et `--reserve-bas` (la feuille repliée sur téléphone), posées par la page : aucun
n'a à connaître le volet.

Pas de `backdrop-filter` sur ces calques : un flou plein écran au-dessus d'un canevas
WebGL se paie à chaque image.

**Le focus suit les calques qu'un geste ouvre, jamais ceux qu'un permalien pose.**
`ouvrirFiche`/`fermerFiche`/`ouvrirTiroir`/`fermerTiroir` (`+page.svelte`) déplacent le
focus dans le calque qu'ils ouvrent et le restituent à sa fermeture — la fiche capture
le foyer courant avant de s'ouvrir (elle a trois points d'entrée : carte, liste, « au
hasard » ; le tiroir n'en a qu'un, son bouton flottant, inutile à capturer puisqu'il
réapparaît à l'identique). Seul un geste utilisateur appelle ces fonctions : un
permalien qui pose `selection` directement, ou l'effet de lecture d'URL (retour arrière
compris), ne déplace jamais le focus — rouvrir un lien ne doit pas voler le focus d'un
lecteur d'écran qui n'a rien demandé. Si le foyer d'origine a disparu (un filtre qui
retire la ligne de liste visée), le repli se fait sur la carte plutôt que nulle part.

**Fermer la fiche rend le focus après `tick`** : la ligne de liste qui l'avait ouverte
était masquée (`hidden`) sous la fiche, et un élément masqué ne prend pas le focus.

**Ces `focus()` portent tous `preventScroll: true`, et ce n'est pas une précaution.**
Un calque est encore translaté hors de la scène à l'instant où il reçoit le focus ; le
navigateur fait alors défiler `.scene` pour l'amener à l'écran — `overflow: hidden`
masque la barre de défilement, pas le défilement. Sur téléphone, ouvrir une fiche au
doigt décalait la scène de 354 px : la feuille en aperçu couvrait tout l'écran et la
carte sortait du champ, alors que ses classes disaient « aperçu ». Par permalien, sans
focus, tout était juste. `09-mobile.spec.ts` vérifie désormais la **position**
(`scrollTop` de la scène, part laissée au-dessus de la feuille), plus seulement les
classes.

**Un seul écouteur `Échap` global**, posé sur `window` (`surEchap`), ferme le calque le
plus haut avec les mêmes fonctions que sa croix — le panneau des calques, puis la fiche,
puis les filtres, puis la liste. Convention partagée avec les
composants qui gèrent `Échap` localement (le panneau des calques, par
exemple) : ils appellent `event.preventDefault()`, et l'écouteur global ignore tout
événement déjà traité. Un champ de texte non vide se vide au premier `Échap` —
comportement natif des `<input type="search">` du produit — la fermeture d'un calque
n'intervient qu'au passage suivant.

**`inert` est posé depuis `+page.svelte`, jamais par les composants qu'il couvre.** Seul
calque modal désormais : le volet **déplié sur téléphone**. Le texte qui suit décrit
l'ancien tiroir ; le principe tient. Sur
gabarit étroit, quand un calque devient modal (fiche ouverte, ou tiroir ouvert), tout ce
qui n'est pas ce calque — la carte, la frise, appartenant chacune à un autre
composant — reçoit `inert` depuis l'extérieur, par sélection DOM sur les enfants de
`.scene` et quelques éléments hors scène. Le voile bloque déjà le pointeur ; `inert`
bloque le clavier, que le voile ne couvre pas, sans qu'aucun composant n'ait à savoir
qu'il peut être rendu inerte. Le même effet rend inerte **le tiroir fermé, à toutes
les largeurs** : translaté hors de la scène, il gardait douze arrêts de tabulation
invisibles, annoncés par un lecteur d'écran.

**`<title>` est dynamique**, posé par `<svelte:head>` dans `+page.svelte` :
`{titre} — Mérimée` quand une fiche est ouverte, `Mérimée — monuments historiques`
sinon. `DetailPanel` remonte le titre de la notice chargée par un callback (`ontitre`)
plutôt que de poser lui-même la balise — la page ne charge pas la notice, seul le
panneau la connaît.

**Deux états vides ont leur propre surface**, `.vide-liste` et `.vide-carte` : un
filtre qui ne retient aucune notice ne doit pas laisser une liste ou une carte
silencieusement blanches. Les deux portent le même message et le même bouton
« Effacer les filtres », dans la même famille visuelle que `.amorce`/`.erreur`. En mode
recherche plein texte, `.vide-liste` ne répète pas le message : `.portee` dit déjà
pourquoi (le plafond structurel des 24 819 notices indexées, et les mots que le
lexique ignore, cf. `docs/conception-donnees.md`) — seul le bouton s'ajoute.

**`.avis` dit un geste resté sans effet**, en haut de la scène, et s'efface seul après
cinq secondes (`role="status"`). Même surface que `.alerte-position`, sans bouton.
Premier porteur : « Au hasard » sous un filtre qui ne garde aucune notice.

**`Timeline` est chargée en `import()` dynamique, pas importée statiquement.** Elle
porte Observable Plot (209 Ko minifié, ~65 Ko gzip), qui partait jusque-là dans le
chunk unique de la page — 1,33 Mo / 378 Ko gzip, chargé avant même que `boot()` de
`duckdb.ts` puisse commencer — alors que la frise est **fermée par défaut**.
`+page.svelte` déclenche l'`import()` par effet (`friseOuverte`) et garde le composant
à `null` le temps du téléchargement. Un emplacement réservé évite un bond de mise en
page pendant ce court chargement : `.frise-attente` reprend la hauteur mesurée du
panneau réel aux deux gabarits (168 px large, 317 px sous 900 px) — directement sur le
panneau, pas déduite de ses paddings.

**Le nom accessible d'une puce porte l'action, pas la valeur** (`aria-label="Retirer le
filtre architecture militaire"`). Sinon la puce et l'option de même libellé dans le
panneau de facettes deviennent deux boutons indiscernables, pour un lecteur d'écran
comme pour Playwright en mode strict. « Copier le lien » a suivi la règle inverse :
il n'existe plus qu'au singulier, dans la fiche, parce qu'un permalien sans notice
n'est qu'une copie de la barre d'adresse.

**Le thème n'est pas dans l'URL.** C'est une préférence de lecture, pas un état
d'exploration : elle vit dans `localStorage` et un lien partagé s'ouvre dans le thème
de celui qui le reçoit. Même règle que les tiroirs du gabarit téléphone. Un script
inline en tête d'`app.html` pose `data-theme` avant le premier paint — sans lui le
site est prérendu en sombre puis bascule à l'hydratation.

**Les cibles se touchent au doigt sans que les pilules grossissent.** Le produit
assume sa densité, et WCAG 2.5.5 demande 44 px : `app.css` porte donc deux classes,
`.frappe-44` et `.frappe-44-v`, qui posent un `::after` transparent centré. La pilule
garde sa taille, son fond et son filet ; seule la surface qui répond au doigt s'étend.
Quatre points à ne pas défaire :

- **`-v` étend la hauteur seule, et ce n'est pas un raffinement.** Sur des boutons en
  rang — la bascule Carte / Liste, les puces de filtres,
  les deux fonds historiques — deux zones de 44 px se recouvriraient latéralement, et le
  dernier dans l'ordre du DOM prendrait le clic de son voisin ;
- **trois éléments n'ont pas pu la recevoir.** Un `<input>` n'accepte pas de
  pseudo-élément : le champ de recherche monte donc à **44 px réels**, et `.cible` et
  `.hasard` le suivent, sinon le groupe médian se désaligne. Le zoom MapLibre non plus —
  `.maplibregl-ctrl-group` porte `overflow: hidden`, qui rognerait la zone — d'où deux
  boutons de **44 px réels**, et la conséquence ci-dessous ;
- **les pilules d'options des facettes restent à 30 px**, délibérément. Ce sont des
  cibles en grille, elles passent le seuil AA de WCAG 2.2 (24 px), et les porter à 44
  changerait la densité du tiroir. L'attribution MapLibre reste à 11 px pour une autre
  raison : l'agrandir la ferait monter vers la légende, dont un test garde la
  **disjonction géométrique**.

**Trois niveaux de gris utiles en clair, quatre en sombre.** `--texte-tenu` valait
2,48:1 sur `--carte-terre` et portait une trentaine de textes courants — sous-titre de la
marque, mot « notices », comptes de facette, texte de substitution des champs, lieu et
crédit de la fiche. Le mettre en conformité (#6e695f, 4,54:1) le rapproche de
`--texte-faible` au point que la hiérarchie claire compte désormais **trois** niveaux
lisibles. C'est assumé : sur des fonds à 95 % de clarté, AA ne laisse pas la place à un
quatrième. En sombre l'écart tient (#8a8680 contre #a5a09a). Ne pas « rétablir » le
quatrième niveau en éclaircissant : il n'y a pas de place pour lui.

**`.cible:hover` porte `:not(.actif)`, et c'est ce qui rend le bouton lisible.** Sans
lui le sélecteur pèse (0,4,0) contre (0,3,0) pour `.cible.actif` : sa `color` gagne, le
`background` de l'état actif reste, et comme `--texte` **vaut exactement** `--plein-fond`
dans les deux thèmes, le libellé disparaît dans son propre fond — mesuré à 1,00:1. Au
pointeur fin le texte revient dès que la souris s'écarte ; au tactile le `:hover` reste
collé et la pastille reste vide. C'est le seul endroit du produit où une règle de survol
écrase une règle d'état ; un balayage des paires `:hover` / `.actif` n'en trouve pas
d'autre.

**Le pointeur Playwright fausse un audit visuel.** Il reste où le dernier geste l'a
laissé, donc la capture et le relevé portent un `:hover` figé. Quatre lecteurs de la
première passe en ont conclu qu'un jeton de couleur était faux, alors que c'était le
survol. `audit-visuel.mjs` écarte donc la souris avant chaque capture. Même piège pour
les cibles : `getBoundingClientRect` ne voit ni le `::after` d'une zone étendue ni le
`<label>` qui reçoit le clic d'une case — le relevé interroge les deux, sans quoi il
continuerait à signaler 19 px là où le doigt en a 44.

**Tout `:hover` vit sous `@media (hover: hover) and (pointer: fine)`.** Sans cette
garde, la règle reste collée au tactile jusqu'au tap suivant — un bouton qui semble
encore survolé après qu'on l'a quitté du doigt. `11-sources.spec.ts` relit tous les
`.svelte`/`.css` de `src/` et vérifie que chaque `:hover` est bien à l'intérieur d'un
tel bloc `@media`, par comptage d'accolades sur le texte source (après avoir neutralisé
les commentaires) ; le même fichier vérifie qu'aucune couleur n'est écrite en dur hors
`app.css` (`#` suivi de six caractères hexadécimaux), avec `theme.svelte.ts` pour seule
exception documentée — sa palette de repli, nécessaire au rendu préalable qui n'a pas de
document à interroger. `photo.ts` et `carte/fonds.ts`, extraits cette session, n'ont
besoin d'aucune exception supplémentaire : le parcours est déjà récursif sur tout
`src/`.

**Toute couleur vit dans `app.css`, pour une raison plus profonde que le style : MapLibre
et Plot ne savent pas lire une `var()`.** `theme.svelte.ts` relit les jetons par
`getComputedStyle` à chaque bascule de thème et les expose dans `palette`. Une couleur
écrite en dur dans un composant resterait muette au changement de thème — il n'en reste
aucune, cf. le test ci-dessus. Deux conséquences moins évidentes du même principe :

- **la loupe des champs de recherche est un jeton**, `--icone-recherche`. Un `<input>`
  n'accepte pas de pseudo-élément : l'image de fond est le seul chemin, et le trait du
  SVG est une couleur — laissée dans le composant, elle serait restée gris sombre sur
  fond sombre ;
- **l'aplat plein s'inverse avec le thème** (`--plein-fond` / `--plein-texte`). En clair
  c'est l'ardoise sur calcaire ; en sombre l'ardoise **est** le fond, et un aplat ardoise
  sur fond sombre ne se voit plus. Il ne reste qu'un porteur, `.cible.actif` — le bouton
  qui annonce que la recherche vise les historiques. Le bouton « Filtres », qui l'a
  porté, s'en est détaché : posé sur la carte et non sur l'interface, il lui faut une
  surface, pas une inversion.

**Le zoom par double-tap se neutralise à la racine** (`html { touch-action:
manipulation }`), pas sur `button` et `a` seulement : c'est un geste de la fenêtre, et
un double-tap sur le texte d'une fiche zoomait la page entière, carte comprise. Le
pincement reste permis hors de la carte — c'est le seul agrandissement du texte qu'un
téléphone offre.

**`<meta name="theme-color">` est posée par `theme.svelte.ts`**, depuis `--fond-carte` :
la barre du navigateur mobile suit le thème **choisi**, pas celui du système, et la
couleur reste dans `app.css`. La balise d'`app.html` est vide à dessein.

**Trois défauts mobiles n'ont rien à voir avec les requêtes.** Ils se tenaient et se
corrigent ensemble :

- **`height: 100dvh`, avec `100vh` en repli.** `vh` compte la bande que la barre
  d'adresse recouvre : à son repli pendant un défilement, la scène changeait de hauteur,
  ce qui redimensionnait le canevas WebGL **et** reconstruisait les graphiques Plot ;
- **`overscroll-behavior: contain`** sur les quatre conteneurs défilants — liste, tiroir
  de facettes, sa liste d'options imbriquée, fiche. Sans lui, tirer vers le bas en haut
  de l'un d'eux remonte au navigateur et déclenche le pull-to-refresh : **rechargement
  complet du wasm et perte de l'exploration en cours** ;
- **le `ResizeObserver` de la frise ne retient qu'une mesure par image.** Chaque mesure retenue reconstruit intégralement le graphique
  (`Plot.plot()` puis `replaceChildren`), pas seulement son échelle.

**`.scene` porte `overflow: clip`, pas seulement `hidden`.** `hidden` masque la barre
de défilement mais laisse la scène défilable par programme : un `focus()` ou un
`scrollIntoView` vers un calque encore translaté la décalait de 354 px, carte comprise
(cf. `preventScroll` plus haut). `clip` n'en fait pas un conteneur de défilement du
tout ; `hidden` reste écrit avant lui, en repli.

**Le fond de la fiche est porté par `.fiche-hote`, jamais par `.fiche` qui défile.**
Mesuré en Chromium : un conteneur défilant **opaque** sous un parent translaté fait
croire au compositeur qu'il masque le canevas à l'endroit où il serait **sans** la
translation. En feuille d'aperçu, toute une bande en haut de la carte n'était plus
dessinée — un aplat couleur de terre, de la largeur de la fiche et de la hauteur de sa
part visible. Le défaut figurait déjà dans les captures d'audit
(`carte_mobile_*_fiche.png`). Déplacer le fond sur le calque hôte, qui ne défile pas,
suffit ; rendre `.fiche` non défilante ou à peine translucide aussi, mais ce sont des
contorsions. `14-camera.spec.ts` vérifie les deux fonds. Cf. `docs/contraintes.md`
pour la méthode de mesure — une capture découpée (`clip`) ne montre **pas** le défaut.

**Sur téléphone, la feuille ouverte efface la légende** (`--legende-visibilite`,
posée par la page) : elle serait dessous, et garderait ses boutons dans l'ordre de
tabulation.

**La fiche en feuille ne défilait pas, et la cause était la grille.** `.fiche-hote`
héritait de `.colonne` un `display: grid`, et le gabarit téléphone ne lui donnait qu'un
`max-height: 82%`. Sa hauteur restait donc **indéfinie** : la rangée implicite de la
grille prenait toute la hauteur du contenu, `overflow: hidden` rognait le bas, et
`.fiche` n'avait jamais rien à faire défiler — la moitié de la notice était
inatteignable. Sur ordinateur, `inset: 12px` donne une hauteur définie : le défaut ne
s'y voyait pas. Correctif : **hauteur définie** (`calc(100% - 8px)`) et flex colonne,
l'enfant en `min-height: 0`. Ne pas revenir à un `max-height` : c'est lui qui rend la
hauteur indéfinie. `09-mobile.spec.ts` vérifie que la dernière section est atteignable.

**Sur téléphone, le volet est une feuille à trois crans.** Repliée (`REPLIEE`, 68 px :
la poignée et « Liste des notices »), aperçu, dépliée. Poignée en tête, 44 px réels : un
toucher bascule — repliée, il montre la liste —, un glissement suit le doigt, tirer d'un
quart sous l'aperçu referme le contenu ; au clavier, Entrée bascule (`click` de `detail`
nul). Cinq points à ne pas défaire :

- **les crans passent par `transform`, jamais par la hauteur** : la hauteur définie est
  ce qui fait défiler la fiche, et la translater ne provoque aucun reflow.
  `PART_CACHEE` (0,55, script) et `translateY(55%)` (style) doivent rester égaux, comme
  `REPLIEE` et `--feuille-repliee` ;
- **l'aperçu n'est pas modal.** `calqueModal` ne vaut `'volet'` qu'en `plein` : l'aperçu
  laisse 55 % de carte au-dessus de lui, et c'est tout son intérêt — toucher le monument
  voisin sans refermer. Déplié, le volet couvre l'écran et redevient modal (`inert`) ;
- **un défilement en aperçu déplie** (`ondefile` de `DetailPanel` et de
  `ListeResultats`) : on ne lit pas un historique dans 45 % d'écran ;
- **la photographie est bornée à 20dvh en aperçu**, sinon elle remplit toute la part
  visible et le titre reste sous le bord ;
- **la carte ramène le point choisi au-dessus de la feuille** (`marges.bottom`),
  seulement s'il tombe dessous, sans `essential: true`.

**Plus d'onglets au pied.** La feuille porte la liste ; « Frises » et « Filtres » sont
dans la rangée d'outils du haut, la bascule Carte / Liste y est masquée. Les surfaces du
pied — légende, vignette des calques, attribution — se posent au-dessus de la feuille
repliée (`--reserve-bas`) et s'effacent quand elle monte (`--legende-visibilite`,
posée par `main.volet-ouvert`).

**Les champs de saisie montent à 16 px au doigt** (`@media (pointer: coarse)`),
recherche de la barre et recherche de facette. Sous 16 px, Safari iOS zoome la page
entière à la mise au point et ne dézoome pas en sortant. La souris garde la densité.

**Sur téléphone, la légende et la vignette des calques se partagent le pied de la
carte** : la vignette à gauche (56 px), la légende dans la largeur qui reste. Le panneau
des calques y devient une feuille basse pleine largeur. Les réglages d'affichage ont
quitté la légende — plus de pastille « réglages » à déplier.

**Les jetons `--sa-*` (`--sa-haut`, `--sa-bas`, `--sa-gauche`, `--sa-droite`) portent les
bordures physiques de l'écran sur iOS** — encoche, coins arrondis, barre d'accueil du
bas — lues depuis `env(safe-area-inset-*, 0px)`. Ils valent 0 partout ailleurs, donc ne
changent rien hors iOS ni sur les éléments qui ne touchent aucun bord physique : la
barre (haut et côtés), le tiroir des filtres (gauche et bas), la fiche en feuille pleine
largeur (bas), le pied de page (bas). `viewport-fit=cover` dans `app.html` est la
condition pour que ces `env()` rendent autre chose que 0 : sans lui, la page ne
s'étend pas sous les zones physiques et `safe-area-inset-*` reste nul.

**`<noscript>` affiche un message plutôt qu'une page blanche.** Le site interroge
DuckDB dans le navigateur : sans JavaScript, rien ne peut s'afficher. Le message ne vit
que dans `app.html`, jamais visible autrement — sa couleur reste tout de même un jeton
(`.noscript` dans `app.css`), comme partout ailleurs.

**`prefers-reduced-motion: reduce` réduit les durées partagées à quasi zéro**, dans
`app.css` : `--t-rapide` et `--t-tiroir` tombent à 0,01 ms sous cette requête, et toute
transition/animation résiduelle — y compris celles écrites en dur dans les composants,
hors de ces jetons — est neutralisée au même endroit par une règle générique
(`*, *::before, *::after`). MapLibre respecte nativement cette préférence pour
`flyTo`/`easeTo`/`fitBounds` — il lit `matchMedia('(prefers-reduced-motion: reduce)')`
lui-même à chaque appel — sauf si `essential: true` est passé. Les déplacements
animés de `MonumentMap.svelte` — rapprochement sur un amas touché, cadrage du contrôle
de géolocalisation, recentrage d'un point passé sous un panneau, rapprochement depuis
la liste, vol de « Au hasard » (cf. `docs/conception-carte.md`, « Caméra ») — **ne
passent jamais `essential: true`**, le contrôle natif non plus (vérifié dans sa
source, 4.7.1). Sous mouvement réduit, le vol devient un saut et la fiche s'ouvre
aussitôt ; `14-camera.spec.ts` le vérifie avec `reducedMotion: 'reduce'`.

**Des pastilles de filtrage rapide dans la fiche, portées par `fiche.auteurs`
(cf. `docs/conception-donnees.md`).** Un clic sur un auteur l'ajoute au filtre courant
— jamais ne le retire, ce n'est pas une case à cocher, juste un raccourci vers le
tiroir des facettes. Elles vivent à côté d'`auteurs_detail`, qui garde la forme brute
du champ source (rôle compris) : les pastilles visent la liste consolidée qu'utilise
déjà la facette, pas une redite de la mention complète.

**Le cadrage des photographies est extrait dans `lib/photo.ts`**, pur : géométrie du
cadre (`cadre()`, `estRecadree()`, bornes `CADRE_MIN`/`CADRE_MAX`), conversion d'un
glissement en `object-position` (`glisserCadrage()`), et dépouillement du HTML que
rend l'API Commons (`texteNu()`, `extraireCredit()`). `DetailPanel.svelte` garde les
gestionnaires DOM/pointeur et l'état ARIA ; ce fichier ne connaît ni le pointeur, ni le
DOM au-delà d'un `DOMParser`. Les règles de cadrage elles-mêmes (bornes 0,68/1,9, mesure
sur 240 fichiers) sont dans `docs/conception-photographies.md`.

**`nf` (`Intl.NumberFormat('fr-FR')`) est importé de `lib/format.ts`**, plutôt que
recréé dans chaque composant qui affiche un compte — `+page.svelte` et `FacetPanel`
le partageaient déjà en double avant cette extraction, comme `romain`.

**Le libellé d'une section de facette vit dans `.nom-section`.** Un nœud de plus, pour
une raison de mise en page : `.titre` est un flex à quatre enfants, et deux
`margin-left: auto` concurrents (badge de sélection, cardinalité) se partageraient
l'espace au lieu de tout pousser à droite. Conséquence à connaître : le `:text()` de
Playwright vise le **plus petit** élément contenant le texte, donc les sélecteurs de la
suite e2e (`02-facettes-et-filtres.spec.ts` notamment) ciblent `.nom-section`, plus
`button.titre`.
