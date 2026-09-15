# Règles de conception — photographies

Déplacé de `CLAUDE.md`. Couvre `etl/merimee_etl/wikidata.py`, `commons.py`,
`memoire.py` et le rendu des photographies dans `DetailPanel.svelte` /
`lib/photo.ts`. Lire cette page avant de relancer un de ces instantanés ou de
toucher au cadrage des images de fiche.

**Les photographies viennent d'instantanés, pas d'une requête vivante.** La base
Mérimée ne porte **aucun lien vers une image** : ni colonne Mémoire, ni Wikidata, ni
fichier. Le premier pont est Wikidata (`P380` identifiant Mérimée → `P18` image), et il
couvre **39 556 notices sur 46 760, soit 84,6 %**. Le second est Commons, par les
fichiers dont la page **cite la référence** : **512 notices de plus, 85,7 % au total**.
`python -m merimee_etl.wikidata` et `python -m merimee_etl.commons` écrivent deux
fichiers **séparés** dans `data/ref/` —
deux bases tierces de fiabilité différente, dont l'une doit pouvoir être régénérée ou
jetée sans toucher l'autre ; `python -m merimee_etl` **ne les appelle jamais**, il se
contente de la colonne `commons` des fragments — vide si les instantanés sont absents.
C'est ce qui garde le pipeline hors-ligne et les tests sans réseau. Trois conséquences :

- le fichier est versionné dans `data/ref/` mais **ce n'est pas une décision
  éditoriale** : c'est une base tierce datée, qui vieillit ;
- le crédit auteur / licence est lu à la volée sur l'API Commons parce que Wikidata ne
  le porte pas. La plupart de ces images sont sous CC-BY-SA : **le crédit est une
  obligation**. Il n'est jamais bloquant, et son échec laisse le lien vers la page du
  fichier, qui porte l'information complète ;
- une notice sur sept n'a pas d'image, et la fiche **s'ouvre alors sur son titre**. La
  plaque nommée qui tenait cette place — dénomination, domaine, « aucune photographie
  sur Wikimedia Commons » — occupait un tiers du panneau pour répéter ce que la fiche
  donne deux lignes plus bas. Ne reste que la bande des deux pastilles, qui se posaient
  sur l'image, et un filet sans lequel elles disparaîtraient sur le fond du panneau. La
  règle antérieure (« la section disparaît ») est donc **rétablie**, et l'absence se dit
  autrement : par le renvoi POP, cf. plus bas. Le cadre gris muet, lui, reste interdit.

Le magasin de certificats par défaut de Python sous Windows a rendu un
`CERTIFICATE_VERIFY_FAILED: certificate has expired` sur ce point d'entrée ; le module
passe par `certifi` quand il est installé.

**`memoire.py` rattrape aussi les coupures en plein flux.** Le fichier source pèse
1,36 Go et est lu en flux (cf. plus bas) : une coupure réseau **pendant** cette lecture
lève `http.client.IncompleteRead`, qui hérite d'`HTTPException` et non d'`OSError`. Le
`except OSError` seul laissait filer cette exception-là — une coupure en cours de
lecture plantait avec une trace Python au lieu du message `source injoignable` que
rendent les autres pannes réseau (timeout, DNS, connexion refusée). `except (OSError,
http.client.HTTPException)` couvre maintenant les deux familles.

**Le cadre épouse la photographie, entre deux bornes.** Le rapport 4/3 fixe recadrait
tout : une tour en portrait perdait sa flèche, un phototype en bandeau ses deux bords —
au moment précis où l'image sert à identifier l'édifice. Le cadre suit donc le rapport
réel du fichier, borné à **0,68 et 1,9** (`lib/photo.ts` : `CADRE_MIN`, `CADRE_MAX`).
Sans borne, un bandeau se réduirait à un trait
et un tirage vertical repousserait le titre hors de l'écran ; entre les bornes,
`object-fit: contain` sur un cadre au même rapport ne coupe rien ; au-delà, l'image
passe en `cover` et **se fait glisser**. Trois points à ne pas défaire :

- **`object-position` s'exprime en pourcents de la part cachée**, pas de la largeur : le
  pixel se convertit par cette part, recalculée depuis le rapport réel et la boîte
  affichée (`glisserCadrage()`, `lib/photo.ts`). Une fraction fixe dériverait avec la
  largeur de la fiche, qui change d'un gabarit à l'autre ;
- **les gestes sont portés par l'image, pas par le cadre.** Un `<div>` qui écoute le
  pointeur réclame un rôle ARIA, et aucun ne décrit honnêtement un cadre de
  photographie ; l'image remplit exactement ce cadre, la boîte mesurée est la même ;
- **`touch-action: none` n'est posé que sur une image hors bornes.** Partout ailleurs le
  doigt doit continuer à faire défiler la fiche.

Les bornes ne sont pas théoriques : sur **240 fichiers de l'instantané mesurés**,
**25 en sortent** — 10 %, du dolmen photographié en bandeau (2,5) au clocher cadré à
0,53. Le test mesure la boîte du cadre contre le rapport naturel du fichier, à 3 % près,
vérifie que le mode de remplissage suit la règle de bornes, et **glisse réellement** sur
un fichier hors bornes pour voir `object-position` bouger — en attendant d'abord que
l'image ait fini de charger (`attendreImageChargee`, `tests/e2e/_soutien.ts`, poll sur
`img.complete` et `naturalWidth`) : mesurer le rapport naturel trop tôt produisait un
cadre calculé sur `NaN`, une intermittence corrigée avec le passage à la suite e2e.

**Le pont Wikidata n'est pas étroit : les photographies manquantes n'existent pas.**
**46 618 items portent déjà un `P380`** sur 46 760 notices — les 7 204 fiches sans image
n'ont pas d'item manquant, elles n'ont pas de `P18`. Trois routes ont été mesurées sur
échantillon avant d'en retenir une seule :

| route | rendement | ce que ça vaut |
|---|---|---|
| image de tête d'article frwiki | 172/300 « images », **13 vraies photos** | cartes de localisation, blasons, `MH_disparu.svg` |
| `insource:"PA…"` sur Commons | 11/100 en échantillon, **512/7 190 = 7,1 %** en passe complète | le fichier **cite la notice** |
| geosearch 150 m | 44/100 | **sujet non vérifié** |
| items sans P18 mais avec `P373` | 224 | négligeable |

La passe complète coûte **1 h 40** : l'API de recherche répond en ~700 ms, et il y a
7 190 notices à interroger. D'où l'écriture incrémentale et la reprise — les références
déjà trouvées sont sautées, celles cherchées sans succès sont revues au passage suivant,
Commons s'enrichissant.

Le geosearch rend `BENOIT HAMON.jpg` pour la préfecture de Nanterre et
`Église (Salins-les-Bains).jpg` pour une « Demeure ». Corroborer par le titre ne filtre
presque rien (25 → 22) : le nom de commune figure dans la plupart des noms de fichiers,
il atteste **le lieu, pas le sujet**. Or une fiche affirme quelque chose en montrant une
photographie, et ne rien montrer vaut mieux qu'une image fausse. **Le geosearch est
écarté**, comme PMTiles : décision close, chiffres à l'appui.

`commons.py` filtre en plus par la forme du nom (`.jpg/.png/.tif`, rejet de
`location_map`, `blason`, `logo`, `MH_disparu`…) — le piège mesuré sur les images de
tête frwiki, où 172 « images » cachaient 13 photographies.

**Le troisième pont ne rapporte que des nombres.** Les 6 692 notices sans fichier
Commons ne sont pas dépourvues de photographie : la base **Mémoire** — les campagnes du
ministère de la Culture, celles qui illustrent POP — en couvre **4 861, soit 72,6 %,
avec 45 122 clichés**. La couverture de la fiche, photographie ou renvoi, passe donc de
**85,7 % à 96,1 %** ; il reste 1 831 notices sans rien. Sur le corpus entier, Mémoire
illustre 39 377 notices et 779 673 images.

**Et pourtant rien n'est repris.** Ces images ne sont pas libres : sur les 779 673 lignes
illustrées, **90 403 portent une mention** et elle est restrictive — « reproduction
soumise à autorisation du titulaire des droits d'exploitation » 77 495 fois,
« reproduction interdite » 85, « diffusion normale » 89. L'export tait les 88 % restants,
mais POP les affiche : sur 47 notices illustrées relevées à la main, **546 crédits,
aucun libre** — « tous droits réservés », « diffusion GrandPalaisRmn Photo ». Les
afficher serait une reproduction non autorisée sur un site tiers, quel que soit le
crédit affiché — c'est la différence avec Commons, dont les CC-BY-SA n'exigent que
l'attribution. `memoire.py` ne récolte donc qu'un **compte par notice**, et la fiche
n'en fait qu'un renvoi vers POP, qui les montre chez lui. Décision prise sur ces
chiffres ; la rouvrir demanderait des mentions libres en nombre, que la passe imprime à
chaque fois. Trois points de mise en œuvre :

- **la source est lue en flux, jamais écrite.** Le jeu « Mémoire – illustration Mérimée
  et Palissy » (data.gouv.fr, ODbL) pèse **1,36 Go** ; à 30 Mo/s mesurés la passe coûte
  moins d'une minute, contre 6 692 pages POP à interroger une à une. Le disque n'en
  garde que `data/ref/memoire_illustrations.csv`, 554 Ko ;
- **une ligne Mémoire peut citer plusieurs notices** (`PA00099871;IA19000868`), et le
  fichier couvre aussi Palissy : le compte se fait par notice **du corpus**, une seule
  fois par ligne, et les lignes sans `Lien_vers_l_image` ne comptent pas ;
- **l'export tait les droits, POP non.** `Copyright` est vide partout où
  `Droits_de_diffusion` l'est — les deux colonnes ont été comptées tour à tour et
  rendent le même décompte. La mention complète se lit sur la notice POP, jamais dans le
  CSV ; l'absence de mention dans l'export **ne veut pas dire image libre**, et les deux
  colonnes sont comptées pour ne pas dépendre de celle que le ministère remplira demain.
