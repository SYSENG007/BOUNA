# BUNA Operations — architecture v2

**Statut :** implémentée. Lots 0 à 5 livrés le 13 août 2026 ; il reste le lot 6
(raccourcissement des flux et branchement du moteur de clôture). L'état exact est
en fin de document, § 12.
**Ce qu'on abandonne :** le RBAC par rôle (§7 du PRD) et la navigation par rôle (§90).
**Ce qu'on garde intact :** le stock est une projection, l'événement est l'unité,
l'idempotence par `event.id`, le hors-ligne d'abord, le coût moyen pondéré.
Ces cinq règles ne sont pas du PRD, ce sont les fondations. Le reste est rediscutable.

---

## 1. Diagnostic — ce qui coince, avec les preuves

### 1.1 Le rôle décide de tout, et c'est faux sur le terrain

`src/domain/permissions.ts` fige 19 permissions dans 6 jeux immuables. Le manager
ne peut rien accorder : `ROLE_PERMISSIONS` est une constante TypeScript. Sur le
terrain, un employé polyvalent réceptionne le matin et vend l'après-midi ; le
système lui demande de porter deux rôles, ce qui n'est pas la même chose.

Pire : la base ne sait même pas faire du multi-rôle. `profiles.role` est un enum
**scalaire** (`0001_core.sql:44`) là où le client manipule `roles: Role[]`.
`auth.ts:71` fait `roles: [data.role]` — le multi-rôle client est une fiction qui
ne survit pas à un aller-retour serveur.

### 1.2 La navigation additionne au lieu de choisir

`getNavForRoles()` fusionne les menus de chaque rôle. Un Manager + Préparateur +
Approvisionneur reçoit **8 onglets**. Le commentaire du fichier dit « quatre à
cinq destinations, jamais plus ». Le code fait l'inverse dès qu'on est polyvalent.

### 1.3 Le serveur code les rôles en dur

```sql
if v_role not in ('SELLER','MANAGER','OWNER') then
  raise exception 'Rôle % non autorisé à enregistrer une vente', v_role;
```

`complete_sale`, `void_sale`, `receive_goods` et 20 policies RLS raisonnent en
`has_role(array[...])`. Accorder un droit à une personne demande aujourd'hui une
migration SQL. C'est le verrou principal.

### 1.4 La traçabilité existe en données, jamais à l'écran

| Entité | Trace |
| --- | --- |
| `Sale` | `sellerId`, `createdAt` |
| `StockMovement` | `userId`, `deviceId`, `createdAt` |
| `Expense`, `WasteEvent`, `InventoryCount` | `userId`, `createdAt` |
| `ProductionBatch` | `preparerId`, pas de device |
| **`Purchase`** | **aucune trace d'auteur** |

Et aucun écran n'affiche « qui ». L'information est là, elle n'est jamais rendue.

### 1.5 Le moteur analytique n'est branché nulle part

C'est le point le plus coûteux.

| Module | Lignes | Écrans qui l'importent |
| --- | --- | --- |
| `domain/analytics.ts` | 1 144 | **0** |
| `domain/closing.ts` | 1 341 | **0** |
| `domain/permissions.ts` | 60 | 2 |

`periodReport`, `periodSeries`, `hourlyProfitability`, `siteProfitability`,
`supplierAnalytics`, `productMargins`, `Measured<T>` : écrits, testés, morts.
`Closing.tsx` (135 lignes) réimplémente une clôture naïve à côté du moteur en
5 étapes de `closing.ts`. Pendant ce temps `Today.tsx` et `Cockpit.tsx`
recalculent chacun leurs agrégats dans un `useMemo` maison, avec des définitions
qui divergent déjà.

**Conséquence pour le plan : la matière des dashboards n'est pas à écrire, elle
est à brancher.** L'essentiel du travail « graphiques et analyses » est du
câblage, pas du calcul.

---

## 2. Le renversement — poste ≠ capacité

### 2.1 Deux notions, séparées pour de bon

**Le poste** est une identité sociale. Stable, unique, affichée. Il dit qui vous
êtes dans l'équipe, pas ce que vous avez le droit de faire.

> Owner · Manager · Responsable finance · Vendeur · Préparateur · Approvisionneur

**La capacité** est le droit d'exécuter une opération. Accordée par une personne,
à une date, révocable. Elle dit ce que vous pouvez faire, quel que soit votre poste.

> `SELL` · `RECEIVE_GOODS` · `RECORD_WASTE` · `CLOSE_DAY` …

Le poste ne **détermine** plus les capacités : il en **propose** un jeu de départ.
À l'embauche, on applique le préréglage du poste ; ensuite, le manager ajoute et
retire opération par opération. Un vendeur qui réceptionne le mardi reste vendeur.

```
capacités effectives = accords non révoqués, pour cet utilisateur
préréglage du poste  = ce qu'on coche par défaut à la création, rien de plus
```

### 2.2 Un accord est un fait daté — comme tout le reste

C'est la même règle que le stock : on n'écrase pas un état, on ajoute un fait.

```sql
user_capabilities (user_id, capability, granted_by, granted_at, revoked_by, revoked_at)
```

Une capacité active = une ligne avec `revoked_at is null`. Retirer un droit
n'efface pas l'accord, il ajoute sa révocation. L'historique « qui a donné quoi
à qui, et quand » est gratuit, et il est auditable — exactement ce qu'on attend
d'un système où la délégation est le mécanisme central.

### 2.3 Les capacités, par feature

Identifiants en anglais, libellés en français — convention déjà en place dans le
dépôt (`ROLE_LABEL`, `EXPENSE_LABEL`, `WASTE_LABEL`).

| Feature | Capacité | Ce que la personne peut faire |
| --- | --- | --- |
| **Vente** | `SELL` | Enregistrer une vente |
| | `VOID_SALE` | Annuler une vente, avec motif |
| | `MANAGE_CASH_SESSION` | Ouvrir et fermer une caisse |
| | `VIEW_ALL_SALES` | Voir les ventes de toute l'équipe |
| **Stock** | `VIEW_STOCK` | Consulter l'état du stock |
| | `RECORD_WASTE` | Déclarer une perte |
| | `TRANSFER_STOCK` | Déplacer du stock entre emplacements |
| | `COUNT_INVENTORY` | Compter un emplacement |
| | `RESOLVE_VARIANCE` | Solder un écart constaté |
| **Production** | `PRODUCE` | Lancer et clôturer un batch |
| | `EDIT_RECIPE` | Modifier une recette |
| **Approvisionnement** | `REQUEST_PURCHASE` | Demander un achat |
| | `APPROVE_PURCHASE` | Approuver une demande |
| | `PLACE_ORDER` | Passer commande au fournisseur |
| | `RECEIVE_GOODS` | Réceptionner une livraison |
| | `MANAGE_SUPPLIERS` | Gérer les fournisseurs |
| **Finance** | `RECORD_EXPENSE` | Enregistrer une dépense |
| | `VIEW_FINANCES` | Voir marges, charges, résultat |
| | `CLOSE_DAY` | Clôturer la journée |
| **Pilotage** | `VIEW_DASHBOARD` | Voir le tableau de bord global |
| | `MANAGE_CATALOG` | Gérer articles et prix |
| | `MANAGE_LOCATIONS` | Gérer les emplacements |
| | `MANAGE_TEAM` | **Accorder et retirer les capacités** |
| | `VIEW_AUDIT_LOG` | Consulter le journal |

24 capacités. `MANAGE_TEAM` est la méta-capacité : c'est elle qui rend le système
auto-administrable, et c'est celle que seuls Owner et Manager portent par défaut.

### 2.4 Ce que ça donne côté serveur

```sql
create or replace function has_capability(c public.capability)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_capabilities
    where user_id = auth.uid() and capability = c and revoked_at is null
  )
$$;
```

`security definer` est obligatoire : sans ça, la lecture de `user_capabilities`
depuis une policy repasserait par RLS et boucle. Et son `execute` **reste**
accordé à `anon, authenticated` — les expressions de policy s'évaluent avec les
privilèges de l'appelant, la révoquer casserait toutes les lectures.

Ensuite, mécaniquement :

```sql
-- avant
using (... and has_role(array['OWNER','MANAGER','PROCUREMENT']::user_role[]))
-- après
using (... and (select has_capability('RECEIVE_GOODS')))
```

et dans les fonctions transactionnelles :

```sql
-- avant
if v_role not in ('SELLER','MANAGER','OWNER') then
  raise exception 'Rôle % non autorisé à enregistrer une vente', v_role;
-- après
if not has_capability('SELL') then
  raise exception 'Vous n''avez pas l''autorisation d''enregistrer une vente';
```

Le message d'erreur change aussi de voix : il parle à la personne, pas de son rôle.

**Personne ne perd d'accès le jour de la migration** : le backfill dérive les
capacités initiales de `ROLE_PERMISSIONS` tel qu'il existe aujourd'hui.

---

## 3. La traçabilité devient un invariant, pas une colonne

### 3.1 Un tampon unique sur tout fait

```ts
/** Qui a fait quoi, quand, depuis où. Dénormalisé exprès. */
export interface Actor {
  userId: UUID;
  /** Le nom au moment du fait : l'historique doit rester lisible dans deux ans,
   *  même si la personne a quitté l'équipe ou que RLS masque son profil. */
  userName: string;
  /** Le poste au moment du fait, pas le poste actuel. */
  post: Post;
  /** Sous quelle capacité l'opération a été exécutée — la délégation se trace aussi. */
  under: Capability;
  deviceId: string;
  at: string;
}

export type Traced<T> = T & { actor: Actor };
```

Le champ `under` est ce qui distingue cette refonte d'un simple ajout de colonne
`user_id` : quand un vendeur réceptionne une livraison, le journal dit *sous
quelle autorisation il l'a fait*. Une contestation trois semaines plus tard se
résout en une ligne.

### 3.2 Appliqué partout

`Sale`, `StockMovement`, `Expense`, `WasteEvent`, `InventoryCount`,
`ProductionBatch`, **`Purchase`** (aujourd'hui sans auteur) et `Transfer` portent
un `actor`. Les champs historiques `sellerId` / `userId` / `preparerId` restent
en lecture pour ne rien casser, mais ne sont plus la source.

### 3.3 Rendu à l'écran, systématiquement

Une primitive, une seule :

```tsx
<ActorStamp actor={sale.actor} />   →   Awa · vendeuse · 14:32
```

Elle apparaît sur **chaque ligne de chaque liste** : ventes, mouvements, pertes,
réceptions, dépenses, ajustements. C'est un composant du design system, pas une
décision d'écran — sinon la moitié des écrans l'oublieront.

Et la confirmation de fin de flux la reprend :

> **Vente #454 enregistrée.**
> −3 cappuccino au comptoir · marge 1 240 FCFA
> Awa · vendeuse · 14:32

---

## 4. La carte des features

Six features. Chacune est un dossier, et chacune se déclare dans un **manifeste**.

```ts
export const APPROVISIONNEMENT: Feature = {
  id: 'APPROVISIONNEMENT',
  label: 'Approvisionnement',
  Icon: IconReceive,
  home: '/appro',
  operations: [
    { id: 'RECEIVE',  label: 'Réceptionner une livraison', to: '/appro/reception', requires: 'RECEIVE_GOODS', Icon: IconReceive },
    { id: 'REQUEST',  label: 'Demander un achat',          to: '/appro/demande',   requires: 'REQUEST_PURCHASE', Icon: IconCart },
    { id: 'APPROVE',  label: 'Approuver une demande',      to: '/appro/validation',requires: 'APPROVE_PURCHASE', Icon: IconCheck },
    …
  ],
};
```

Ce registre est **la** source de vérité. En dérivent, sans duplication :

- les routes de `App.tsx`
- les onglets et le rail
- le tiroir « Déclarer »
- les raccourcis de la page profil
- **l'écran de gestion d'équipe** — le manager coche « Réceptionner une
  livraison », pas `RECEIVE_GOODS`. Même libellé des deux côtés : c'est ce qui
  rend la délégation compréhensible sans documentation.

| Feature | Contenu | Ce qui en sort |
| --- | --- | --- |
| **Vente** | POS, panier, encaissement, reçu, historique, caisse | CA, marge, mouvements `SALE` |
| **Stock** | État, mouvements, perte, transfert, inventaire | Projection, écarts |
| **Production** | À préparer, batch, recettes, rendement | Consommation déduite, rendement |
| **Approvisionnement** | Besoins calculés, demande, approbation, commande, réception, fournisseurs, prix, **frais de transport et de manutention** | Entrées de stock, coût moyen, dépenses |
| **Finance** | Dépenses, encaissements, clôture, écarts et recouvrements, résultat | Résultat, trésorerie |
| **Pilotage** | Tableau de bord, analyses, équipe et capacités, catalogue, emplacements, journal | — |

Le point important sur **Approvisionnement** : les frais y sont saisis *dans le
geste de réception*, pas dans un écran de dépense séparé. Le transport et la
manutention d'une livraison sont une conséquence de cette livraison, et
`receiveGoods()` produit déjà mouvements + coût moyen + dépense en une
transaction. On généralise : **une opération produit toutes ses conséquences,
l'utilisateur n'en saisit qu'une.**

---

## 5. La coque — une forme stable, un contenu variable

### 5.1 Le principe

Aujourd'hui la barre change de forme selon le rôle. C'est ce qui rend l'app
illisible pour un polyvalent, et impossible à apprendre. Les applications
naturelles font l'inverse : la barre ne bouge **jamais**, c'est son contenu qui
s'adapte.

```
┌──────────┬──────────┬─────────────┬──────────┬──────────┐
│Aujourd'hui│  Vendre  │ (+) Déclarer│  Stock   │   Moi    │
└──────────┴──────────┴─────────────┴──────────┴──────────┘
```

- **Aujourd'hui** — le tableau de bord, composé des blocs que vous avez le droit
  de voir. Porte la pastille d'alertes.
- **Vendre** — l'action dominante. Si la personne n'a pas `SELL`, l'emplacement
  prend sa feature dominante : Préparer, ou Approvisionner.
- **(+) Déclarer** — **le point d'entrée unique de toute déclaration.** Une
  feuille modale qui liste toutes les opérations autorisées, groupées par
  feature, les trois dernières utilisées en tête. C'est ici que la polyvalence se
  résout : une personne à 12 capacités et une personne à 3 utilisent le même
  bouton, au même endroit.
- **Stock** — consultation, l'écran le plus regardé après le POS.
- **Moi** — profil, sync, et pour qui porte `MANAGE_TEAM`, l'accès à l'équipe.

Sur desktop, le rail déplie les features au lieu de les replier — la place existe,
autant l'utiliser. `--nav-rail` et `--tabbar-h` continuent de porter la bascule,
et toute barre d'action ancrée reste en `.rail-bar`.

### 5.2 Ce qui disparaît

`NAV_BY_ROLE`, `getNavForRoles()`, et l'écran `/alertes` autonome (les alertes
remontent dans **Aujourd'hui** et en notification). Trois entrées de nav en moins.

---

## 6. Le tableau de bord global

Un seul écran, `/aujourdhui`, remplaçant `Today.tsx` **et** `Cockpit.tsx`. Il est
composé de **blocs**, chacun conditionné par une capacité. Un vendeur y voit ses
propres ventes et le stock ; le manager y voit tout. Même écran, même code, même
vocabulaire — c'est ce qui fait qu'on peut en parler à deux au comptoir.

| Bloc | Source (déjà écrite) | Capacité |
| --- | --- | --- |
| Bandeau du jour — CA, marge, écart de caisse, alertes | `periodReport` | `SELL` (les siennes) / `VIEW_FINANCES` (tout) |
| Courbe CA — 14 jours, comparaison période précédente | `periodSeries` | `VIEW_DASHBOARD` |
| Rentabilité par heure — 24 colonnes | `hourlyProfitability` | `VIEW_FINANCES` |
| Top produits et marges | `productMargins` | `VIEW_DASHBOARD` |
| Dépenses par catégorie | `periodTotals` | `VIEW_FINANCES` |
| Écarts et fuites, et leur recouvrement | `variance.ts` (§7) | `RESOLVE_VARIANCE` |
| Ce que l'équipe a fait — flux tracé, filtrable par personne | `Traced<T>` | `VIEW_AUDIT_LOG` |

Le bloc **rentabilité par heure** mérite d'être mis en avant : c'est le calcul le
plus actionnable pour un coffee bar (quand ouvrir, quand renforcer l'équipe), il
est entièrement écrit, et il n'a jamais été affiché.

### 6.1 Les primitives graphiques

Six composants SVG dans `design-system/charts/`, sur les tokens existants. Aucune
dépendance : sur une PWA hors-ligne, 90 Ko de librairie de graphes se paient au
premier chargement, sur un réseau qu'on ne maîtrise pas.

| Composant | Usage |
| --- | --- |
| `<Sparkline>` | Tendance dans une `KpiTile`, 40×14 |
| `<BarSeries>` | Série temporelle, période précédente en fantôme |
| `<HBars>` | Classement — top produits, dépenses par catégorie |
| `<Donut>` | Répartition, 6 parts maximum puis « autres » |
| `<HourStrip>` | Rentabilité horaire, 24 colonnes |
| `<VarianceBar>` | Écart signé autour de zéro, tons conforme / surveiller / critique |

**Tous acceptent `Measured<T>`.** C'est non négociable : `analytics.ts` distingue
déjà « journée sans vente » de « journée jamais saisie », et un graphique qui
trace un zéro pour une absence de donnée fabrique une information fausse. Une
absence se rend en hachure grise, jamais en point à zéro.

### 6.2 Le filet doré, discipliné

`.derived` marque ce que le système **déduit**, jamais ce que l'utilisateur
déclare. Sur un tableau de bord entièrement calculé, l'appliquer partout le
transformerait en décoration — ce que la charte interdit.

> **Filet doré :** marge, coût moyen, rendement, écart, recouvrement, besoin
> d'approvisionnement, rentabilité horaire.
> **Sans filet :** CA, nombre de commandes, quantités vendues, montants déclarés.

La règle tient en une phrase : *le filet signale une inférence, pas une somme.*

---

## 7. Écarts et recouvrements — la boucle qu'il manque

Aujourd'hui, l'écart de caisse vit dans la clôture et l'écart de stock dans
l'inventaire. Deux mécaniques séparées, aucune ne se solde. On unifie.

**Un écart** est la différence entre le théorique (déduit des mouvements) et le
déclaré (compté, encaissé). Trois sources : la caisse, le stock, le rendement de
production.

**Un recouvrement** est le fait daté qui solde cet écart : un motif, une
imputation, et le cas échéant une contrepartie.

```ts
export type VarianceSource = 'CASH' | 'STOCK' | 'YIELD';
export type Resolution = 'PERTE' | 'ERREUR_SAISIE' | 'OFFERT' | 'VOL' | 'AJUSTEMENT';

export interface Variance {
  id: UUID;
  source: VarianceSource;
  reference: UUID;        // session de caisse, comptage, batch
  theoretical: number;
  declared: number;
  delta: number;
  resolvedBy: Resolution | null;
  actor: Actor;           // qui a constaté
  resolver: Actor | null; // qui a soldé
}
```

Un nouvel événement, `VARIANCE_RESOLVED`. Un écart non recouvert reste **ouvert**
et remonte dans le bandeau du tableau de bord jusqu'à ce que quelqu'un le solde.
C'est cette boucle qui transforme un chiffre constaté en décision prise —
et c'est ce qui manque le plus aujourd'hui.

---

## 8. Les flux — huit gestes, trois écrans chacun au maximum

| Flux | Écrans | État |
| --- | --- | --- |
| Vendre | grille → panier → encaissement → reçu | existe, bon |
| Déclarer une perte | quoi → combien → pourquoi | à raccourcir |
| Réceptionner | fournisseur → lignes et prix → frais | existe, impact coût à montrer avant validation |
| Demander un achat | besoins pré-cochés → ajuster → envoyer | à écrire |
| Compter | emplacement → saisie à l'aveugle → écarts révélés → motifs | à raccourcir |
| Produire | recette → quantité → rendement | existe |
| Enregistrer une dépense | montant → catégorie → justificatif | existe |
| Clôturer | 5 étapes | **le moteur existe dans `closing.ts`, l'écran l'ignore** |

Deux règles qui s'appliquent aux huit :

1. **La saisie à l'aveugle d'abord.** On ne montre jamais l'attendu avant que la
   personne ait déclaré. `Closing.tsx` le fait déjà bien pour la caisse ; c'est à
   généraliser à l'inventaire et au rendement. Sinon on ne compte pas, on recopie.
2. **La confirmation nomme les conséquences.** Pas « Enregistré ✓ », mais ce que
   le système en a déduit — le stock qui bouge, la marge, le coût moyen qui
   change — et qui l'a fait.

---

## 9. Structure cible

```
src/
  domain/                  logique pure, testable
    capabilities.ts        ← remplace permissions.ts
    actor.ts               ← Actor, Traced<T>
    variance.ts            ← écarts et recouvrements
    analytics.ts           inchangé — enfin branché
    closing.ts             inchangé — enfin branché
    stock.ts, rules.ts, units.ts, money.ts…
  features/
    vente/          manifest.ts · screens/ · components/ · useVente.ts
    stock/
    production/
    approvisionnement/
    finance/
    pilotage/       dashboard · equipe · catalogue · emplacements · journal
  shell/
    AppShell.tsx           coque, rail, tabbar
    navigation.ts          dérivée du registre de features
    OperationSheet.tsx     le tiroir « Déclarer »
    routes.ts              dérivées du registre
  design-system/
    charts/                Sparkline · BarSeries · HBars · Donut · HourStrip · VarianceBar
    ActorStamp.tsx
    primitives.tsx, patterns.tsx, icons.tsx
  store/, backend/         inchangés
supabase/migrations/
  0009_capabilities.sql    postes, capacités, has_capability, backfill, RLS, fonctions
  0010_actor_trace.sql     actor sur purchases et les entités qui n'en ont pas
```

`src/screens/<rôle>/` disparaît. C'est ce découpage par rôle qui produit
mécaniquement la duplication : `Today` et `Cockpit` calculent la même chose parce
qu'ils appartenaient à deux rôles.

---

## 10. Plan d'exécution — sept lots, l'app utilisable à chaque étape

### Lot 0 — Socle *(rien de visible)*
`domain/capabilities.ts`, `domain/actor.ts`, le registre de features.
Migration `0009` : enum `capability`, table `user_capabilities`, `has_capability()`,
backfill depuis les rôles actuels, réécriture des 20 policies et des 3 fonctions
transactionnelles. `useCan()` dans le store, capacités portées par le profil.

**Vérification :** `npm run typecheck && npm run test && npm run build`, puis une
requête qui prouve qu'un utilisateur sans `RECEIVE_GOODS` se fait refuser
`receive_goods` **côté serveur**. Un cache PostgREST périmé ou un `revoke` sans
effet ne se voient qu'en interrogeant la base.

### Lot 1 — Coque
Navigation dérivée du registre, tiroir « Déclarer », suppression de `NAV_BY_ROLE`.
C'est le premier lot que l'utilisateur ressent.

### Lot 2 — Traçabilité visible
`ActorStamp` dans le design system, `actor` sur `Purchase` (migration `0010`),
affichage sur toutes les listes, filtre « par personne ».

### Lot 3 — Tableau de bord unifié
Les six primitives graphiques, branchement d'`analytics.ts`, fusion de `Today` et
`Cockpit`. Le lot au meilleur rapport valeur / effort : le calcul est déjà écrit.

### Lot 4 — Écarts et recouvrements
`domain/variance.ts`, la boucle de résolution, le bloc de tableau de bord.

### Lot 5 — Équipe
L'écran où le manager accorde et retire, opération par opération, sur le même
registre et les mêmes libellés. Avec le journal des accords.

### Lot 6 — Flux
Raccourcissement feature par feature. Branchement du vrai moteur de clôture.

---

## 11. Ce que les tests doivent tenir

Les tests d'acceptation cessent d'être numérotés d'après le PRD ; ils deviennent
les tests des règles d'architecture. On garde tout ce qui existe et on ajoute :

- Une capacité retirée interdit l'opération **côté serveur**, pas seulement dans l'UI.
- Un accord révoqué reste lisible dans l'historique.
- Toute opération produit un `actor` complet, `under` inclus.
- Un écart non recouvert reste ouvert et remonte au tableau de bord.
- Un graphique alimenté par `Measured{hasData:false}` n'affiche pas zéro.
- Le stock reste une projection : aucune colonne de niveau n'apparaît, nulle part.


---

## 12. État au 13 août 2026

### Livré

| Lot | Contenu | Où |
| --- | --- | --- |
| 0 | Capacités, acteur, écarts, trésorerie | `src/domain/{capabilities,actor,variance,cashflow}.ts` |
| 0 | Migration serveur : poste, capacités, 43 politiques, 9 fonctions gardées | `supabase/migrations/0009_capabilities.sql` |
| 0 | Tampon d'auteur, table des écarts, journal des délégations | `supabase/migrations/0010_actor_trace.sql` |
| 1 | Coque à cinq emplacements fixes, tiroir « Déclarer », registre de features | `src/shell/`, `src/features/registry.ts` |
| 2 | `ActorStamp` sur les listes, `actor` sur tous les faits | `src/design-system/components/ActorStamp.tsx` |
| 3 | Tableau de bord unifié, six primitives graphiques, trésorerie | `src/features/pilotage/screens/Dashboard.tsx`, `src/design-system/charts/` |
| 4 | Écarts et recouvrements, boucle fermée | `src/features/stock/screens/Ecarts.tsx` |
| 5 | Écran Équipe : le manager accorde et retire, opération par opération | `src/features/pilotage/screens/Equipe.tsx` |

`src/screens/<rôle>/` a disparu. `NAV_BY_ROLE`, `getNavForRoles`, `permissions.ts`,
`domain/flow.ts`, `Today.tsx` et `Cockpit.tsx` sont supprimés.

### Ce qui reste

**Le moteur de clôture n'est toujours pas branché.** `domain/closing.ts`
(1 341 lignes, cinq étapes, verrouillage RULE-009, réouverture motivée) reste
importé par aucun écran : `Closing.tsx` continue de tenir sa propre logique
simplifiée. C'est le seul module écrit et testé qui demeure dormant, et c'est le
cœur du lot 6.

En conséquence, la capacité `REOPEN_DAY` est délégable et gardée côté serveur,
mais aucune interface ne permet encore de rouvrir une journée.

**L'approbation d'achat et la gestion des fournisseurs n'ont pas d'écran.** Les
fonctions serveur existent et sont gardées (`approve_purchase_request`,
`reject_purchase_request`) ; les capacités correspondantes s'accordent depuis
Équipe et n'apparaissent pas dans le tiroir, faute de destination.

**Les migrations 0009 et 0010 n'ont pas été exécutées.** Ni PostgreSQL local, ni
Docker, ni CLI Supabase sur cette machine. Elles ont été vérifiées
structurellement — parité de l'enum des capacités entre SQL et TypeScript,
politiques toutes précédées de leur `drop`, dollar-quoting équilibré, aucune
référence à une table inexistante — mais **jamais appliquées à une base**.
Tant qu'elles ne le sont pas, le client demande `profiles.post` et
`user_capabilities` à un schéma qui ne les a pas : l'authentification réelle
échouera. Le mode terrain (`npm run dev:terrain`) reste utilisable.
