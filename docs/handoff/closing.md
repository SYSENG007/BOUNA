# Clôture de journée — `src/domain/closing.ts`

Sprint 5, §37 (les cinq étapes) et RULE-009 (verrouillage de journée), en logique
pure. Aucun React, aucun réseau, aucun accès au store : le module valide des
déclarations et retourne des **intentions** que la couche transactionnelle écrit.

44 tests dans `src/domain/__tests__/closing.test.ts`.

---

## La machine à états

```
CASH_COUNT → SALES_RECONCILIATION → STOCK_VARIANCE → EXPENSES → FINAL_VALIDATION
     ↑______________________|_______________|____________|              │
              revertStep() tant que status === 'OPEN'                   │
                                                                        ▼
                                                        DayClosure status LOCKED
                                                        (plus aucun fait daté du jour)
                                                                        │
                                              reopenDay() — OWNER + motif obligatoire
                                                                        ▼
                                                                     REOPENED
```

Séquentielle. Une étape n'est franchissable que si toutes les précédentes le
sont ; elle ne peut pas être franchie deux fois ; on revient dessus tant que la
validation finale n'a pas eu lieu, jamais après.

| Étape | Déclare | Dérive (masqué avant déclaration) | Produit |
| --- | --- | --- | --- |
| `CASH_COUNT` | espèces comptées, motif si écart | attendu = fond + ventes espèces − dépenses espèces, écart | `CASH_SESSION_CLOSED` |
| `SALES_RECONCILIATION` | relevé de chaque canal hors espèces | total système par canal, écart, ventes annulées | `SALES_RECONCILED` |
| `STOCK_VARIANCE` | quantités comptées, motif si écart | théorique projeté depuis `StockMovement[]`, écart valorisé au WAC | `STOCK_COUNTED`, `STOCK_VARIANCE_DETECTED`, mouvements `ADJUSTMENT` |
| `EXPENSES` | confirmation, note libre | total par catégorie, part espèces | audit seul |
| `FINAL_VALIDATION` | confirmation | récapitulatif du jour | `DAY_CLOSED` + `DayClosure` |

`CLOSING_STEP_SPECS` porte cette table sous forme de données (label, `declares`
à la première personne, `derives`, `events`) — de quoi construire l'écran sans
recopier les libellés.

---

## API publique — signatures exactes

### Journée métier

```ts
type BusinessDate = string; // 'AAAA-MM-JJ'

businessDateOf(timestamp: string, policy?: ClosingPolicy): BusinessDate
formatBusinessDate(date: BusinessDate): string        // '13 août 2026', '1er septembre 2026'
```

`businessDateOf` laisse passer une date déjà normalisée, sinon lit l'horodatage
en **heure locale** (celle de la caisse) et applique `policy.dayStartHour` : à 4,
une vente encaissée à 1 h du matin appartient à la veille.

### Politique

```ts
interface ClosingPolicy {
  cashToleranceFcfa: number;   // 500  — seuil de justification
  salesToleranceFcfa: number;  // 500
  stockToleranceFcfa: number;  // 1000 — un écart se juge en argent, pas en grammes
  dayStartHour: number;        // 0
  minReasonLength: number;     // 4
  reopenRoles: readonly Role[]; // ['OWNER']
}
const DEFAULT_CLOSING_POLICY: ClosingPolicy
```

Le seuil de caisse (500) est **plus bas** que celui de `evaluateRules` (2 000) :
justifier et réveiller le manager sont deux décisions distinctes.

### Verrouillage — RULE-009

```ts
interface ClosingState { closures: DayClosure[] }

isDayLocked(date: string, siteId: UUID, state: ClosingState, policy?): boolean
dayClosureOf(date: string, siteId: UUID, state: ClosingState, policy?): DayClosure | null
admitEvent(candidate: EventCandidate, state: ClosingState, policy?): EventAdmission
lockNotice(date: string, siteId: UUID, state: ClosingState, policy?): string | null

interface EventCandidate { siteId: UUID; occurredAt: string; label?: string }
type EventAdmission =
  | { accepted: true }
  | { accepted: false; businessDate: BusinessDate; message: string }
```

`admitEvent` est **le contrôle qu'un fait entrant doit franchir**. À appeler en
tête de `completeSale`, `recordWaste`, `recordExpense`, `receiveGoods`,
`completeBatch`, `transferStock` — avant toute écriture :

```ts
const admission = admitEvent(
  { siteId: SITE.id, occurredAt: new Date().toISOString(), label: 'vente' },
  { closures: state.closures },
);
if (!admission.accepted) return { error: admission.message };
```

Le message est en français et dit quoi faire :
« La journée du 13 août 2026 est clôturée. Cette vente ne peut plus y être
ajoutée. Un Owner peut rouvrir la journée avec un motif, sinon datez-la
d'aujourd'hui. »

`lockNotice` sert le bandeau en tête d'un écran de saisie.

Le verrou est **par site** : clôturer un site ne bloque pas l'autre.

### Réouverture

```ts
reopenDay(
  date: string, siteId: UUID, state: ClosingState,
  request: { actor: { id: UUID; role: Role }; reason: string; at?: string },
  policy?,
): ReopenOutcome

type ReopenOutcome =
  | { ok: true; closure: DayClosure; events: ClosingEventDraft[]; audit: AuditDraft[] }
  | { ok: false; error: ClosingError; message: string }
```

OWNER seul (`policy.reopenRoles`), motif d'au moins `minReasonLength`
caractères. La clôture n'est pas supprimée : son `status` passe à `REOPENED` et
la réouverture s'ajoute à `closure.reopenings` avec auteur, rôle, motif, date.
Le store remplace la clôture par celle retournée.

### Session de clôture

```ts
startClosing(siteId: UUID, businessDate: BusinessDate): ClosingSession
closingContext(input: ClosingContextInput): ClosingContext
closingProgress(session: ClosingSession, ctx: ClosingContext): ClosingStepView[]
completeStep(session: ClosingSession, ctx: ClosingContext, declaration: ClosingDeclaration): StepOutcome
revertStep(session: ClosingSession, step: ClosingStepId): RevertOutcome
declarationOf<S extends ClosingStepId>(session, step: S): DeclarationOf<S> | null
```

```ts
interface ClosingSession {
  id: UUID; siteId: UUID; businessDate: BusinessDate;
  status: 'OPEN' | 'VALIDATED';
  steps: ClosingStepRecord[];
}

type StepOutcome =
  | { ok: true; session: ClosingSession; events: ClosingEventDraft[];
      movements: StockMovementDraft[]; audit: AuditDraft[]; closure: DayClosure | null }
  | { ok: false; error: ClosingError; message: string }

type ClosingError =
  | 'DAY_ALREADY_LOCKED' | 'DAY_NOT_LOCKED' | 'STEP_ALREADY_COMPLETED'
  | 'STEP_NOT_REACHABLE' | 'REASON_REQUIRED' | 'CONFIRMATION_REQUIRED'
  | 'INCOMPLETE_COUNT' | 'FORBIDDEN' | 'INVALID_DECLARATION'
```

`message` est toujours prêt à afficher : il dit ce qui s'est passé et comment le
réparer. `closure` n'est renseigné que par `FINAL_VALIDATION`.

Les déclarations :

```ts
type ClosingDeclaration =
  | { step: 'CASH_COUNT'; countedCash: number; reason?: string }
  | { step: 'SALES_RECONCILIATION'; declaredTotals: Partial<Record<PaymentMethod, number>>; reason?: string }
  | { step: 'STOCK_VARIANCE'; counts: StockCountEntry[] }
  | { step: 'EXPENSES'; confirmed: boolean; note?: string }
  | { step: 'FINAL_VALIDATION'; confirmed: boolean }

interface StockCountEntry {
  itemId: UUID; locationId: UUID; counted: number;
  reason?: WasteReason; note?: string;
}
```

### Contexte

```ts
interface ClosingContext extends ClosingState {
  siteId: UUID;
  businessDate: BusinessDate;
  actor: { id: UUID; role: Role };
  now: string;
  policy: ClosingPolicy;
  items: Item[];
  sales: Sale[];
  expenses: Expense[];
  movements: StockMovement[];
  cashSessions: CashSession[];
  pendingEventCount: number;
  countScope: { itemId: UUID; locationId: UUID }[];
}
```

`closingContext()` remplit `now`, `policy`, `pendingEventCount`, `countScope` et
`closures` par défaut. Le module filtre lui-même la journée : passez les listes
complètes du store.

`countScope` est le périmètre de recomptage du soir. Vide = pas de comptage,
l'étape 3 se franchit avec `counts: []`.

### Vues — le masque de l'attendu

```ts
type Reveal<T> = { revealed: false } | ({ revealed: true } & T)

cashCountView(ctx, declaration: DeclarationOf<'CASH_COUNT'> | null): Reveal<CashCountReveal>
salesReconciliationView(ctx, declaration | null): Reveal<SalesReconciliationReveal>
stockVarianceView(ctx, declaration | null): Reveal<StockVarianceReveal>
expensesView(ctx): ExpensesReview                       // jamais masqué
finalValidationView(session, ctx): FinalValidationView   // { ready: false; blockers } | { ready: true; recap }
reconcilableMethods(ctx): PaymentMethod[]
```

**C'est ici que se joue la décision produit.** Tant que rien n'est déclaré, la
valeur dérivée n'est pas cachée par une condition d'affichage : elle est absente
du type. Un écran ne *peut pas* afficher l'attendu avant le comptage.

```tsx
const view = cashCountView(ctx, declaration);
// view.expected → erreur de compilation tant que view.revealed n'est pas narrowé
if (view.revealed) { /* view.expected, view.variance, view.breakdown */ }
```

Le masque protège un comptage : là où il n'y a rien à compter (aucune vente hors
espèces, `countScope` vide), la vue se révèle immédiatement. Les dépenses ne sont
jamais masquées — l'étape fait reconnaître, pas compter.

`finalValidationView` garde le récapitulatif fermé tant que les quatre étapes ne
sont pas franchies : il contient l'attendu de caisse.

---

## Ce que l'écran doit faire

```ts
const ctx = closingContext({
  siteId: SITE.id,
  businessDate: businessDateOf(new Date().toISOString()),
  actor: { id: user.id, role: user.role },
  items: state.items, sales: state.sales, expenses: state.expenses,
  movements: state.movements, cashSessions: [state.cashSession],
  closures: state.closures,
  pendingEventCount: pending,
  countScope: [...],
});

const out = completeStep(session, ctx, { step: 'CASH_COUNT', countedCash, reason });
if (!out.ok) { showError(out.message); return; }

// une seule transaction, comme une vente
dispatch({
  type: 'COMMIT',
  events: out.events.map((e) => makeEvent(e.eventType, e.entityType, e.entityId, e.payload)),
  movements: out.movements.map((m) => makeMovement(
    m.itemId, m.locationId, m.quantity, m.unit, m.movementType, m.referenceType, m.referenceId,
  )),
  audit: out.audit.map((a) => makeAudit(a.action, a.detail, a.reference)),
  closure: out.closure ?? undefined,
});
setSession(out.session);
```

`ClosingEventDraft`, `StockMovementDraft` et `AuditDraft` reprennent exactement
les arguments de `makeEvent`, `makeMovement` et `makeAudit`.

`closingProgress()` alimente le fil d'étapes : `state`
(`PENDING | CURRENT | DONE | LOCKED`), `reachable`, `revertable`, et `blockers`
— des phrases prêtes à afficher, soit le geste attendu, soit ce qui retient.

---

## Ce dont j'ai eu besoin et qui n'existe pas

À traiter par les propriétaires des fichiers concernés — je n'ai touché à aucun.

1. **`EVENT_TYPES` (`src/domain/types.ts`) ignore trois types.** Déclarés en
   attendant dans `CLOSING_EVENT_TYPES` : `SALES_RECONCILED`, `DAY_CLOSED`,
   `DAY_REOPENED`. À ajouter à `EVENT_TYPES`, puis remplacer `ClosingEventType`
   par `EventType`. Côté SQL rien à faire : `domain_events.event_type` est
   `text`, pas un enum.

2. **Pas de `DayClosure` dans `types.ts` ni dans le `State` du store.** Le type
   est exporté depuis `closing.ts`. Le store doit porter
   `closures: DayClosure[]`, le persister, et l'accepter dans `COMMIT` — sinon
   le verrou ne survit pas à un rechargement, et RULE-009 tombe.

3. **Table `day_closures` côté PostgreSQL.** L'agent SQL pose la contrainte
   équivalente ; le contrat côté client est celui de `DayClosure`
   (`site_id`, `business_date`, `status`, `closed_by`, `closed_at`, `record`
   jsonb, `reopenings` jsonb). Le verrou serveur doit refuser tout
   `stock_movement` / `sale` / `expense` dont la journée métier est `LOCKED`.

4. **`Expense` et `WasteEvent` n'ont pas de `siteId`.** Les dépenses de la
   journée sont donc filtrées **sur la date seule** : correct sur un site,
   faux le jour où BUNA en aura deux. C'est le seul endroit du module où le
   périmètre de site n'est pas garanti.

5. **`State.cashSession` est une session unique, pas une liste.** `ClosingContext`
   attend `cashSessions: CashSession[]` (passez `[state.cashSession]`).
   L'attendu somme les `openingCash` des sessions ouvertes dans la journée : juste
   tant que chaque shift redéclare son fond de caisse.

6. **Pas de permission `REOPEN_DAY` dans `permissions.ts`.** La règle vit dans
   `policy.reopenRoles = ['OWNER']`. `CLOSE_DAY` (MANAGER + OWNER) est bien
   utilisée pour la validation finale via `can()`. Si `REOPEN_DAY` est ajoutée un
   jour, `reopenDay` doit basculer dessus.

7. **`Closing.tsx` calcule aujourd'hui un attendu incomplet** : `openingCash +
   ventes espèces`, sans retrancher les dépenses réglées en espèces — alors que
   `NewExpense.tsx` promet à l'utilisateur « … de moins dans le fond de caisse
   attendu à la clôture ». `cashCountView` tient la promesse. L'écran refondu
   doit reprendre ce calcul, sinon les deux écrans se contredisent.

8. **Pas de `netResult` dans `DayRecap`, volontairement.** Un achat crée
   aujourd'hui une dépense *et* du stock consommé plus tard en COGS ; trancher ce
   double comptage est un sujet de Sprint 7, pas une décision à prendre en douce
   dans un écran de clôture. Le récapitulatif expose les composantes
   (`revenue`, `cogs`, `grossMargin`, `expensesTotal`, les trois écarts).


---

## Reprise — 17 août 2026

Le module est branché : `src/features/finance/screens/DayClosing.tsx` rend les
cinq étapes, `Closing.tsx` ne tient plus sa logique simplifiée en parallèle.

Sur les huit points ouverts ci-dessus :

| # | État |
| --- | --- |
| 1 | **Fait.** Les trois types sont dans `EVENT_TYPES` ; `ClosingEventType` est un alias d'`EventType`. |
| 2 | **Fait.** `State.closing` et `State.closures` existent, persistés, acceptés par `COMMIT`. |
| 3 | **Reste.** Aucune table `day_closures` côté PostgreSQL : le verrou RULE-009 est **client seul**. Un deuxième appareil peut encore dater un fait d'une journée signée ailleurs. |
| 4 | Inchangé — `Expense` et `WasteEvent` n'ont toujours pas de `siteId`. |
| 5 | **Fait.** Le store passe `[state.cashSession]`. |
| 6 | **Fait.** `REOPEN_DAY` est une capacité, `policy.reopenCapability` la désigne. L'écran de réouverture reste à écrire. |
| 7 | **Fait.** L'écran passe par `cashCountView`, qui retranche les dépenses réglées en espèces. |
| 8 | Inchangé, et toujours volontaire. Le suivi simple contourne le double comptage autrement : `materialBalance()` mesure la consommation par la période (stock initial + achats − stock final) au lieu de l'additionner aux dépenses « Matières ». |

**Ajouté au passage :** `domain/coherence.ts`. Le suivi simple ne refuse plus
rien au comptoir — vendre au-delà de ce qui a été déclaré préparé passe. L'étape
de validation finale affiche donc ce que la journée a rendu invérifiable :
constat chiffré, conséquence sur les chiffres, geste proposé. Il ne bloque
jamais la clôture.
