# Analyse du fichier `merimee.csv` — Monuments historiques (base Mérimée / POP)

> Analyse réalisée le 2026-09-04 sur `merimee.csv` (dernière mise à jour des données : 2026-09-02).

---

## 1. Identification de la source

| Élément | Valeur |
|---|---|
| Base d'origine | **Mérimée** — patrimoine architectural, plateforme POP (`pop.culture.gouv.fr`) |
| Producteur | Ministère de la Culture — Médiathèque du patrimoine et de la photographie (MPP), Charenton-le-Pont |
| Périmètre | Liste générale des **immeubles protégés au titre des Monuments historiques** (art. R. 621-80 du Code du patrimoine) |
| Valeur juridique | Les notices reprennent les termes des arrêtés de protection : **opposables et faisant foi** (cf. champ `Copyright`) |
| Cadre d'étude déclaré | `recensement immeubles MH` pour 46 333 notices (99,1 %) |

---

## 2. Caractéristiques techniques du fichier

| Propriété | Valeur |
|---|---|
| Taille | **100,1 Mo** (100 062 530 octets) |
| Lignes physiques | 46 761 (1 en-tête + 46 760 données) |
| Enregistrements | **46 760 notices** |
| Colonnes | **78** |
| Séparateur | **pipe** `\|` |
| Encodage | **UTF-8**, sans BOM |
| Fins de ligne | **LF** (`\n`) — pas de CRLF |
| Guillemets | Champs de données encadrés par `"` ; **l'en-tête n'est pas quoté** |
| Sauts de ligne internes | **Aucun** (1 ligne = 1 notice) |
| Pipes internes | 1 occurrence (ligne 45639, notice `PA31000132`) — protégée par les guillemets |
| Valeurs manquantes | Champ vide `""` (aucune sentinelle type `NULL` / `N/A`) |
| Empreinte mémoire (pandas, `dtype=str`) | ~119 Mo |

### Lecture recommandée

```python
import pandas as pd
df = pd.read_csv("merimee.csv", sep="|", dtype=str, encoding="utf-8", low_memory=False)
# 46760 lignes x 78 colonnes
```

**Attention** : ne pas parser à la main avec `split("|")`. La ligne 45639 contient un pipe littéral à l'intérieur d'un champ quoté (79 champs au lieu de 78). Un vrai parseur CSV est obligatoire.

---

## 3. Typage des données

Toutes les colonnes sont **textuelles** dans le fichier source. Typage logique réel :

| Type logique | Colonnes | Remarque |
|---|---|---|
| **Identifiant** | `Reference`, `Identifiant_Agregee`, `COG_Insee_lors_de_la_protection` | `Reference` = clé primaire |
| **Date ISO** (`YYYY-MM-DD`) | `Date_de_creation_de_la_notice`, `Date_de_la_derniere_mise_a_jour` | 100 % parsables |
| **Date en texte libre** | `Date_et_typologie_de_la_protection` (`YYYY/MM/DD : statut`), `Date_de_Label`, `Datation_de_l_edifice` | extraction par regex nécessaire |
| **Géométrie** | `coordonnees_au_format_WGS84` (`"lat,lon"`) | à découper sur `,` |
| **Catégoriel simple** | `Region`, `Departement_*`, `Nature_de_la_protection`, `Typologie_du_dossier`, `Cadre_de_l_etude` | vocabulaire fermé (avec bruit) |
| **Catégoriel multivalué** | `Domaine`, `Denomination_de_l_edifice`, `Format_abrege_du_siecle_de_construction`, `Statut_juridique_de_l_edifice`, `Auteur_de_l_edifice`, … | séparateur **`;`** (parfois ` ; `) |
| **URL / URL multiples** | `Lien_vers_la_base_Archiv_MH`, `Liens_externes`, `Lien_vers_la_base_Palissy`, `Lien_vers_la_base_Joconde` | Palissy : jusqu'à 2 225 URL dans un seul champ |
| **Texte long** | `Historique`, `Precision_de_la_protection`, `Description_de_l_edifice`, `Observations`, `Copyright` | jusqu'à 7 389 caractères |

---

## 4. Volumétrie et complétude des 78 colonnes

### 4.1 Noyau quasi complet (> 95 %)

| Colonne | Rempli | % | Valeurs distinctes |
|---|---:|---:|---:|
| `Reference` | 46 760 | 100,00 | 46 760 |
| `Commune_forme_editoriale` | 46 760 | 100,00 | 16 384 |
| `Commune_forme_index` | 46 759 | 100,00 | 16 389 |
| `Departement_en_lettres` | 46 760 | 100,00 | 104 |
| `Departement_format_numerique` | 46 760 | 100,00 | 104 |
| `Date_de_la_derniere_mise_a_jour` | 46 760 | 100,00 | 111 |
| `Titre_editorial_de_la_notice` | 46 760 | 100,00 | 26 658 |
| `Cadre_de_l_etude` | 46 756 | 99,99 | 5 |
| `Region` | 46 754 | 99,99 | 20 |
| `Copyright` | 46 754 | 99,99 | 26 |
| `COG_Insee_lors_de_la_protection` | 46 753 | 99,99 | 16 978 |
| `Typologie_du_dossier` | 46 750 | 99,98 | 8 |
| `Precision_de_la_protection` | 46 650 | 99,76 | 42 667 |
| `Date_de_creation_de_la_notice` | 46 625 | 99,71 | 321 |
| `Denomination_de_l_edifice` | 46 600 | 99,66 | 1 997 |
| `Nature_de_la_protection` | 46 403 | 99,24 | 29 |
| `Date_et_typologie_de_la_protection` | 46 312 | 99,04 | 17 137 |
| `Typologie_de_la_protection` | 46 312 | 99,04 | 40 |
| `Lien_vers_la_base_Archiv_MH` | 45 937 | 98,24 | 45 937 |
| `Identifiant_Agregee` | 45 353 | 96,99 | 45 337 |
| `Statut_juridique_de_l_edifice` | 45 191 | 96,64 | 320 |
| `Domaine` | 45 028 | 96,30 | 124 |
| `coordonnees_au_format_WGS84` | 44 484 | 95,13 | 44 148 |

### 4.2 Couverture intermédiaire (10 – 95 %)

| Colonne | Rempli | % |
|---|---:|---:|
| `Siecle_de_la_campagne_principale_de_construction` | 39 699 | 84,90 |
| `Format_abrege_du_siecle_de_construction` | 39 483 | 84,44 |
| `Precision_de_la_localisation` | 33 556 | 71,76 |
| `Cadastre` | 30 216 | 64,62 |
| `Historique` | 24 821 | 53,08 |
| `Adresse_forme_index` | 18 561 | 39,69 |
| `Adresse_forme_editoriale` | 18 326 | 39,19 |
| `Observations` | 12 116 | 25,91 |
| `Datation_de_l_edifice` | 11 270 | 24,10 |
| `Technique_du_decor_porte_de_l_edifice` | 10 927 | 23,37 |
| `Lien_vers_la_base_Palissy` | 9 997 | 21,38 |
| `Liens_externes` | 9 943 | 21,26 |
| `Renvoi_vers_une_notice_de_la_base_Merimee_ou_Palissy` | 7 460 | 15,95 |
| `Auteur_de_l_edifice` | 6 311 | 13,50 |
| `Lieudit` | 5 509 | 11,78 |

### 4.3 Couverture faible (1 – 10 %)

`Typologie_de_la_zone_de_protection` (7,73 %) · `Precision_sur_le_statut_de_l_edifice` (7,16 %) · `etat_de_conservation` (5,38 %) · `Siecle_de_campagne_secondaire_de_construction` (4,12 %) · `Genre_du_destinataire` (4,07 %) · `Etablissement_affectataire_de_l_edifice` (3,91 %) · `Destination_actuelle_de_l_edifice` (3,75 %) · `Personnes_liees_a_l_edifice` (2,25 %) · `Precision_sur_la_denomination` (2,04 %) · `Description_de_l_edifice` (1,98 %) · `Autre_appellation_de_l_edifice` (1,76 %) · `Nom_du_cours_d_eau_traversant_ou_bordant_l_edifice` (1,40 %).

### 4.4 Colonnes quasi vides (< 1 %) — **28 colonnes**

`Precision_affectataire` (403) · `Source_de_l_energie_utilisee_par_l_edifice` (345) · `Emplacement__forme_et_structure_de_l_escalier` (245) · `Typologie_de_plan` (220) · `Materiaux_du_gros_oeuvre` (202) · `Description_de_l_iconographie` (158) · `Materiaux_de_la_couverture` (114) · `Type_de_couverture` (58) · `Typologie_du_couvrement` (48) · `Couverts_ou_decouverts_du_jardin_de_l_edifice` (29) · `Reference_a_un_ensemble` (19) · `Partie_constituante` (14) · `Lieu_de_conservation_d_un_element_architectural_deplace` (13) · `Vocable___pour_les_edifices_cultuels` (13) · `Description_de_l_elevation_interieure` (12) · `Justification_de_la_datation` (11) · `Indexation_iconographique_normalisee` (10) · `Justification_attribution` (10) · `Elements_remarquables_dans_l_edifice` (10) · `Date_de_Label` (8) · `Nom_du_redacteur` (6) · `Partie_d_elevation_exterieure` (5) · `References_des_parties_constituantes_etudiees` (3) · `Dimensions_normalisees_des_edicules_uniquement` (2) · `Remploi` (2) · `Partie_constituante_non_etudiee` (1) · `Lien_vers_la_base_Joconde` (1).

**`Producteur` est totalement vide (0 / 46 760)** — colonne à supprimer.

> Ces champs proviennent du modèle documentaire complet de Mérimée (utilisé pour les dossiers d'inventaire) mais ne sont pas renseignés dans le sous-ensemble « recensement immeubles MH ».

---

## 5. Identifiants et clés

### `Reference` — clé primaire

- Format : `PA` + 8 chiffres. **46 760 valeurs, 0 doublon.**
- 46 684 respectent strictement `^PA\d{8}$` (76 exceptions à contrôler).
- **Deux générations de références :**
  - `PA00xxxxxx` : **38 667 notices** (fonds historique, numérotation nationale continue).
  - `PA<dd>xxxxxx` où `dd` = code département : **8 093 notices** (protections récentes, ex. `PA31000132` = Haute-Garonne).

### `Identifiant_Agregee`

- Code alphanumérique de **6 caractères** (45 011 cas) ; quelques valeurs de 7, 15, 24, 42 caractères = concaténations.
- 45 353 renseignés, **16 doublons** → ne pas l'utiliser comme clé.

### `COG_Insee_lors_de_la_protection`

- Code INSEE communal à 5 caractères (46 581 cas).
- **170 notices multivaluées** (édifices à cheval sur plusieurs communes → longueurs 11, 17, 23, 29).
- **16 978 codes distincts** contre 16 384 communes éditoriales : le champ conserve le COG **au moment de la protection**, donc des codes de communes fusionnées ou disparues. À rapprocher d'un référentiel COG historisé.

### Liens externes

| Champ | Notices | Contenu |
|---|---:|---|
| `Lien_vers_la_base_Archiv_MH` | 45 937 | URL de recherche `archives-map.culture.gouv.fr` (dérivée de la Reference) |
| `Liens_externes` | 9 943 | PDF d'arrêtés (`culture.gouv.fr/Wave/image/merimee/PDF/…`), listes historiques MPP |
| `Lien_vers_la_base_Palissy` | 9 997 | **126 597 liens** vers des objets mobiliers (`IM…`) ; médiane 5 objets/notice, max **2 225** |
| `Lien_vers_la_base_Joconde` | 1 | anecdotique |
| `Renvoi_vers_une_notice_de_la_base_Merimee_ou_Palissy` | 7 460 | **8 335 renvois** : `IA` 7 470 (inventaire), `PA` 743 (autres MH), `JA` 55, `AC` 21, `IM` 17, `EA` 11, `MI` 7, `PM` 7 |

---

## 6. Contenu métier

### 6.1 Statut de protection (`Typologie_de_la_protection`)

| Statut | Notices |
|---|---:|
| **Inscrit MH (toutes formes)** | **33 883** |
| **Classé MH (toutes formes)** | **14 990** |
| Inscrit seul | 31 321 |
| Classé seul | 12 428 |
| Classé **et** inscrit (protections mixtes ou successives) | 2 562 |
| Ni l'un ni l'autre (champ vide ou atypique) | 449 |
| Mention « partiellement » | 20 301 |

Valeurs brutes principales : `inscrit MH` (16 013), `inscrit MH partiellement` (15 273), `classé MH` (9 904), `classé MH partiellement` (2 520), puis 36 combinaisons composites séparées par `;`.

### 6.2 Nature de l'acte (`Nature_de_la_protection`)

`arrêté` 43 985 · `liste` 1 457 · `décret` 438 · `journal officiel` 55 · `avis de classement` 16 · `certificat` 3 · `loi` 1 — plus 447 notices combinant plusieurs actes. Une valeur aberrante : `I`.

### 6.3 Chronologie des protections (`Date_et_typologie_de_la_protection`)

- **51 640 événements de protection** pour 46 312 notices → **4 215 notices portent plusieurs actes**.
- Amplitude : **1840 → 2026**.
- Format dominant : `YYYY/MM/DD : statut` ; année seule pour les plus anciennes (`1862 : classé MH`).

| Décennie | Actes | Décennie | Actes |
|---|---:|---|---:|
| 1840 | 677 | 1930 | 3 946 |
| 1850 | 11 | 1940 | 3 955 |
| 1860 | 580 | 1950 | 1 933 |
| 1870 | 141 | 1960 | 2 712 |
| 1880 | 655 | 1970 | 4 524 |
| 1890 | 200 | 1980 | 5 953 |
| 1900 | 1 076 | 1990 | **6 769** |
| 1910 | 1 583 | 2000 | 3 970 |
| 1920 | **7 952** | 2010 | 3 134 |
| | | 2020 | 1 868 |

Pics annuels : **1926 (2 093)**, 1927 (1 420), 1925 (1 087), 1984 (1 078), 1928 (1 050). L'onde des années 1920 correspond à la montée en charge de la loi de 1913. La liste de 1840 (première liste Mérimée) est bien présente avec ~675 actes.

Types d'événements : `inscrit MH` 33 030 · `classé MH` 16 181 · `inscrit MH partiellement` 2 355 · `classé MH partiellement` 7 · plus une poignée de valeurs mal formées (voir §8), dont un `déclassé MH`.

### 6.4 Typologie de dossier

`dossier de protection` 27 643 + `Dossier de protection` 18 777 (+ 2 variantes) = **46 422** · `notice de renvoi` 289 + `Notice de renvoi` 18 = **307** · `dossier individuel` 19 · `ensemble` 1 · `dos` 1 (typo).

Les 448 notices sans typologie de protection sont majoritairement des **notices de renvoi** (296) et 151 dossiers de protection incomplets.

### 6.5 Dénomination des édifices (`Denomination_de_l_edifice`, éclaté sur `;`)

725 valeurs distinctes. 6,4 % des notices sont multivaluées (max 6 dénominations).

| Dénomination | Occ. | Dénomination | Occ. |
|---|---:|---|---:|
| église | 10 458 | pont | 545 |
| château | 6 157 | fontaine | 511 |
| maison | 6 094 | croix monumentale | 489 |
| immeuble | 2 990 | menhir | 473 |
| hôtel | 2 061 | monument | 361 |
| chapelle | 1 770 | couvent | 357 |
| site archéologique | 1 189 | croix de cimetière | 351 |
| manoir | 1 056 | prieuré | 335 |
| abbaye | 704 | porte de ville | 313 |
| dolmen | 647 | ferme | 305 |
| édifice fortifié | 569 | cimetière / hôtel de ville / demeure | 247 / 243 / 243 |

### 6.6 Domaine (`Domaine`, 22 valeurs après éclatement)

| Domaine | Notices |
|---|---:|
| architecture domestique | 19 154 |
| architecture religieuse | 15 567 |
| architecture funéraire, commémorative ou votive | 2 583 |
| architecture de l'administration ou de la vie publique | 2 044 |
| architecture militaire | 1 688 |
| génie civil | 1 462 |
| architecture industrielle | 850 |
| architecture commerciale | 494 |
| architecture agricole | 387 |
| site archéologique | 213 |
| architecture de culture, recherche, sport ou loisir | 209 |
| architecture scolaire | 146 |
| architecture hospitalière, d'assistance ou de protection sociale | 119 |
| architecture artisanale | 100 |
| architecture de jardin | 64 |
| architecture judiciaire, pénitentiaire ou de police | 54 |
| urbanisme | 50 |
| architecture fiscale ou financière | 26 |

(+ 4 variantes orthographiques parasites, dont `escalier` et `architecture de commerce`.) 1 732 notices sans domaine.

### 6.7 Datation (`Format_abrege_du_siecle_de_construction`)

39 483 notices renseignées (84,4 %), **36,2 % multivaluées** (jusqu'à 9 siècles).

| Siècle | Occ. | Siècle | Occ. |
|---|---:|---|---:|
| 16e | 9 021 | 13e | 4 035 |
| 18e | 8 785 | 14e | 3 180 |
| 17e | 8 152 | 20e | 3 038 |
| 15e | 6 627 | 11e | 1 347 |
| 19e | 6 624 | 10e | 141 |
| 12e | 5 827 | 1er – 9e | ~340 cumulés |

Périodes non numériques : `Préhistoire` 1 823 · `Moyen Age` 857 · `Antiquité` 676 · `Protohistoire` 25 · `Temps Modernes` 8 · formes `limite Xe s. Ye s.` (~16).

Champs complémentaires : `Siecle_de_la_campagne_principale_de_construction` (39 699, forme longue « 1er quart 16e siècle »), `Siecle_de_campagne_secondaire_de_construction` (1 925), `Datation_de_l_edifice` (11 270, années précises type `1774;1783`).

### 6.8 Statut juridique / propriété (éclaté sur ` ; `)

| Propriétaire | Notices |
|---|---:|
| propriété de la commune | 20 274 |
| propriété privée | 19 501 |
| propriété d'une société privée | 2 478 |
| propriété de l'État | 1 468 (+ 213 orthographiés `l'Etat`) |
| propriété d'une association | 860 |
| propriété du département | 814 |
| propriété d'un établissement public | 246 |
| associations cultuelles / diocésaines | 269 |

3,5 % de notices multi-propriétaires (jusqu'à 7 valeurs). 1 569 notices sans statut.

### 6.9 Auteurs (`Auteur_de_l_edifice`)

6 311 notices (13,5 %), **8 098 chaînes distinctes** après éclatement, 41,7 % multivaluées (max 17). Forme attendue : `NOM Prénom (rôle)`.

Têtes de liste : Gabriel Ange-Jacques (125) et Gabriel Jacques (119) — **même famille éclatée en doublons** ; Vauban (73, avec le fragment « marquis (ingénieur militaire) » 72 issu d'un mauvais découpage) ; Guimard Hector (50 + 24, casse incohérente) ; Le Corbusier (Jeanneret Charles-Edouard 45 / Le Corbusier (architecte) 31 / dit Le Corbusier 24) ; Viollet-le-Duc (24). Des fragments parasites apparaissent comme auteurs : `ou` (85), `dit` (59), `(architecte)` (22) — le séparateur `;` coupe à l'intérieur de mentions composées.

### 6.10 Décor, matériaux, état

- `Technique_du_decor_porte_de_l_edifice` : 10 927 notices, 77 valeurs. sculpture 5 586 · peinture 3 039 · menuiserie 1 752 · ferronnerie 1 185 · vitrail 914 · décor stuqué 540. **Casse incohérente** (`Ferronnerie` 229, `Peinture` 174, `Sculpture` 150 comptés séparément).
- `Materiaux_du_gros_oeuvre` : 202 notices seulement — inexploitable statistiquement.
- `etat_de_conservation` : 2 515 notices. vestiges 1 250 · fragment 448 · désaffecté 321 · établissement industriel désaffecté 175 · détruit 88 · mauvais état 51. Vocabulaire pollué par du texte libre.

### 6.11 Protections connexes (`Typologie_de_la_zone_de_protection`, 3 614 notices)

site inscrit 1 473 · secteur sauvegardé 455 · site classé 286 · abords d'un MH 223 · site archéologique 167 · ZPPAUP 142 + 116 · parc naturel régional 86 · **liste du patrimoine mondial 82**.

### 6.12 Labels et statuts particuliers

- **Label XXe** : 269 notices (`Cadre_de_l_etude` contient `label XXe`). `Date_de_Label` renseigné pour 8 seulement, en texte libre (`ancien Label XXe 2015`).
- **Domaine national** : 103 notices.
- Étude thématique : 50 notices « étude d'un quartier urbain », 1 « Maisons à pans de bois en milieu urbain ».

---

## 7. Géographie

### 7.1 Coordonnées WGS84

- `coordonnees_au_format_WGS84` : **44 484 notices (95,1 %)**, format `"lat,lon"` en degrés décimaux.
- 100 % parsables. Latitudes **-21,38 → 51,06** ; longitudes **-63,04 → 55,81** (couvre La Réunion, Antilles, Guyane, Mayotte, Saint-Pierre-et-Miquelon).
- Aucun point à `(0,0)`. 43 918 dans la bbox métropole, 566 hors (outre-mer + quelques cas à vérifier).
- **336 paires de coordonnées strictement identiques** (édifices contigus ou géocodage à la commune).
- **2 276 notices sans coordonnées** (4,9 %).

### 7.2 Répartition administrative

- **20 valeurs de région** (18 régions + 1 valeur nulle + 1 combinaison inter-régionale).
- **102 codes département distincts** (96 métropole dont 2A/2B, + 971–976 dont 975 Saint-Pierre-et-Miquelon), plus 2 valeurs combinées (`01;71`, `12;81`).
- **16 384 communes** (forme éditoriale) / 16 978 codes COG.

| Région | Notices | Géolocalisées | Classées | Inscrites |
|---|---:|---:|---:|---:|
| Nouvelle-Aquitaine | 6 340 | 97,2 % | 1 909 | 4 728 |
| Occitanie | 5 071 | 96,1 % | 1 499 | 3 758 |
| Auvergne-Rhône-Alpes | 4 963 | 88,7 % | 1 488 | 3 716 |
| Grand Est | 4 626 | 93,9 % | 1 671 | 3 123 |
| Île-de-France | 3 988 | 99,7 % | 1 224 | 2 959 |
| Bourgogne-Franche-Comté | 3 748 | 99,2 % | 1 156 | 2 814 |
| Hauts-de-France | 3 302 | 97,4 % | 1 159 | 2 251 |
| Bretagne | 3 235 | 97,7 % | 1 153 | 2 155 |
| Normandie | 3 116 | 90,3 % | 983 | 2 299 |
| Centre-Val de Loire | 2 882 | 98,4 % | 867 | 2 172 |
| Provence-Alpes-Côte d'Azur | 2 401 | 95,8 % | 915 | 1 629 |
| Pays de la Loire | 2 171 | **81,7 %** | 677 | 1 625 |
| Corse | 337 | 100 % | 150 | 204 |
| La Réunion | 206 | 98,1 % | 28 | 184 |
| Martinique | 124 | 99,2 % | 24 | 98 |
| Guadeloupe | 120 | 97,5 % | 39 | 85 |
| Guyane | 91 | 100 % | 26 | 66 |
| Mayotte | 16 | 100 % | 2 | 15 |
| Saint-Pierre-et-Miquelon | 16 | 100 % | 14 | 2 |

**Top départements** : Paris 1 893 · Gironde 1 091 · Morbihan 996 · Calvados 978 · Dordogne 903 · Bas-Rhin 885 · Indre-et-Loire 883 · Puy-de-Dôme 875 · Côte-d'Or 860 · Charente-Maritime 858 · Côtes-d'Armor 847 · Nord 832 · Finistère 796.

**Fin de classement** : Val-de-Marne 115 · Seine-Saint-Denis 79 · Territoire de Belfort 58 · Saint-Pierre-et-Miquelon 16 · Mayotte 16.

**Top communes** : Bordeaux 385 · La Rochelle 295 · Nancy 265 · Paris 4e 256 · Paris 1er 248 · Lyon 241 · Toulouse 233 · Rouen 233 · Strasbourg 232 · Arras 227 · Dijon 216 · Lille 210. (Paris est éclaté par arrondissement.)

Distribution par commune : moyenne 2,75 notices, médiane 1, max 385. **9 609 communes n'ont qu'une seule notice.**

### 7.3 Adressage

- `Adresse_forme_editoriale` : 18 326 (39,2 %) — texte libre (`15, 17 rue Saint-Pierre ; 4 rue Delaunay`, `Dans le cimetière`).
- `Adresse_forme_index` : 18 561 — forme inversée indexable (`Strasbourg (boulevard-de) 68`).
- `Lieudit` : 5 509.
- **23 562 notices (50,4 %) n'ont ni adresse ni lieudit** → localisation limitée à la commune et aux coordonnées.
- `Cadastre` : 30 216 (64,6 %), format `section parcelle(s)` (`C 706, 712, 713, 743`).
- `Precision_de_la_localisation` : 33 556, très majoritairement la mention `Anciennement région de : …` (traçabilité de la réforme régionale de 2016).

---

## 8. Qualité des données — problèmes identifiés

### Structurels

1. **`Producteur` totalement vide** (0 / 46 760).
2. **28 colonnes remplies à moins de 1 %** — modèle documentaire surdimensionné pour ce jeu de données.
3. Pipe littéral dans un champ (`PA31000132`) : casse tout parsing naïf.

### Normalisation

4. **Casse incohérente** sur des vocabulaires contrôlés : `dossier de protection` / `Dossier de protection` (27 643 vs 18 777), `notice de renvoi` / `Notice de renvoi`, `ferronnerie` / `Ferronnerie`, `peinture` / `Peinture`, `sculpture` / `Sculpture`.
5. **Variantes orthographiques** : `propriété de l'État` (1 468) vs `propriété de l'Etat` (213) vs `propriété de l’État` (62, apostrophe typographique) ; `architecture funéraire, commémorative ou votive` vs `… ou commémorative ou votive` ; `granit` / `granite` ; `désaffecté` / `desaffecté`.
6. **Séparateurs multivalués hétérogènes** : `;` dans la plupart des champs, mais ` ; ` dans `Statut_juridique_de_l_edifice`.
7. **26 variantes du champ `Copyright`** pour un texte quasi identique (`©` vs `(c)`, année présente ou non, `immeubles` vs `édifices`, apostrophes droites vs typographiques).

### Valeurs aberrantes

8. `Nature_de_la_protection` = `I` (1 notice).
9. `Typologie_du_dossier` = `dos` (1 notice).
10. `Typologie_de_la_protection` : `classé MH pa`, `classé MH protection totale`, `classé MH partiellement : inscrit MH partiellement;protection partielle`, `classé MH;inscrit MH partiellement;protection  totale` (double espace).
11. `Date_et_typologie_de_la_protection` mal formaté : `classé MH partiellement:2017/05/10:inscrit MH`, `inscrit MH . 2020/09/03 : inscrit MH`, `01/22 : inscrit MH`, `classement MH`, `déclassé MH`.
12. `etat_de_conservation` mêle vocabulaire contrôlé et phrases libres (`écoulement d'eau qui traverse la toiture`, `restauré en 2020`, `Etat préoccupant`).
13. `Format_abrege_du_siecle_de_construction` : `16è s.`, `20 s.`, valeur vide (9 cas), `Antiquité (?)`.
14. `Auteur_de_l_edifice` : l'éclatement sur `;` produit des fragments (`ou` 85, `dit` 59, `(architecte)` 22) et des doublons d'identité non consolidés (Gabriel, Guimard, Le Corbusier).

### Cohérence

15. **16 doublons sur `Identifiant_Agregee`**.
16. **5 114 couples (titre éditorial, commune) en doublon** — attendu pour les titres génériques (`Immeuble`, `Maison`) mais à vérifier.
17. **448 notices sans `Typologie_de_la_protection` ni `Date_et_typologie_de_la_protection`**, dont 296 notices de renvoi et 151 dossiers de protection.
18. **307 notices de renvoi** dont seulement 41 portent effectivement une valeur dans `Renvoi_vers_une_notice_…` → renvois orphelins.
19. 1 notice sur 2 régions (`Auvergne-Rhône-Alpes;Bourgogne-Franche-Comté`), 2 notices sur 2 départements.
20. **6 notices sans région**, 1 sans commune indexée, 7 sans code COG.

### Fraîcheur et dates

21. `Date_de_la_derniere_mise_a_jour` : 2022-12-14 → **2026-09-02**. 42 324 notices mises à jour en 2026 et 4 415 en 2025 → **campagne de reprise massive récente** : cette date ne reflète pas une modification métier.
22. `Date_de_creation_de_la_notice` : 1993-03-29 → 2026-07-28. **37 047 notices (79 %) créées le même jour (1993-03-29)** = date d'informatisation initiale de la base, pas une date métier.
23. Les dates de protection vont jusqu'en **2026** : le fichier intègre les arrêtés les plus récents.

---

## 9. Volumétrie textuelle

| Champ | Notices | Moy. | Méd. | P90 | Max |
|---|---:|---:|---:|---:|---:|
| `Historique` | 24 821 | 610 | 524 | 1 160 | 7 389 |
| `Precision_de_la_protection` | 46 650 | 144 | 84 | 288 | 6 539 |
| `Description_de_l_edifice` | 926 | 802 | 587 | 1 913 | 5 935 |
| `Observations` | 12 116 | 81 | 40 | 163 | 3 567 |

**~23,6 Mo de texte libre exploitable** (~24 % du fichier). S'y ajoutent ~29 Mo de `Copyright` répété quasi à l'identique (627 caractères en moyenne × 46 754 notices) : **environ 29 % du fichier est du boilerplate juridique redondant**, à externaliser dans une table de référence.

`Precision_de_la_protection` est le champ métier clé : il décrit précisément l'objet protégé et l'acte (`Les deux façades sur cour et toitures correspondantes ; escalier ; cave (cad. BM 5) : inscription par arrêté du 2 mars 1993`) — parsable en (parties protégées, référence cadastrale, type d'acte, date).

---

## 10. Structure d'une notice (exemple `PA00078066`)

```
Reference                                        : PA00078066
Titre_editorial_de_la_notice                     : Halles (vieilles)
Denomination_de_l_edifice                        : halle
Domaine                                          : architecture commerciale
Commune_forme_editoriale                         : Brienne-le-Château
COG_Insee_lors_de_la_protection                  : 10064
Departement_format_numerique / _en_lettres       : 10 / Aube
Region                                           : Grand Est
coordonnees_au_format_WGS84                      : 48.3916559789157,4.52479043755344
Precision_de_la_localisation                     : Anciennement région de : Champagne-Ardenne
Siecle_de_la_campagne_principale_de_construction : 16e siècle
Format_abrege_du_siecle_de_construction          : 16e s.
Nature_de_la_protection                          : décret
Typologie_de_la_protection                       : classé MH
Date_et_typologie_de_la_protection               : 1930/11/30 : classé MH
Precision_de_la_protection                       : Halles (vieilles) : classement par décret du 30 novembre 1930
Statut_juridique_de_l_edifice                    : propriété de la commune
Typologie_du_dossier                             : Dossier de protection
Cadre_de_l_etude                                 : recensement immeubles MH
Identifiant_Agregee                              : IS0ZBR
Lien_vers_la_base_Archiv_MH                      : https://archives-map.culture.gouv.fr/…RECH_S=PA00078066…
Date_de_creation_de_la_notice                    : 1993-03-29
Date_de_la_derniere_mise_a_jour                  : 2026-07-24
```

Sur 78 colonnes, cette notice — représentative — en renseigne **26**.

---

## 11. Recommandations d'exploitation

### Nettoyage prioritaire

1. Supprimer `Producteur` ; isoler les 28 colonnes < 1 % dans une table annexe ou les écarter.
2. Externaliser `Copyright` dans une table de référence (26 variantes → 1 ligne) : **−29 % de volume**.
3. Normaliser casse et apostrophes (`'` vs `’`) sur tous les vocabulaires contrôlés.
4. Uniformiser le séparateur multivalué sur `;`, puis **éclater en tables de liaison** : `notice_domaine`, `notice_denomination`, `notice_siecle`, `notice_auteur`, `notice_statut_juridique`, `notice_technique_decor`.

### Modèle relationnel cible

```
monument(reference PK, titre, commune_cog, departement, region, lat, lon,
         date_creation, date_maj, typologie_dossier, cadre_etude, copyright_id)
protection(reference FK, date_acte, type_acte, statut, partiel BOOL, texte_precision)
monument_domaine / _denomination / _siecle / _auteur / _statut_juridique   -- 1-N
lien_externe(reference FK, type, url)          -- Archiv-MH, PDF arrêté, Palissy, Joconde
renvoi(reference FK, reference_cible, base)    -- IA / PA / IM / JA …
```

### Parsing à implémenter

- `Date_et_typologie_de_la_protection` → **51 640 événements** via `^(\d{4})(?:/(\d{2})/(\d{2}))?\s*:\s*(.+)$` (prévoir ~15 cas hors-format).
- `coordonnees_au_format_WGS84` → `split(",")` → floats → géométrie POINT (EPSG:4326).
- `Cadastre` → section + liste de parcelles.
- `Auteur_de_l_edifice` → `NOM Prénom (rôle)` ; prévoir une **table d'alias** pour consolider Gabriel / Guimard / Le Corbusier.
- `Precision_de_la_protection` → parties protégées / référence cadastrale / type d'acte / date.

### Points de vigilance analytique

- Ne **jamais** utiliser `Date_de_creation_de_la_notice` comme date de protection (79 % au 1993-03-29).
- `Date_de_la_derniere_mise_a_jour` reflète une reprise technique 2025-2026, pas une évolution métier.
- Le total « classés + inscrits » (48 873) **dépasse** le nombre de notices : 2 562 notices cumulent les deux statuts. Ne pas additionner naïvement.
- Une notice ≠ un édifice : notices de renvoi (307) et protections d'ensembles créent des recouvrements.
- `COG_Insee_lors_de_la_protection` est **historique** : toute jointure avec un COG actuel exige une table de correspondance des fusions de communes.
- 4,9 % du corpus n'est pas géolocalisable (2 276 notices), avec un déficit marqué en Pays de la Loire (81,7 %) et Auvergne-Rhône-Alpes (88,7 %).

### Cas d'usage immédiatement servis

Cartographie nationale des MH (95 % géolocalisés) · analyse chronologique des politiques de protection 1840-2026 · typologie architecturale et domaines · structure de propriété public/privé · lien immeuble ↔ mobilier via 126 597 renvois Palissy · densité patrimoniale par commune et par département · corpus textuel de 23,6 Mo pour du NLP (historique, description, précisions de protection).
