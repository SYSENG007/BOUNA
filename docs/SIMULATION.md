# Simuler une journée

Tester l'application de bout en bout — ouvrir, réceptionner, vendre, perdre,
dépenser, compter, clôturer — sans qu'une seule ligne n'entre dans les chiffres
de la maison, et tout effacer à la fin.

**Ouvrez `/pilotage/simulation` dans l'application** et appuyez sur « Entrer en
simulation ». Un bandeau *Mode simulation* s'affiche en haut de tous les écrans,
encaissement compris, avec le bouton pour sortir.

L'adresse se tape : aucun lien n'y mène. Le bac à sable ne doit pas se
découvrir en explorant les menus, parce qu'y entrer change la maison dans
laquelle on travaille. Il faut la capacité **« Simuler une journée »**, accordée
par défaut aux propriétaires et aux managers, et révocable depuis l'écran
Équipe comme n'importe quelle autre.

Rien à installer, rien à retenir, aucun compte d'essai : **c'est votre propre
compte qui se déplace**, avec votre nom et vos droits habituels. Un bouton pour
entrer, un bouton pour sortir.

## Ce que c'est

Une **seconde organisation** dans le même projet Supabase, nommée
« BUNA — Simulation ».

Ce n'est pas un mode de l'application, et c'est délibéré. Le schéma cloisonne
déjà tout par `organization_id`, chaque politique RLS filtre sur
`current_org_id()`, et toutes les clés étrangères vers `organizations`
cascadent. Deux propriétés en découlent, qu'un drapeau `is_simulation` posé sur
les lignes n'aurait pas données :

**L'étanchéité est tenue par PostgreSQL, pas par notre vigilance.** Un compte de
simulation ne *peut pas* écrire dans la maison réelle — RLS refuse, quelle que
soit l'erreur commise au-dessus. Il n'y a pas de filtre à ne pas oublier.

**La fin de simulation tient en un prédicat.** On supprime l'organisation, la
cascade emporte articles, mouvements, ventes, dépenses, préparations, écarts,
notifications, événements et journal. Aucune table ne peut être oubliée.

En contrepartie, la simulation exerce le **vrai** chemin : les fonctions
transactionnelles (`complete_sale`, `receive_goods`, `close_cash_session`…),
l'idempotence par `event.id`, le coût moyen pondéré côté serveur, RLS, le
régime d'exploitation. C'est ce qui sépare « ça marche à l'écran » de « ça
marche ».

## Pourquoi votre compte plutôt qu'un compte d'essai

Entrer en simulation déplace votre profil dans le bac à sable ; en sortir le
ramène. Deux colonnes sur `profiles` retiennent la maison d'où vous venez —
c'est ce qui rend le retour certain, et non déduit.

Trois raisons, et la première a décidé du reste :

**Aucune fonction appelable depuis un navigateur n'écrit dans `auth.users`.**
Créer des comptes depuis l'interface aurait exigé exactement ce privilège, avec
une clé anon publique — la pire surface possible. Déplacer un profil l'évite
entièrement.

**La simulation se joue avec vos vrais droits.** « Est-ce que moi, avec ce que
je détiens, je peux tenir une journée ? » est la question utile. Un compte
d'essai tout-puissant n'y répond pas.

**Plusieurs personnes peuvent entrer chacune de leur côté** et se retrouver dans
le même bac à sable, avec leurs postes respectifs. Une répétition générale à
plusieurs, sans mot de passe partagé.

Ce que ça ne permet pas : vérifier ce que voit un vendeur sans être vendeur. Il
faut pour cela qu'un manager vous retire des droits le temps de l'essai — ce qui
est un fait daté, réversible, et visible au journal.

### Le garde-fou qui compte

`profiles.organization_id` cascade depuis `organizations` : supprimer le bac à
sable pendant qu'un profil le désigne **détruirait le compte**. C'est pourquoi
« Effacer » ramène d'abord tout le monde chez soi, puis supprime. L'ordre de ces
deux gestes est la seule chose qui l'empêche, et il est tenu par la base, pas
par l'interface.

Entrer deux fois de suite ne réécrit pas la maison d'origine — sans ce garde-fou,
un second appel enregistrerait le bac à sable comme maison d'où l'on vient, et
la personne n'aurait plus nulle part où revenir.

## Ce que la simulation a en ouvrant

Le **catalogue réel**, recopié : mêmes articles, mêmes prix, mêmes coûts. Un
cycle qui tourne sur un catalogue fictif ne dit rien de celui qui tournera lundi
matin. Les identifiants sont neufs, mais les noms sont identiques — et c'est ce
qui compte : l'application rapproche ses référentiels par nom et se rebranche
toute seule.

Un **stock d'ouverture** sur les matières premières et les emballages. Deux
articles sont volontairement **sous leur minimum** — `Lait concentré` et
`Pack gobelet moyen` — pour que la liste de courses et les alertes de rupture
aient quelque chose à dire dès le matin. Une matinée qui commence par un manque,
c'est la matinée normale.

Pas de stock de produits finis : ils sont en « à la commande ».

---

## Le cycle d'une journée

Chaque étape déclenche une fonction transactionnelle côté serveur — c'est ce
qu'on vérifie. Les étapes sont annotées du métier concerné : à plusieurs, chacun
entre en simulation de son côté et joue le sien ; seul, un propriétaire ou un
manager les tient toutes.

### Le matin

**1. Ouvrir la caisse** — *au comptoir* → Vente
Compter le fond de caisse, saisir le montant. C'est lui qui sert de référence à
l'écart, au moment de clôturer. → `open_cash_session`

**2. Regarder ce qui manque** — *à l'approvisionnement* → Approvisionnement
Les deux articles sous leur minimum doivent apparaître. Écarter une ligne pour
la journée, vérifier qu'elle revient demain — la liste est une projection, il
n'y a rien à y supprimer.

**3. Réceptionner une livraison** — *à l'approvisionnement* → Approvisionnement → Réception
Saisir des quantités et des prix d'achat **différents** du coût connu : c'est le
seul moyen de voir bouger le coût moyen pondéré. → `receive_goods` +
`apply_weighted_average_cost`

### Le service

**4. Vendre** — *au comptoir* → Vente
Plusieurs ventes, en variant les moyens de paiement (espèces, Mobile Money). Le
bloc « déduit automatiquement » du reçu montre le stock, le coût des produits
vendus et la marge : c'est ce que le système *déduit*, jamais ce qu'on déclare.
→ `complete_sale`

**5. Annuler une vente** — *au comptoir* → Vente → Historique
Avec un motif. Une vente ne se supprime pas, elle s'annule. → `void_sale`

**6. Déclarer une perte** — *au comptoir ou en cuisine* → Stock → Perte
Un gobelet renversé, un fond de lait tourné. → `record_waste`

### L'après-midi

**7. Enregistrer une dépense** — *à la finance* → Finance → Dépense
Y compris une dépense payée sur la caisse : elle doit se retrouver dans l'écart
au moment de clôturer. → `record_expense`

**8. Compter un emplacement** — *en cuisine* → Stock → Inventaire
Saisir volontairement une quantité **fausse** sur un article. L'écart doit
apparaître, et remonter au tableau de bord. → `apply_inventory_count`

**9. Solder l'écart** — *à l'encadrement* → Stock
Choisir une résolution et la motiver. → `resolve_variance`

### Le soir

**10. Changer de régime** — *à l'encadrement* → Profil → Régime d'exploitation
Passer de « suivi simple » à « suivi précis », puis revenir. Les mêmes
événements, les mêmes mouvements, les mêmes projections — seul change ce que
l'application *exige* avant d'accepter une déclaration. La bascule doit être
réversible sans rien casser de ce qui précède. → `set_operating_mode`

**11. Clôturer la journée** — *à la finance* → Finance → Clôture
Recompter la caisse. L'écart se mesure à partir du fond du matin, moins les
dépenses payées en espèces, plus les ventes en espèces. Signer.
→ `close_cash_session`

**12. Lire le bilan** — *au pilotage* → Pilotage
Chiffre d'affaires, marge, trésorerie, rentabilité par heure. Vérifier que les
chiffres racontent la journée qu'on vient de jouer.

### Et le hors ligne

À n'importe quel moment : couper le réseau (onglet Réseau des outils de
développement, ou le Wi-Fi), encaisser deux ou trois ventes, rétablir. Les
ventes doivent partir seules, sans doublon — c'est l'idempotence par `event.id`
qui le garantit. C'est **la** règle qui ne se négocie pas (RULE-010), et celle
qui coûte le plus cher si elle lâche.

---

## Recommencer, finir

Depuis `/pilotage/simulation` :

- **Quitter la simulation** — vous revenez dans la maison. Le bac à sable reste
  intact : on y retourne, ou on va lire ce qu'il a produit.
- **Effacer les données de simulation** — tout disparaît, et les personnes qui y
  travaillent encore reviennent chez elles. Les chiffres de la maison ne sont
  pas touchés.

Pour repartir d'une journée neuve : effacer, puis entrer de nouveau.

Le bouton **Quitter** est aussi dans le bandeau, en haut de chaque écran. C'est
délibéré : on peut se retrouver en simulation sans savoir comment on y est entré
— un appareil laissé ouvert, un collègue qui a montré quelque chose. Le chemin
du retour doit être là où le constat se fait.

### Depuis un terminal

Pour préparer les données sans ouvrir l'interface — avant une démonstration, par
exemple :

```bash
scripts/simulation.sh start    # monte le bac à sable sans y entrer
scripts/simulation.sh status   # ce qu'il contient, et qui y travaille
scripts/simulation.sh stop     # efface, et ramène qui y était encore
```

Ces commandes n'appellent que les fonctions de la base : il n'existe qu'une
seule description du bac à sable, et c'est `0030_bac_a_sable.sql`.

### Après avoir effacé, sur chaque appareil ayant servi

**Profil → Paramètres avancés → « Réinitialiser les données locales ».**

Vider PostgreSQL ne vide pas les téléphones : le cache local est relu au premier
rendu et survit à tout ce qui arrive côté serveur.

## Le cas des deux maisons sur un même appareil

Un appareil qui a servi à la simulation puis à la vraie journée porte les deux
dans sa file d'attente. C'est la session ouverte qui décide de la destination —
donc, sans précaution, une vente de simulation pourrait partir dans le chiffre
d'affaires réel.

La file filtre : elle n'envoie que les faits de l'organisation ouverte. Ce qui
appartient à l'autre n'est **pas perdu** — il attend qu'on rouvre la session
sous laquelle il a été saisi, et le Profil le dit en toutes lettres. Un fait
daté attend son organisation ; il ne change pas de maison parce qu'on a changé
de compte.

Voir `src/domain/simulation.ts` et `src/domain/__tests__/simulation.test.ts`.
