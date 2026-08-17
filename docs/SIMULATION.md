# Simuler une journée

Tester l'application de bout en bout — ouvrir, réceptionner, vendre, perdre,
dépenser, compter, clôturer — sans qu'une seule ligne n'entre dans les chiffres
de la maison, et tout effacer à la fin.

```bash
scripts/simulation.sh start
```

Se connecter avec un compte `@simu.buna.sn`. Un bandeau **Mode simulation**
reste affiché en haut de tous les écrans, encaissement compris.

```bash
scripts/simulation.sh stop
```

---

## Ce que c'est

Une **seconde organisation** dans le même projet Supabase, nommée
« BUNA — Simulation », avec ses propres comptes.

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

## Les comptes

Mot de passe commun : `simulation2026`.

| Compte | Poste | Ce qu'il peut faire |
| --- | --- | --- |
| `patron@simu.buna.sn` | Propriétaire | Tout, y compris le régime et la clôture |
| `gerant@simu.buna.sn` | Manager | L'encadrement et les trois métiers de terrain |
| `vendeur@simu.buna.sn` | Vendeur | Vendre, ouvrir et fermer la caisse, déclarer une perte |
| `prepa@simu.buna.sn` | Préparateur | Préparer, transférer, compter |
| `appro@simu.buna.sn` | Approvisionneur | Commander, réceptionner, gérer les fournisseurs |
| `finance@simu.buna.sn` | Finance | Dépenses, marges, trésorerie, clôture |

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
qu'on vérifie. Les étapes changent de compte quand le métier change de main :
c'est aussi une manière de tester que les capacités tiennent.

### Le matin

**1. Ouvrir la caisse** — *vendeur* → Vente
Compter le fond de caisse, saisir le montant. C'est lui qui sert de référence à
l'écart, au moment de clôturer. → `open_cash_session`

**2. Regarder ce qui manque** — *appro* → Approvisionnement
Les deux articles sous leur minimum doivent apparaître. Écarter une ligne pour
la journée, vérifier qu'elle revient demain — la liste est une projection, il
n'y a rien à y supprimer.

**3. Réceptionner une livraison** — *appro* → Approvisionnement → Réception
Saisir des quantités et des prix d'achat **différents** du coût connu : c'est le
seul moyen de voir bouger le coût moyen pondéré. → `receive_goods` +
`apply_weighted_average_cost`

### Le service

**4. Vendre** — *vendeur* → Vente
Plusieurs ventes, en variant les moyens de paiement (espèces, Mobile Money). Le
bloc « déduit automatiquement » du reçu montre le stock, le coût des produits
vendus et la marge : c'est ce que le système *déduit*, jamais ce qu'on déclare.
→ `complete_sale`

**5. Annuler une vente** — *vendeur ou manager* → Vente → Historique
Avec un motif. Une vente ne se supprime pas, elle s'annule. → `void_sale`

**6. Déclarer une perte** — *vendeur ou préparateur* → Stock → Perte
Un gobelet renversé, un fond de lait tourné. → `record_waste`

### L'après-midi

**7. Enregistrer une dépense** — *finance* → Finance → Dépense
Y compris une dépense payée sur la caisse : elle doit se retrouver dans l'écart
au moment de clôturer. → `record_expense`

**8. Compter un emplacement** — *préparateur* → Stock → Inventaire
Saisir volontairement une quantité **fausse** sur un article. L'écart doit
apparaître, et remonter au tableau de bord. → `apply_inventory_count`

**9. Solder l'écart** — *manager* → Stock
Choisir une résolution et la motiver. → `resolve_variance`

### Le soir

**10. Changer de régime** — *patron ou gérant* → Profil → Régime d'exploitation
Passer de « suivi simple » à « suivi précis », puis revenir. Les mêmes
événements, les mêmes mouvements, les mêmes projections — seul change ce que
l'application *exige* avant d'accepter une déclaration. La bascule doit être
réversible sans rien casser de ce qui précède. → `set_operating_mode`

**11. Clôturer la journée** — *patron ou finance* → Finance → Clôture
Recompter la caisse. L'écart se mesure à partir du fond du matin, moins les
dépenses payées en espèces, plus les ventes en espèces. Signer.
→ `close_cash_session`

**12. Lire le bilan** — *patron* → Pilotage
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

```bash
scripts/simulation.sh start    # efface la simulation précédente et repart à neuf
scripts/simulation.sh status   # ce que le bac à sable contient en ce moment
scripts/simulation.sh stop     # efface tout
```

### Après `stop`, sur chaque appareil ayant servi

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
