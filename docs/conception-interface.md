# Règles de conception — interface

Déplacé de `CLAUDE.md`. Couvre `+page.svelte`, `app.css`, `app.html`, et les
composants `FacetPanel`, `Jetons`, `Timeline`, `Matrice`, `DetailPanel`. Lire
cette page avant de toucher à la mise en page, au focus, au clavier ou à
l'accessibilité.

**La barre porte trois blocs, et le groupe médian est centré par ses flancs.**
`marque` et `chiffres` portent `flex: 1 1 0` : ils se partagent à parts égales ce que
le groupe médian laisse, donc celui-ci tombe au milieu sans qu'aucune largeur ne soit
écrite. Quatre points à ne pas défaire :

- **`.centre-barre` déclare une base (`flex: 0 1 700px`), pas `auto`.** La contribution
  max-content d'un conteneur flex imbriqué ne reprend pas la base de ses enfants : avec
  `auto`, le champ retombait à 197 px, une vingtaine de caractères entre ses deux
  boutons. Mesuré, pas déduit ;
- **la marque tient sur deux lignes** — le titre, puis sa signature. Sous 1320 px les
  dates cèdent avant le sous-titre : la part de chaque flanc passe alors sous la largeur
  de la signature complète, et les dates se relisent dans la frise ;
- **un seul compteur.** Le total suit les filtres et répond à « combien en reste-t-il ».
  Classés, inscrits et objets se lisent dans la facette « statut », qui les donne déjà
  croisés — les répéter dans la barre était une triple lecture du même état. Le bloc
  `.chiffres` porte `aria-live="polite"` et `aria-atomic="true"` : c'est le compte qui
  doit être relu au changement de filtre, pas toute la barre, et `aria-atomic` fait
  relire le nombre entier plutôt que le seul chiffre modifié — ce texte vivait
  auparavant sur la fiche (`aside.fiche aria-live="polite"`), où il annonçait une
  notice entière à chaque ouverture, y compris son contenu déjà lu par le focus qui
  s'y déplace (cf. plus bas) ;
- **le thème est une pastille sans libellé** (soleil / lune), et son nom accessible
  reste `Clair` / `Sombre` : l'icône dit la destination, l'`aria-label` la nomme. Le
  trait des deux SVG est `currentColor`, sinon la règle « toute couleur vit dans
  `app.css` » tomberait avec eux.

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

**Le bouton « Filtres » vit au coin de la carte, pas dans la barre.** Il se pose là où
le tiroir s'ouvre et **s'efface tant qu'il est ouvert** : la croix de l'en-tête du
tiroir est alors le seul geste de fermeture, et le bouton revient avec elle. Deux
conséquences :

- **z-index 4**, au-dessus de la liste et de la matrice (3), qui recouvrent la scène et
  pour lesquelles les filtres comptent autant, mais sous le voile (5) et le tiroir (6) ;
- **son empreinte est une variable héritée**, `--reserve-filtres`, posée par la scène et
  lue par le titre de la liste et par celui de la matrice. Même procédé que
  `--marge-gauche` pour les commandes MapLibre : ni la liste ni la matrice n'ont à
  connaître l'existence de ce bouton. Elle tombe à zéro quand le tiroir est ouvert, et
  sur gabarit étroit, où le bouton passe **au-dessus** du titre et non à côté ;
- **c'est une surface posée, pas un aplat plein.** Le fond de carte suit désormais le
  thème, mais cela ne change rien ici : le bouton appartient à l'interface et suit le
  thème comme la légende, calcaire en clair, ardoise en sombre, détaché de la carte par
  son filet (`--bord-flottant`) et son ombre. En aplat inversé (`--plein-fond`), il
  était noir sur une carte noire en sombre, et il serait ardoise sur du grège en clair :
  dans les deux cas un trou, jamais une commande.

**La frise est un panneau, pas un socle.** Trois décisions tenues ensemble :

- **elle suit le thème.** Le bandeau ardoise dans les deux thèmes a été abandonné : il
  posait une bande sombre sous une page claire, alors que seul le **fond de carte** a
  une raison de rester sombre — le liseré des points et la rampe de densité le
  supposent, une frise ne suppose rien. En clair, `--barre-sourde` (les siècles non
  retenus) doit rester un gris **chaud** et non un gris de texte : sur le calcaire, un
  gris neutre passe pour une barre désactivée ;
- **elle se replie à toutes les largeurs**, plus seulement sur téléphone. Même
  dispositif que le tiroir des facettes : la croix est dans le panneau, et le bandeau
  qui le rouvre prend sa place — il ne coûte sa hauteur que lorsque la frise est partie ;
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

**Les deux panneaux sont des calques, pas des colonnes.** Le tiroir des facettes et la
fiche flottent au-dessus de la carte (`position: absolute` dans `.scene`), et non plus
dans une grille `246px | 1fr | 340px` qui compressait le canevas en permanence — 340 px
étaient réservés pour afficher « Sélectionnez un point ». Trois conséquences à ne pas
défaire :

- **les ouvrir ne redimensionne pas le canevas WebGL.** C'est la raison d'être du choix.
  `le tiroir ne prend pas de largeur à la carte` le mesure, avant/après, en pixels ;
- **MapLibre ne redimensionne pas son canevas tout seul.** La bande de puces qui
  apparaît au premier filtre change la hauteur de la scène : `MonumentMap` porte donc un
  `ResizeObserver` → `map.resize()`. Sans lui la carte reste dessinée à l'ancienne taille
  et décalée du pointeur ;
- **les commandes MapLibre doivent s'écarter des calques.** L'attribution CARTO est
  posée à la main (`attributionControl: false` puis `addControl(...)`) : une mention de
  licence masquée n'est pas une mention. Elle a d'abord fui la droite, que la fiche
  recouvrait, pour le **bas à gauche** — où sa pastille « i » s'est mise à chevaucher la
  légende. Elle est donc **revenue en bas à droite**, cette fois derrière
  `--marge-droite`, la même variable qui écarte le zoom : la fiche ne la recouvre plus.
  Un test le verrouille par la **géométrie** — les boîtes de l'attribution et de la
  légende doivent être disjointes — et non par la lecture d'une règle CSS. Les marges
  sont posées par la page ; le composant carte n'a pas à connaître l'existence d'un
  panneau de facettes.

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

**Un seul écouteur `Échap` global**, posé sur `window` (`surEchap`), ferme le calque le
plus haut avec les mêmes fonctions que sa croix. Convention partagée avec les
composants qui gèrent `Échap` localement (le module des cartes anciennes, par
exemple) : ils appellent `event.preventDefault()`, et l'écouteur global ignore tout
événement déjà traité. Un champ de texte non vide se vide au premier `Échap` —
comportement natif des `<input type="search">` du produit — la fermeture d'un calque
n'intervient qu'au passage suivant.

**`inert` est posé depuis `+page.svelte`, jamais par les composants qu'il couvre.** Sur
gabarit étroit, quand un calque devient modal (fiche ouverte, ou tiroir ouvert), tout ce
qui n'est pas ce calque — la carte, la matrice, la frise, appartenant chacune à un autre
composant — reçoit `inert` depuis l'extérieur, par sélection DOM sur les enfants de
`.scene` et quelques éléments hors scène. Le voile bloque déjà le pointeur ; `inert`
bloque le clavier, que le voile ne couvre pas, sans qu'aucun composant n'ait à savoir
qu'il peut être rendu inerte.

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

**`Timeline` et `Matrice` sont chargés en `import()` dynamique, pas importés
statiquement.** Les deux portent Observable Plot (209 Ko minifié, ~65 Ko gzip), et
partaient jusque-là dans le chunk unique de la page — 1,33 Mo / 378 Ko gzip, chargé
avant même que `boot()` de `duckdb.ts` puisse commencer — alors que la frise est
**fermée par défaut** sous 900 px et que la matrice n'est qu'une des trois vues.
`+page.svelte` déclenche l'`import()` par effet (`friseOuverte` pour `Timeline`,
`vue === 'matrice'` pour `Matrice`) et garde le composant à `null` le temps du
téléchargement. Deux emplacements réservés évitent un bond de mise en page pendant
ce court chargement : `.matrice-attente` reprend l'empreinte de `Matrice`
(`position: absolute; inset: 0`), `.frise-attente` reprend la hauteur mesurée du
panneau réel aux deux gabarits (168 px large, 317 px sous 900 px) — directement sur
le panneau, pas déduite de ses paddings.

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
  rang — le rail « statut / époque », les trois onglets de vue, les puces de filtres,
  les deux fonds historiques — deux zones de 44 px se recouvriraient latéralement, et le
  dernier dans l'ordre du DOM prendrait le clic de son voisin ;
- **trois éléments n'ont pas pu la recevoir.** Un `<input>` n'accepte pas de
  pseudo-élément : le champ de recherche monte donc à **44 px réels**, et `.cible` et
  `.hasard` le suivent, sinon le groupe médian se désaligne. Le zoom MapLibre non plus —
  `.maplibregl-ctrl-group` porte `overflow: hidden`, qui rognerait la zone — d'où deux
  boutons de **44 px réels**, et la conséquence ci-dessous ;
- **`top: 108px` sur `.ouvrir-fonds` / `.fonds` suit la hauteur du zoom.** Les deux
  boutons passés de 29 à 44 px, le groupe MapLibre mesure 91 px au lieu de 61 : à 78 px
  le module des cartes anciennes lui rentrait dedans. Changer l'un sans l'autre fait
  chevaucher les deux blocs, et rien ne le signale sinon à l'œil ;
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

**Trois défauts mobiles n'ont rien à voir avec les requêtes.** Ils se tenaient et se
corrigent ensemble :

- **`height: 100dvh`, avec `100vh` en repli.** `vh` compte la bande que la barre
  d'adresse recouvre : à son repli pendant un défilement, la scène changeait de hauteur,
  ce qui redimensionnait le canevas WebGL **et** reconstruisait les graphiques Plot ;
- **`overscroll-behavior: contain`** sur les quatre conteneurs défilants — liste, tiroir
  de facettes, sa liste d'options imbriquée, fiche. Sans lui, tirer vers le bas en haut
  de l'un d'eux remonte au navigateur et déclenche le pull-to-refresh : **rechargement
  complet du wasm et perte de l'exploration en cours** ;
- **le `ResizeObserver` de la frise et celui de la matrice ne retiennent qu'une mesure
  par image.** Chaque mesure retenue reconstruit intégralement le graphique
  (`Plot.plot()` puis `replaceChildren`), pas seulement son échelle.

**La fiche en feuille ne défilait pas, et la cause était la grille.** `.fiche-hote`
héritait de `.colonne` un `display: grid`, et le gabarit téléphone ne lui donnait qu'un
`max-height: 82%`. Sa hauteur restait donc **indéfinie** : la rangée implicite de la
grille prenait toute la hauteur du contenu, `overflow: hidden` rognait le bas, et
`.fiche` n'avait jamais rien à faire défiler — la moitié de la notice était
inatteignable. Sur ordinateur, `inset: 12px` donne une hauteur définie : le défaut ne
s'y voyait pas. Correctif : **hauteur définie** (`calc(100% - 8px)`) et flex colonne,
l'enfant en `min-height: 0`. Ne pas revenir à un `max-height` : c'est lui qui rend la
hauteur indéfinie. `09-mobile.spec.ts` vérifie que la dernière section est atteignable.

**Sur téléphone, la fiche est une feuille à deux crans.** Poignée en tête : un toucher
bascule, un glissement suit le doigt, tirer d'un quart sous l'aperçu ferme ; au clavier,
Entrée bascule (`click` de `detail` nul). Cinq points à ne pas défaire :

- **les crans passent par `transform`, jamais par la hauteur** : la hauteur définie est
  ce qui fait défiler la feuille, et la translater ne provoque aucun reflow.
  `PART_CACHEE` (0,55, script) et `translateY(55%)` (style) doivent rester égaux ;
- **l'aperçu n'est pas modal.** `calqueModal` ne vaut `'fiche'` qu'en `plein` : l'aperçu
  laisse 55 % de carte au-dessus de lui, et c'est tout son intérêt — toucher le monument
  voisin sans refermer. Dépliée, la feuille couvre l'écran et redevient modale (`inert`) ;
- **un défilement en aperçu déplie** (`ondefile` de `DetailPanel`) : on ne lit pas un
  historique dans 45 % d'écran ;
- **la photographie est bornée à 20dvh en aperçu**, sinon elle remplit toute la part
  visible et le titre reste sous le bord ;
- **la carte ramène le point choisi au-dessus de la feuille** (`reserveBas`), seulement
  s'il tombe dessous, sans `essential: true`.

**Sur téléphone, les vues passent au pied de l'écran.** `.onglets` (Carte / Matrice /
Liste / Frises) remplace `.bascule` et `.replier`, masqués sous 768 px : les vues sous le
pouce, et la barre du haut rendue à la marque, au compteur et à la recherche (≤ 120 px au
lieu d'environ 150). « Au hasard » y devient un dé, nom accessible inchangé. Les onglets
entrent dans la liste `dehors` de l'effet `inert`. Tablette et ordinateur n'en voient
rien — les sélecteurs `.bascule` de la suite e2e restent valables au large.

**Les champs de saisie montent à 16 px au doigt** (`@media (pointer: coarse)`),
recherche de la barre et recherche de facette. Sous 16 px, Safari iOS zoome la page
entière à la mise au point et ne dézoome pas en sortant. La souris garde la densité.

**La légende se replie sur ses clés sur téléphone.** Une pastille « réglages » déplie le
rail statut/époque et la densité ; à cette largeur ils prenaient une seconde rangée en
permanence pour un réglage qu'on touche une fois.

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
lui-même à chaque appel — sauf si `essential: true` est passé. Trois déplacements
animés existent désormais dans `MonumentMap.svelte` : le rapprochement sur un amas
touché, le cadrage du contrôle de géolocalisation, le recentrage sous la feuille de
fiche. **Aucun ne passe `essential: true`**, le contrôle natif non plus (vérifié dans
sa source, 4.7.1). « Au hasard » ouvre toujours une fiche sans toucher au cadrage.

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
