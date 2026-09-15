# Règles de conception — carte

Déplacé de `CLAUDE.md`. Couvre `MonumentMap.svelte`, `lib/carte/fonds.ts`,
`lib/teinte.ts` et `lib/state/carte.svelte.ts`. Lire cette page avant de toucher
au rendu de la carte, à la teinte du fond clair ou aux fonds historiques.

**Les commandes de la carte sont rangées par question.** La légende avait fini en tiroir
fourre-tout : clés de couleur, choix de sémiologie, densité, cartes anciennes, dosage
d'opacité et contrainte de zone dans une seule bande de pilules indifférenciées. Elles
sont désormais séparées par ce qu'elles font :

- **la légende, en bas à gauche**, dit d'abord ce qu'on voit — les clés de couleur, ou
  la rampe quand la densité est active — puis, sous un filet, propose de le changer :
  un rail à deux options (`statut` / `époque`) précédé de son libellé, et la bascule de
  densité. Le rail remplace un bouton unique dont le libellé alternait, et dont on ne
  savait pas s'il annonçait l'état courant ou sa destination ;
- **les cartes anciennes prolongent la colonne d'outils du zoom**, et s'y **replient**
  en une pastille de 31 px, au même bord droit et au même langage graphique que lui.
  C'est un calque posé sous les points, pas une clé de lecture, et on ne s'en sert pas
  en continu. Trois points à ne pas défaire : la pastille **dit qu'un fond est actif**
  (filet ocre), sinon une carte ancienne resterait à l'écran sans commande visible pour
  l'éteindre ; le module **se déplie de lui-même si `fond=` est dans l'URL**, lu une
  seule fois au montage (`untrack`) — le suivre rouvrirait le panneau sous le doigt de
  qui vient de le fermer ; le nom du fond porte sa période en seconde ligne, un `title`
  ne se lisant pas au tactile. Le style commun aux deux fonds passe par `.fonds >
  button` et non `.fonds button`, qui coiffait aussi la croix de l'en-tête. La table
  `HISTORIQUES` et la fonction `tuiles()` vivent dans `lib/carte/fonds.ts`, extrait de
  `MonumentMap.svelte` : le composant reste le seul à poser ces couches, mais leur
  description (identifiants IGN, bornes de zoom, poids par tuile — cf.
  `docs/contraintes.md`) n'a pas besoin de connaître MapLibre ;
- **le zoom de MapLibre suit désormais le thème.** Il restait blanc dans les deux, ce
  qui était sa valeur par défaut ; une pastille blanche au-dessus d'une pastille ardoise
  ne tenait pas. Ses icônes sont des SVG noirs posés en **image de fond** — on ne peut
  pas leur donner un jeton, d'où l'inversion en thème sombre, seul levier disponible ;
- **« limiter à la zone visible » a rejoint le tiroir des filtres.** C'en est un : il
  restreint le corpus, comme une facette, et n'avait rien à faire parmi des commandes
  d'affichage. Conséquence sur l'état, cf. `docs/conception-donnees.md` : `suivreVue` a
  quitté `MonumentMap` pour la page.

**Un toucher vise une boîte, pas un pixel.** L'écouteur de couche MapLibre
(`map.on('click', 'monuments-points')`) ne répond qu'au pixel exact d'un cercle : un
point mesure 1,2 à 4,5 px de rayon jusqu'à z10, et au doigt le toucher relevait du
hasard. Le clic est posé sur la carte entière et interroge une boîte de **±16 px au
doigt, ±6 px à la souris** (`(pointer: coarse)`) — une marge large ferait ouvrir à la
souris le voisin de ce qu'elle pointe. Trois points :

- **on retient le plus proche à l'écran** (`map.project`), pas le premier rendu :
  l'ordre de `queryRenderedFeatures` est celui du dessin ;
- **les références sont dédoublonnées** — une source GeoJSON peut rendre la même entité
  sur deux tuiles voisines ;
- **au doigt, sous z9, plus de trois candidats rapprochent la vue** (+2 niveaux) au lieu
  d'ouvrir une fiche : dans un amas, le plus proche du doigt n'est pas celui qu'on
  voulait.

**La géolocalisation est le contrôle natif de MapLibre**, sous le zoom : point,
cercle de précision, suivi et état de permission sans code à maintenir. Ce qui a été
repris :

- **l'icône devient un masque** peint par un jeton (`--texte-moyen`, `--position` actif,
  `--erreur`) : le SVG natif est coloré en dur, et l'inversion du thème sombre le
  transformait en orange. Elle est donc exclue de cette inversion ;
- **le point et son cercle suivent `--position` / `--position-halo`**, un bleu, seul du
  produit : c'est la convention des cartes de téléphone, et aucune teinte patrimoniale ne
  doit pouvoir passer pour « vous êtes ici ». Sélecteurs préfixés `.maplibregl-map` : la
  feuille de MapLibre et `app.css` n'ont pas d'ordre garanti dans le bundle ;
- **`--haut-fonds` (164 px, 160 sous 900 px) suit les deux groupes** qui précèdent les
  cartes anciennes — zoom 91 px, géolocalisation 46 px, marges. `09-mobile.spec.ts` en
  vérifie la **disjonction géométrique** ;
- **la position écrite par la carte vit dans `state/position.svelte.ts`**, jamais dans
  l'URL ni dans `localStorage` ; l'erreur (refus, indisponible, délai) s'affiche en
  surface au haut de la scène et s'efface seule ;
- libellés traduits par l'option `locale` pour la géolocalisation seulement — ceux du
  zoom restent ceux que l'audit lit déjà.

Les clés de lecture portent `.cle` et non un `span` nu : la légende contient d'autres
`span` depuis qu'elle nomme ses commandes, et le test qui vérifie qu'elle suit le mode
de coloration compte ces clés — trois par statut, cinq par époque.

**La suite e2e a longtemps échoué par intermittence sur `AbortError`, et ce n'était pas
neuf.** Trois vérifications tombaient ensemble dans l'ancien `smoke.mjs` —
`deux bascules rapides ne laissent qu un style`, `le lien rouvre sans erreur et sans
boucle`, `aucune erreur console` — quand MapLibre annulait un chargement de style en
vol. Mesuré en alternance sur la même machine, quatre tours : **origine 124 · 124 ·
123 · 124**, après correctifs **124 · 122 · 127 · 124** : le 127/127 annoncé par
ailleurs était donc le meilleur cas, pas le cas courant. Trois choses ont réduit cette
intermittence depuis :

- **la vérification concernée vit désormais seule dans `05-theme.spec.ts`**, avec son
  propre compteur d'erreurs console différentiel (chaque fichier de `tests/e2e/`
  démarre son propre serveur et journalise ses erreurs en différentiel, cf.
  `CLAUDE.md`) : une erreur survenant dans un autre fichier de la suite ne la fait
  plus échouer, alors qu'elle partageait auparavant un compteur global avec 126
  autres vérifications dans l'ancien `smoke.mjs` ;
- **le chargement d'une photographie attend `img.complete`** (`attendreImageChargee`,
  `tests/e2e/_soutien.ts`) plutôt qu'un délai fixe, dans `06-fiche-et-photos.spec.ts` ;
- **le niveau de zoom de Cassini se lit par sondage** plutôt que par un délai fixe de
  1500 ms, dans `04-carte-et-fonds.spec.ts` (cf. `docs/contraintes.md`).

Avant d'imputer un échec résiduel à une modification, refaire la comparaison en
alternance : le compter sur une seule exécution ne prouve rien.

**Le fond de carte suit le thème, et le clair est repeint.** `FONDS`
(`theme.svelte.ts`) porte deux feuilles CARTO servies sans clé : dark-matter en sombre,
**Positron en clair**. Positron n'est pas pris tel quel — sa terre est presque blanche,
ses routes sont du blanc pur, ses bois sont verts — mais **repeint couche par couche**
par `teinter()` (`lib/teinte.ts`), appelée **en tête de `poserCouches()`, avant tout
`addLayer`** : posée après, elle repeindrait `monuments-points` en couleur de terre.
Palette : terres `#eceae4`, mers `#dce3e8`, frontières et côtes `#c8c4ba`, routes et
bâtiments `#f3f1eb`, libellés `#827e75`. Quatre points à ne pas défaire :

- **la classification va par nature, jamais par identifiant.** `background` → terre,
  `symbol` → libellé, `source-layer` contenant *water* → mer, *boundar* → trait,
  *transportation* → détail. Les identifiants de Positron (`landcover_wood`,
  `boundary_2`) sont une convention de CARTO ; le `source-layer` vient d'OpenMapTiles et
  le `type` de la spécification MapLibre — ces deux-là sont des contrats ;
- **elle se termine sur le `type`, sans branche « je laisse tel quel ».** C'est ce qui
  transforme un renommage chez CARTO en dégradation bénigne au lieu d'une panne muette :
  une couche non reconnue ressort en terre ou en trait, jamais en vert. Cinq des 93
  couches de Positron y tombent déjà (`landcover`, `landuse`, `park`), et c'est voulu —
  la terre est un aplat ;
- **il n'existe pas de couche « côte » dans OpenMapTiles.** Le trait de côte est le bord
  du polygone d'eau, donc `fill-outline-color` sur les couches d'eau. Ce n'est pas un
  raffinement : terre et mer ne sont séparées que par **1,08:1** de luminance, le
  littoral ne tient qu'à ce trait ;
- **le décompte par nature est publié sur `window.__carte`** et `05-theme.spec.ts`
  l'imprime : `terre 6 · mer 3 · trait 4 · libellé 27 · détail 53 · ignorées 0` sur les
  93 couches de Positron. Aucune vérification hors ligne ne peut prouver que la feuille
  **réelle** de CARTO est encore correctement teintée ; ce relevé, lu à chaque passe, est
  le seul dispositif qui signale le contraire.

**Le thème sombre ne bouge pas.** `teinter()` sort immédiatement : dark-matter est déjà
la carte que le projet veut, l'aplatir à l'identique serait deux cents appels pour rien.
Les jetons `--carte-mer`, `--carte-trait`, `--carte-detail` et `--carte-libelle` ne sont
donc **pas lus** en sombre ; seul `--carte-terre` l'est, par `.scene`, pour que l'attente
du chargement soit de la couleur de la carte qui va s'afficher — au montage comme à
chaque bascule. La dissymétrie est voulue, et un test la garde pour qu'on ne la
« corrige » pas en croyant à un oubli.

**Le liseré des points vaut le sol, dans les deux thèmes.** `#101215` en sombre,
`#eceae4` en clair : ce n'est pas une auréole, c'est une **découpe**, qui sépare deux
points qui se touchent sans ajouter d'encre. Le blanc cassé d'avant supposait une carte
noire. Le cerclage de sélection suit la symétrie inverse — le maximum de contraste
contre son sol, `#f2f0ea` en sombre et `#1a1d20` en clair — et surtout pas `--accent`,
qui vaut `--classe` et rendrait la sélection indiscernable d'un point classé.

**Sauf sous un fond historique : le liseré bascule au sombre.** Cassini et l'État-major
sont des aplats beiges clairs — un liseré couleur du sol y disparaît, que ce sol soit
ardoise ou grège. La règle a survécu au passage au clair, sa **raison** a changé :
`--carte-liseret-sur-clair` est substitué dès que la superposition atteint **50 %
d'opacité** (`liseret()`). En clair l'anneau est déjà faible dès 30 % ; on ne descend pas
le seuil pour autant, parce que ce serait une branche sur le thème dans le code alors
que tout le dispositif fait porter la différence par les jetons. La rampe de densité,
elle, n'est pas concernée : **densité et fond historique s'excluent mutuellement**,
l'une agrège, l'autre situe.

**La rampe de densité s'inverse avec le thème**, comme celle de la matrice : en sombre
elle monte vers le crème, en clair elle descend vers le brun, sur les valeurs de
`--matrice-1..4`, déjà éprouvées sur un fond clair. `--chaleur-0` reste **transparent**
dans les deux cas — `heatmap-density` vaut zéro sur toute la surface sans donnée, et un
zéro opaque laverait la vue entière. Elle est réinjectée par l'effet de palette et non
seulement par `poserCouches()` : elle doit suivre le thème par un chemin qui lui est
propre, sans dépendre du fait que la bascule repose les couches. Ce n'était pas le cas,
et cela ne se voyait pas tant que les deux rampes allaient dans le même sens.

**Le liseré des points ne s'ouvre qu'au zoom, l'opacité aussi.** Rayon
`4 → 1,2 · 7 → 1,5 · 10 → 4,5 · 14 → 8`, opacité `4 → 0,42 · 8 → 0,60 · 11 → 0,85`,
largeur de liseré `6 → 0 · 9 → 0,5 · 13 → 1,8`. La maquette donnait le liseré épais dès
le départ, ce qui vaut pour dix pastilles : sur 44 484 points à z4,7, les anneaux se
touchent et la France devient un aplat clair. Quatre points, tous vérifiés à la capture
et non au raisonnement :

- **`circle-stroke-opacity` vaut 1 par défaut et ne suit pas `circle-opacity`.** Un
  remplissage à 0,42 sous un liseré opaque donne des anneaux creux. Les deux portent
  donc la **même** expression ;
- **l'opacité basse ne vaut qu'à l'échelle nationale.** À z5-7 les 44 484 points se
  superposent et l'accumulation par alpha est la seule densité qu'une couche `circle`
  sache produire. Un point isolé n'y ressort qu'à **1,6:1** sur la terre grège ; à z8,
  0,60 le porte à 2,1:1. Un littéral serait plus court et faux ;
- **l'effet de densité doit reposer l'expression, pas un scalaire.** Il posait `0,82` :
  tel quel, la première bascule de densité écraserait l'interpolation par zoom et les
  points redeviendraient opaques à l'échelle nationale, définitivement ;
- **le halo des édifices riches en mobilier a été retiré.** Une couche `circle` de
  26 px à faible alpha, filtrée `nb > 50`, doublait chaque point concerné d'un cercle
  semi-opaque : sur les villes, où ces édifices se groupent, les halos se recouvraient
  et l'agglomérat mangeait la lecture. Le nombre d'objets Palissy reste dit par le
  **rayon** du point lui-même (`nb > 200` élargit de 1,2 à 3 px selon le zoom), qui ne
  se superpose pas. Ne pas la remettre : c'est une surcharge visuelle, pas une clé de
  lecture, et sa seule branche sur le thème — 0,14 en sombre contre 0,07 en clair,
  parce qu'un aplat à faible alpha fait une **lueur** sur fond sombre et une
  **salissure** sur fond clair — est partie avec elle.

**Le mode de fusion « produit » n'existe pas sur une couche `circle`**, et il n'y a rien
à espérer d'un `mix-blend-mode` CSS : il s'appliquerait au **canevas entier**, fond
compris, et ne ferait rien entre les points, qui sont composités à l'intérieur du canevas
avant que CSS n'entre en jeu. L'accumulation se fait donc par alpha, et elle **sature** :
1 − (1 − 0,42)^N vaut 0,42 · 0,66 · 0,80 · 0,89 · 0,93 · 0,96 — au-delà de six
recouvrements, Paris et un bourg à sept monuments rendent le même aplat. Un produit, lui,
assombrit sans borne. La couche qui fait ce travail existe déjà : `heatmap` accumule dans
une texture et passe le total dans une rampe choisie. **L'accumulation par alpha donne le
grain, la heatmap donne la quantité ; ne pas demander à l'une le travail de l'autre.**
