import type {
  CashSession, EventType, Expense, Item, MovementType, PaymentMethod, Role, Sale,
  StockMovement, Unit, UUID, WasteReason,
} from './types';
import { EXPENSE_LABEL, PAYMENT_LABEL, WASTE_LABEL } from './types';
import { stockAt } from './stock';
import { can } from './permissions';
import { uuid } from './ids';
import { fcfa } from './money';
import { formatQty } from './units';

/**
 * §37 — La clôture de journée, en cinq étapes.
 *
 * Ce module ne connaît ni React, ni le réseau, ni le store : il décrit la
 * séquence, dit à chaque instant ce qui manque pour avancer, et produit des
 * *intentions* (événements, mouvements, audit) que la couche transactionnelle
 * transforme en faits. Un écran se contente de rendre ce que ces fonctions
 * retournent.
 *
 * Trois décisions structurent tout le fichier :
 *
 * 1. **L'attendu reste masqué jusqu'à la saisie.** Ce n'est pas de l'affichage :
 *    un compteur qui voit le montant attendu ne compte pas, il recopie. Le type
 *    `Reveal<T>` rend la valeur dérivée littéralement inaccessible tant que la
 *    déclaration n'a pas eu lieu — le compilateur porte la règle produit.
 *
 * 2. **Le stock reste une projection** (RULE-002). Les écarts d'inventaire se
 *    calculent depuis `StockMovement[]` ; l'étape ne « corrige » rien, elle émet
 *    un mouvement d'ajustement motivé.
 *
 * 3. **La validation finale verrouille** (RULE-009). Après elle, aucun fait daté
 *    de cette journée n'entre plus pour ce site. Seul un OWNER rouvre, avec un
 *    motif, et la réouverture s'ajoute à l'historique au lieu de l'effacer.
 */

/* ------------------------------------------------------------ Journée métier */

/** Journée métier au format `AAAA-MM-JJ` — la date de la caisse, pas celle du serveur. */
export type BusinessDate = string;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const MONTHS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Journée métier d'un horodatage.
 *
 * Le café ferme après minuit : une vente encaissée à 1 h du matin appartient à
 * la veille pour celui qui compte la caisse. `dayStartHour` décale la bascule ;
 * à 0, la journée métier est la journée civile locale.
 */
export function businessDateOf(
  timestamp: string,
  policy: ClosingPolicy = DEFAULT_CLOSING_POLICY,
): BusinessDate {
  if (DATE_ONLY.test(timestamp)) return timestamp;
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) throw new Error(`Horodatage illisible : ${timestamp}`);
  d.setHours(d.getHours() - policy.dayStartHour);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** « 13 août 2026 » — une date se lit, elle ne se décode pas. */
export function formatBusinessDate(date: BusinessDate): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  return `${d === 1 ? '1er' : d} ${MONTHS[m - 1]} ${y}`;
}

/* ---------------------------------------------------------------- Politique */

export interface ClosingPolicy {
  /**
   * Seuil de justification de la caisse. En dessous, l'écart existe mais ne
   * fait pas faute — rendre la monnaie produit toujours quelques pièces de
   * décalage. Au-delà de 2 000 FCFA, `evaluateRules` réveille en plus le
   * manager : justifier et alerter sont deux seuils différents.
   */
  cashToleranceFcfa: number;
  /** Même logique sur le rapprochement des canaux Mobile Money / carte. */
  salesToleranceFcfa: number;
  /** Un écart de stock se juge en argent, pas en grammes : 10 g de sucre ≠ 1 L de lait. */
  stockToleranceFcfa: number;
  /** Heure de bascule de la journée métier (0 = journée civile). */
  dayStartHour: number;
  /** Un motif d'un seul caractère n'est pas un motif. */
  minReasonLength: number;
  /** RULE-009 — qui peut rouvrir une journée verrouillée. */
  reopenRoles: readonly Role[];
}

export const DEFAULT_CLOSING_POLICY: ClosingPolicy = {
  cashToleranceFcfa: 500,
  salesToleranceFcfa: 500,
  stockToleranceFcfa: 1000,
  dayStartHour: 0,
  minReasonLength: 4,
  reopenRoles: ['OWNER'],
};

/* ----------------------------------------------------------- Intentions */

/**
 * Types d'événements que la clôture ajoute au vocabulaire du §55.
 * `EVENT_TYPES` (types.ts) ne les connaît pas encore — voir le handoff.
 */
export const CLOSING_EVENT_TYPES = ['SALES_RECONCILED', 'DAY_CLOSED', 'DAY_REOPENED'] as const;
export type ClosingEventType = EventType | (typeof CLOSING_EVENT_TYPES)[number];

/**
 * Une intention d'événement : le domaine décrit le fait, le store l'habille
 * (id d'idempotence, appareil, statut de synchro) via `makeEvent`.
 */
export interface ClosingEventDraft<P = unknown> {
  eventType: ClosingEventType;
  entityType: string;
  entityId: UUID;
  payload: P;
}

/** Arguments de `makeMovement`, sous forme d'objet — RULE-003. */
export interface StockMovementDraft {
  itemId: UUID;
  locationId: UUID;
  quantity: number;
  unit: Unit;
  movementType: MovementType;
  referenceType: string;
  referenceId: UUID;
}

/** Arguments de `makeAudit`. */
export interface AuditDraft {
  action: string;
  detail: string;
  reference?: string;
}

/* -------------------------------------------------- Verrouillage RULE-009 */

export interface DayReopening {
  id: UUID;
  reopenedBy: UUID;
  role: Role;
  reason: string;
  reopenedAt: string;
}

/**
 * La signature d'une journée.
 *
 * `record` conserve les chiffres tels qu'ils étaient au moment de la signature :
 * une signature doit rester relisible même si les faits sont rejoués plus tard.
 * Aucun niveau de stock n'y figure — seulement la *valeur* de l'écart constaté,
 * qui est un montant, pas un état de stock.
 */
export interface DayClosure {
  id: UUID;
  siteId: UUID;
  businessDate: BusinessDate;
  status: 'LOCKED' | 'REOPENED';
  closedBy: UUID;
  closedAt: string;
  record: {
    countedCash: number;
    cashVariance: number;
    cashVarianceReason?: string;
    salesVariance: number;
    salesVarianceReason?: string;
    stockVarianceValue: number;
    expensesTotal: number;
    revenue: number;
  };
  /** Une réouverture s'ajoute, elle n'efface jamais la précédente. */
  reopenings: DayReopening[];
}

/** Le minimum que le domaine doit connaître pour répondre « cette journée est-elle fermée ? ». */
export interface ClosingState {
  closures: DayClosure[];
}

export function dayClosureOf(
  date: string,
  siteId: UUID,
  state: ClosingState,
  policy: ClosingPolicy = DEFAULT_CLOSING_POLICY,
): DayClosure | null {
  const target = businessDateOf(date, policy);
  return state.closures.find((c) => c.siteId === siteId && c.businessDate === target) ?? null;
}

/**
 * RULE-009 — première ligne de défense, côté client.
 *
 * PostgreSQL pose la même contrainte ; la version locale existe pour que
 * l'utilisateur lise un refus compréhensible au lieu d'une erreur serveur,
 * et pour que le refus arrive même hors ligne (RULE-010).
 */
export function isDayLocked(
  date: string,
  siteId: UUID,
  state: ClosingState,
  policy: ClosingPolicy = DEFAULT_CLOSING_POLICY,
): boolean {
  const closure = dayClosureOf(date, siteId, state, policy);
  return closure !== null && closure.status === 'LOCKED';
}

export interface EventCandidate {
  siteId: UUID;
  /** Horodatage du fait, pas de son arrivée : c'est lui qui décide de la journée. */
  occurredAt: string;
  /** Nom de l'opération dans le message de refus : « vente », « perte », « dépense ». */
  label?: string;
}

export type EventAdmission =
  | { accepted: true }
  | { accepted: false; businessDate: BusinessDate; message: string };

/**
 * Le contrôle qu'un fait entrant doit franchir avant d'être écrit.
 * À appeler dans `completeSale`, `recordWaste`, `recordExpense`, `receiveGoods`…
 */
export function admitEvent(
  candidate: EventCandidate,
  state: ClosingState,
  policy: ClosingPolicy = DEFAULT_CLOSING_POLICY,
): EventAdmission {
  const businessDate = businessDateOf(candidate.occurredAt, policy);
  if (!isDayLocked(businessDate, candidate.siteId, state, policy)) return { accepted: true };
  const what = candidate.label ?? 'opération';
  return {
    accepted: false,
    businessDate,
    message:
      `La journée du ${formatBusinessDate(businessDate)} est clôturée. ` +
      `Cette ${what} ne peut plus y être ajoutée. ` +
      `Un Owner peut rouvrir la journée avec un motif, sinon datez-la d'aujourd'hui.`,
  };
}

/** Bandeau à afficher en tête d'un écran de saisie, ou `null` si la journée est ouverte. */
export function lockNotice(
  date: string,
  siteId: UUID,
  state: ClosingState,
  policy: ClosingPolicy = DEFAULT_CLOSING_POLICY,
): string | null {
  if (!isDayLocked(date, siteId, state, policy)) return null;
  return `Journée du ${formatBusinessDate(businessDateOf(date, policy))} clôturée — plus aucune saisie n'y entre.`;
}

/* ------------------------------------------------------------ Réouverture */

export interface ReopenRequest {
  actor: { id: UUID; role: Role };
  reason: string;
  at?: string;
}

export type ReopenOutcome =
  | { ok: true; closure: DayClosure; events: ClosingEventDraft[]; audit: AuditDraft[] }
  | { ok: false; error: ClosingError; message: string };

/**
 * Réouverture explicite d'une journée verrouillée.
 *
 * Rouvrir n'est pas annuler : la clôture reste, son statut change, et le motif
 * est archivé avec son auteur. Un OWNER seul en porte la responsabilité — un
 * manager qui pourrait rouvrir sa propre journée viderait RULE-009 de son sens.
 */
export function reopenDay(
  date: string,
  siteId: UUID,
  state: ClosingState,
  request: ReopenRequest,
  policy: ClosingPolicy = DEFAULT_CLOSING_POLICY,
): ReopenOutcome {
  const closure = dayClosureOf(date, siteId, state, policy);
  if (!closure || closure.status !== 'LOCKED') {
    return {
      ok: false,
      error: 'DAY_NOT_LOCKED',
      message: `La journée du ${formatBusinessDate(businessDateOf(date, policy))} n'est pas clôturée : il n'y a rien à rouvrir.`,
    };
  }

  if (!policy.reopenRoles.includes(request.actor.role)) {
    return {
      ok: false,
      error: 'FORBIDDEN',
      message: "Seul un Owner peut rouvrir une journée clôturée. Demandez-lui de le faire depuis son cockpit.",
    };
  }

  const reason = request.reason.trim();
  if (reason.length < policy.minReasonLength) {
    return {
      ok: false,
      error: 'REASON_REQUIRED',
      message: 'Expliquez pourquoi la journée doit être rouverte : le motif restera au journal.',
    };
  }

  const at = request.at ?? new Date().toISOString();
  const reopening: DayReopening = {
    id: uuid(),
    reopenedBy: request.actor.id,
    role: request.actor.role,
    reason,
    reopenedAt: at,
  };

  const reopened: DayClosure = {
    ...closure,
    status: 'REOPENED',
    reopenings: [...closure.reopenings, reopening],
  };

  return {
    ok: true,
    closure: reopened,
    events: [
      {
        eventType: 'DAY_REOPENED',
        entityType: 'DayClosure',
        entityId: closure.id,
        payload: { businessDate: closure.businessDate, siteId, reason, reopenedBy: request.actor.id },
      },
    ],
    audit: [
      {
        action: `Réouverture de la journée du ${formatBusinessDate(closure.businessDate)}`,
        detail: `motif : ${reason}`,
        reference: `closure:${closure.id.slice(0, 8)}`,
      },
    ],
  };
}

/* -------------------------------------------------------- Les cinq étapes */

export const CLOSING_STEPS = [
  'CASH_COUNT',
  'SALES_RECONCILIATION',
  'STOCK_VARIANCE',
  'EXPENSES',
  'FINAL_VALIDATION',
] as const;
export type ClosingStepId = (typeof CLOSING_STEPS)[number];

export interface ClosingStepSpec {
  id: ClosingStepId;
  label: string;
  /** Ce que la personne déclare, à la première personne. */
  declares: string;
  /** Ce que le système en déduit — et qui reste masqué avant la déclaration. */
  derives: string[];
  events: ClosingEventType[];
}

export const CLOSING_STEP_SPECS: ClosingStepSpec[] = [
  {
    id: 'CASH_COUNT',
    label: 'Comptage de caisse',
    declares: "J'ai compté 143 500 FCFA en caisse",
    derives: ['Attendu = fond de caisse + ventes espèces − dépenses payées en espèces', 'Écart de caisse'],
    events: ['CASH_SESSION_CLOSED'],
  },
  {
    id: 'SALES_RECONCILIATION',
    label: 'Rapprochement des ventes',
    declares: "Mon relevé Mobile Money affiche 88 000 FCFA",
    derives: ['Total encaissé par canal', 'Écart par canal', 'Ventes annulées de la journée'],
    events: ['SALES_RECONCILED'],
  },
  {
    id: 'STOCK_VARIANCE',
    label: 'Pertes et écarts de stock',
    declares: "J'ai compté 7,5 L de lait",
    derives: [
      'Théorique projeté depuis les mouvements (RULE-002)',
      "Écart valorisé au coût moyen pondéré",
      "Mouvement d'ajustement motivé",
    ],
    events: ['STOCK_COUNTED', 'STOCK_VARIANCE_DETECTED'],
  },
  {
    id: 'EXPENSES',
    label: 'Dépenses de la journée',
    declares: "Je confirme les dépenses enregistrées aujourd'hui",
    derives: ['Total par catégorie', 'Part payée en espèces, qui explique la caisse attendue'],
    events: [],
  },
  {
    id: 'FINAL_VALIDATION',
    label: 'Validation de la journée',
    declares: "Je clôture la journée",
    derives: ['Récapitulatif du jour', 'Verrouillage : plus aucun fait daté de ce jour (RULE-009)'],
    events: ['DAY_CLOSED'],
  },
];

export const CLOSING_STEP_LABEL: Record<ClosingStepId, string> = {
  CASH_COUNT: 'Comptage de caisse',
  SALES_RECONCILIATION: 'Rapprochement des ventes',
  STOCK_VARIANCE: 'Pertes et écarts de stock',
  EXPENSES: 'Dépenses de la journée',
  FINAL_VALIDATION: 'Validation de la journée',
};

const stepIndex = (step: ClosingStepId) => CLOSING_STEPS.indexOf(step);

/* ---------------------------------------------------------- Déclarations */

export interface StockCountEntry {
  itemId: UUID;
  locationId: UUID;
  /** Ce que la personne a compté, dans l'unité de l'article. */
  counted: number;
  reason?: WasteReason;
  note?: string;
}

export type ClosingDeclaration =
  | { step: 'CASH_COUNT'; countedCash: number; reason?: string }
  | {
      step: 'SALES_RECONCILIATION';
      /** Ce que le canal affiche, relevé sur le téléphone ou le terminal. */
      declaredTotals: Partial<Record<PaymentMethod, number>>;
      reason?: string;
    }
  | { step: 'STOCK_VARIANCE'; counts: StockCountEntry[] }
  | { step: 'EXPENSES'; confirmed: boolean; note?: string }
  | { step: 'FINAL_VALIDATION'; confirmed: boolean };

export type DeclarationOf<S extends ClosingStepId> = Extract<ClosingDeclaration, { step: S }>;

export interface ClosingStepRecord {
  step: ClosingStepId;
  declaration: ClosingDeclaration;
  completedAt: string;
  completedBy: UUID;
}

export interface ClosingSession {
  id: UUID;
  siteId: UUID;
  businessDate: BusinessDate;
  status: 'OPEN' | 'VALIDATED';
  steps: ClosingStepRecord[];
}

export function startClosing(siteId: UUID, businessDate: BusinessDate): ClosingSession {
  return { id: uuid(), siteId, businessDate, status: 'OPEN', steps: [] };
}

export function declarationOf<S extends ClosingStepId>(
  session: ClosingSession,
  step: S,
): DeclarationOf<S> | null {
  const record = session.steps.find((s) => s.step === step);
  return record ? (record.declaration as DeclarationOf<S>) : null;
}

const isDone = (session: ClosingSession, step: ClosingStepId) =>
  session.steps.some((s) => s.step === step);

/* ------------------------------------------------------------- Contexte */

export interface ClosingContext extends ClosingState {
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
  /** Événements encore dans la file. Information, jamais un blocage (RULE-010). */
  pendingEventCount: number;
  /** Articles recomptés à la clôture. Vide = pas de comptage ce soir. */
  countScope: { itemId: UUID; locationId: UUID }[];
}

export type ClosingContextInput =
  Omit<ClosingContext, 'now' | 'policy' | 'pendingEventCount' | 'countScope' | 'closures'>
  & Partial<Pick<ClosingContext, 'now' | 'policy' | 'pendingEventCount' | 'countScope' | 'closures'>>;

export function closingContext(input: ClosingContextInput): ClosingContext {
  return {
    ...input,
    now: input.now ?? new Date().toISOString(),
    policy: input.policy ?? DEFAULT_CLOSING_POLICY,
    pendingEventCount: input.pendingEventCount ?? 0,
    countScope: input.countScope ?? [],
    closures: input.closures ?? [],
  };
}

const sameDay = (ctx: ClosingContext, timestamp: string) =>
  businessDateOf(timestamp, ctx.policy) === ctx.businessDate;

/** Ventes encaissées de la journée. Les annulées ne rapportent rien et sortent du total. */
function salesOfDay(ctx: ClosingContext): Sale[] {
  return ctx.sales.filter(
    (s) => s.siteId === ctx.siteId && s.status === 'COMPLETED' && sameDay(ctx, s.createdAt),
  );
}

function voidedOfDay(ctx: ClosingContext): Sale[] {
  return ctx.sales.filter(
    (s) => s.siteId === ctx.siteId && s.status !== 'COMPLETED' && sameDay(ctx, s.createdAt),
  );
}

/** `Expense` ne porte pas de `siteId` : on filtre sur la date seule (voir handoff). */
function expensesOfDay(ctx: ClosingContext): Expense[] {
  return ctx.expenses.filter((e) => sameDay(ctx, e.createdAt));
}

/**
 * Mouvements du site jusqu'à la fin de la journée clôturée. On ne coupe pas au
 * début de la journée : le stock est la somme de toute l'histoire (RULE-002),
 * pas du seul delta du jour.
 */
function movementsUpToDay(ctx: ClosingContext): StockMovement[] {
  return ctx.movements.filter(
    (m) => m.siteId === ctx.siteId && businessDateOf(m.createdAt, ctx.policy) <= ctx.businessDate,
  );
}

const costOf = (item: Item) => item.weightedAvgCost ?? 0;

/* ------------------------------------------------- Le masque de l'attendu */

/**
 * Tant que la déclaration n'a pas eu lieu, la valeur dérivée n'existe pas —
 * le champ n'est pas seulement caché à l'écran, il est absent du type. Un écran
 * ne *peut pas* afficher l'attendu par inadvertance.
 */
export type Reveal<T> = { revealed: false } | ({ revealed: true } & T);

const MASKED = { revealed: false } as const;

/* ------------------------------------------------ Étape 1 — comptage caisse */

export interface CashCountReveal {
  counted: number;
  expected: number;
  variance: number;
  /** L'écart existe mais reste sous le seuil : constaté, pas fautif. */
  withinTolerance: boolean;
  requiresReason: boolean;
  breakdown: { openingCash: number; cashSales: number; cashExpenses: number };
}

/**
 * L'attendu de caisse.
 *
 * Les dépenses réglées en espèces sortent du tiroir : l'écran « Nouvelle
 * dépense » le promet déjà à l'utilisateur (« … de moins dans le fond de caisse
 * attendu à la clôture »), l'attendu doit tenir cette promesse.
 */
export function cashCountView(
  ctx: ClosingContext,
  declaration: DeclarationOf<'CASH_COUNT'> | null,
): Reveal<CashCountReveal> {
  return declaration ? { revealed: true, ...computeCash(ctx, declaration) } : MASKED;
}

function computeCash(ctx: ClosingContext, declaration: DeclarationOf<'CASH_COUNT'>): CashCountReveal {
  const openingCash = ctx.cashSessions
    .filter((s) => s.siteId === ctx.siteId && sameDay(ctx, s.openedAt))
    .reduce((sum, s) => sum + s.openingCash, 0);
  const cashSales = salesOfDay(ctx)
    .filter((s) => s.paymentMethod === 'CASH')
    .reduce((sum, s) => sum + s.total, 0);
  const cashExpenses = expensesOfDay(ctx)
    .filter((e) => e.paymentMethod === 'CASH')
    .reduce((sum, e) => sum + e.amount, 0);

  const expected = openingCash + cashSales - cashExpenses;
  const variance = Math.round(declaration.countedCash - expected);
  const withinTolerance = Math.abs(variance) <= ctx.policy.cashToleranceFcfa;

  return {
    counted: declaration.countedCash,
    expected,
    variance,
    withinTolerance,
    requiresReason: !withinTolerance,
    breakdown: { openingCash, cashSales, cashExpenses },
  };
}

/* ------------------------------------------- Étape 2 — rapprochement ventes */

export interface SalesMethodLine {
  method: PaymentMethod;
  label: string;
  count: number;
  systemTotal: number;
  declaredTotal: number;
  variance: number;
  requiresReason: boolean;
}

export interface SalesReconciliationReveal {
  lines: SalesMethodLine[];
  salesCount: number;
  revenue: number;
  systemTotal: number;
  declaredTotal: number;
  variance: number;
  requiresReason: boolean;
  voided: { id: UUID; number: number; total: number; reason?: string }[];
  /** File de synchronisation : à afficher, jamais à opposer (RULE-010). */
  pendingEventCount: number;
}

/** Canaux hors espèces réellement utilisés aujourd'hui — les espèces sont l'étape 1. */
export function reconcilableMethods(ctx: ClosingContext): PaymentMethod[] {
  const seen = new Set<PaymentMethod>();
  for (const s of salesOfDay(ctx)) if (s.paymentMethod !== 'CASH') seen.add(s.paymentMethod);
  return [...seen];
}

export function salesReconciliationView(
  ctx: ClosingContext,
  declaration: DeclarationOf<'SALES_RECONCILIATION'> | null,
): Reveal<SalesReconciliationReveal> {
  // Rien à relever : le masque protège un comptage, il n'a aucun sens sans comptage.
  if (!declaration && reconcilableMethods(ctx).length > 0) return MASKED;
  return { revealed: true, ...computeSales(ctx, declaration) };
}

function computeSales(
  ctx: ClosingContext,
  declaration: DeclarationOf<'SALES_RECONCILIATION'> | null,
): SalesReconciliationReveal {
  const methods = reconcilableMethods(ctx);
  const declared = declaration?.declaredTotals ?? {};
  const daySales = salesOfDay(ctx);

  const lines: SalesMethodLine[] = methods.map((method) => {
    const rows = daySales.filter((s) => s.paymentMethod === method);
    const systemTotal = rows.reduce((sum, s) => sum + s.total, 0);
    const declaredTotal = declared[method] ?? 0;
    const variance = Math.round(declaredTotal - systemTotal);
    return {
      method,
      label: PAYMENT_LABEL[method],
      count: rows.length,
      systemTotal,
      declaredTotal,
      variance,
      requiresReason: Math.abs(variance) > ctx.policy.salesToleranceFcfa,
    };
  });

  const systemTotal = lines.reduce((sum, l) => sum + l.systemTotal, 0);
  const declaredTotal = lines.reduce((sum, l) => sum + l.declaredTotal, 0);

  return {
    lines,
    salesCount: daySales.length,
    revenue: daySales.reduce((sum, s) => sum + s.total, 0),
    systemTotal,
    declaredTotal,
    variance: Math.round(declaredTotal - systemTotal),
    requiresReason: lines.some((l) => l.requiresReason),
    voided: voidedOfDay(ctx).map((s) => ({
      id: s.id,
      number: s.number,
      total: s.total,
      reason: s.voidReason,
    })),
    pendingEventCount: ctx.pendingEventCount,
  };
}

/* --------------------------------------------- Étape 3 — écarts de stock */

export interface StockVarianceLine {
  itemId: UUID;
  name: string;
  unit: Unit;
  locationId: UUID;
  /** Projeté depuis les mouvements — jamais lu dans une colonne (RULE-002). */
  theoretical: number;
  counted: number;
  delta: number;
  /** Écart valorisé au coût moyen pondéré. Négatif = marchandise manquante. */
  value: number;
  requiresReason: boolean;
  reason?: WasteReason;
  note?: string;
}

export interface StockVarianceReveal {
  lines: StockVarianceLine[];
  /** Somme signée des écarts, en FCFA. */
  totalValue: number;
  requiresReason: boolean;
  /** Lignes hors tolérance encore sans motif. */
  unjustified: StockVarianceLine[];
}

export function stockVarianceView(
  ctx: ClosingContext,
  declaration: DeclarationOf<'STOCK_VARIANCE'> | null,
): Reveal<StockVarianceReveal> {
  if (!declaration && ctx.countScope.length > 0) return MASKED;
  return { revealed: true, ...computeStock(ctx, declaration) };
}

function computeStock(
  ctx: ClosingContext,
  declaration: DeclarationOf<'STOCK_VARIANCE'> | null,
): StockVarianceReveal {
  const counts = declaration?.counts ?? [];
  const byId = new Map(ctx.items.map((i) => [i.id, i]));
  const history = movementsUpToDay(ctx);

  const lines: StockVarianceLine[] = counts.flatMap((entry) => {
    const item = byId.get(entry.itemId);
    if (!item) return [];
    const theoretical = stockAt(history, entry.itemId, entry.locationId, item);
    const delta = Math.round((entry.counted - theoretical) * 1000) / 1000;
    const value = Math.round(delta * costOf(item));
    return [{
      itemId: item.id,
      name: item.name,
      unit: item.unit,
      locationId: entry.locationId,
      theoretical,
      counted: entry.counted,
      delta,
      value,
      requiresReason: Math.abs(value) > ctx.policy.stockToleranceFcfa,
      reason: entry.reason,
      note: entry.note,
    }];
  });

  const unjustified = lines.filter((l) => l.requiresReason && !l.reason);

  return {
    lines,
    totalValue: lines.reduce((sum, l) => sum + l.value, 0),
    requiresReason: lines.some((l) => l.requiresReason),
    unjustified,
  };
}

/* --------------------------------------------------- Étape 4 — dépenses */

export interface ExpensesReview {
  total: number;
  cashTotal: number;
  count: number;
  byCategory: { category: Expense['category']; label: string; total: number }[];
  /** Dépenses que personne ne saura expliquer demain — signalées, pas bloquantes. */
  warnings: string[];
}

/**
 * Rien n'est masqué ici : l'étape ne fait compter personne, elle fait
 * reconnaître ce qui est déjà déclaré. Le masque est une discipline de
 * comptage, pas une décoration.
 */
export function expensesView(ctx: ClosingContext): ExpensesReview {
  const rows = expensesOfDay(ctx);
  const totals = new Map<Expense['category'], number>();
  for (const e of rows) totals.set(e.category, (totals.get(e.category) ?? 0) + e.amount);

  const warnings = rows
    .filter((e) => !e.description.trim())
    .map((e) => `Une dépense de ${fcfa(e.amount)} FCFA n'a pas de description.`);

  return {
    total: rows.reduce((sum, e) => sum + e.amount, 0),
    cashTotal: rows.filter((e) => e.paymentMethod === 'CASH').reduce((sum, e) => sum + e.amount, 0),
    count: rows.length,
    byCategory: [...totals.entries()]
      .map(([category, total]) => ({ category, label: EXPENSE_LABEL[category], total }))
      .sort((a, b) => b.total - a.total),
    warnings,
  };
}

/* ------------------------------------------------- Étape 5 — validation */

export interface DayRecap {
  businessDate: BusinessDate;
  revenue: number;
  cogs: number;
  grossMargin: number;
  salesCount: number;
  expensesTotal: number;
  countedCash: number;
  cashVariance: number;
  salesVariance: number;
  /** Signé : négatif = marchandise partie sans vente. */
  stockVarianceValue: number;
}

export type FinalValidationView =
  | { ready: false; blockers: string[] }
  | { ready: true; recap: DayRecap };

/**
 * Le récapitulatif n'apparaît qu'une fois les quatre étapes franchies : il
 * contient l'attendu de caisse, qui ne doit pas fuiter avant le comptage.
 *
 * Volontairement absent : un « résultat net ». L'achat crée aujourd'hui une
 * dépense *et* du stock consommé plus tard en COGS ; trancher ce double
 * comptage est un sujet de Sprint 7, pas une décision à prendre en douce dans
 * un écran de clôture.
 */
export function finalValidationView(session: ClosingSession, ctx: ClosingContext): FinalValidationView {
  const blockers = missingBefore('FINAL_VALIDATION', session, ctx);
  if (blockers.length) return { ready: false, blockers };

  // Les quatre étapes sont franchies : les déclarations existent forcément.
  const cash = computeCash(ctx, declarationOf(session, 'CASH_COUNT')!);
  const sales = computeSales(ctx, declarationOf(session, 'SALES_RECONCILIATION'));
  const stock = computeStock(ctx, declarationOf(session, 'STOCK_VARIANCE'));
  const expenses = expensesView(ctx);
  const daySales = salesOfDay(ctx);

  return {
    ready: true,
    recap: {
      businessDate: ctx.businessDate,
      revenue: daySales.reduce((sum, s) => sum + s.total, 0),
      cogs: daySales.reduce((sum, s) => sum + s.cogs, 0),
      grossMargin: daySales.reduce((sum, s) => sum + (s.total - s.cogs), 0),
      salesCount: daySales.length,
      expensesTotal: expenses.total,
      countedCash: cash.counted,
      cashVariance: cash.variance,
      salesVariance: sales.variance,
      stockVarianceValue: stock.totalValue,
    },
  };
}

/* ------------------------------------------------- Machine à états */

export type ClosingError =
  | 'DAY_ALREADY_LOCKED'
  | 'DAY_NOT_LOCKED'
  | 'STEP_ALREADY_COMPLETED'
  | 'STEP_NOT_REACHABLE'
  | 'REASON_REQUIRED'
  | 'CONFIRMATION_REQUIRED'
  | 'INCOMPLETE_COUNT'
  | 'FORBIDDEN'
  | 'INVALID_DECLARATION';

export type StepState = 'PENDING' | 'CURRENT' | 'DONE' | 'LOCKED';

export interface ClosingStepView {
  step: ClosingStepId;
  label: string;
  state: StepState;
  /** Franchissable maintenant : les étapes précédentes sont faites. */
  reachable: boolean;
  /** Revenir dessus reste possible tant que la journée n'est pas validée. */
  revertable: boolean;
  /** Ce qui manque, dit en clair. Vide = il ne manque qu'un geste de l'utilisateur. */
  blockers: string[];
}

/** Ce qui empêche d'atteindre `step` : les étapes antérieures non franchies. */
function missingBefore(step: ClosingStepId, session: ClosingSession, ctx: ClosingContext): string[] {
  const blockers: string[] = [];
  for (const earlier of CLOSING_STEPS.slice(0, stepIndex(step))) {
    if (!isDone(session, earlier)) blockers.push(`${CLOSING_STEP_LABEL[earlier]} : à faire.`);
  }
  if (step === 'FINAL_VALIDATION' && !can(ctx.actor.role, 'CLOSE_DAY')) {
    blockers.push('Seul un manager ou un owner peut clôturer la journée.');
  }
  return blockers;
}

/** Ce que l'étape attend de l'utilisateur, avant toute déclaration. */
function pendingWork(step: ClosingStepId, ctx: ClosingContext): string[] {
  switch (step) {
    case 'CASH_COUNT':
      return ['Comptez les espèces réellement présentes en caisse.'];
    case 'SALES_RECONCILIATION': {
      const methods = reconcilableMethods(ctx);
      if (!methods.length) return [];
      return [`Relevez le total affiché par ${methods.map((m) => PAYMENT_LABEL[m]).join(' et ')}.`];
    }
    case 'STOCK_VARIANCE': {
      if (!ctx.countScope.length) return [];
      const n = ctx.countScope.length;
      return [`Comptez ${n} article${n > 1 ? 's' : ''} avant de fermer le stock.`];
    }
    case 'EXPENSES':
      return ["Confirmez les dépenses enregistrées aujourd'hui."];
    case 'FINAL_VALIDATION':
      return ['Relisez le récapitulatif, puis clôturez.'];
  }
}

/** L'état de la clôture, tel qu'un écran doit le rendre. */
export function closingProgress(session: ClosingSession, ctx: ClosingContext): ClosingStepView[] {
  const validated = session.status === 'VALIDATED';
  return CLOSING_STEPS.map((step) => {
    const done = isDone(session, step);
    const before = missingBefore(step, session, ctx);
    const reachable = !validated && !done && before.length === 0;
    const state: StepState = validated ? 'LOCKED' : done ? 'DONE' : reachable ? 'CURRENT' : 'PENDING';
    return {
      step,
      label: CLOSING_STEP_LABEL[step],
      state,
      reachable,
      revertable: done && !validated,
      blockers: done ? [] : before.length ? before : pendingWork(step, ctx),
    };
  });
}

export type StepOutcome =
  | {
      ok: true;
      session: ClosingSession;
      events: ClosingEventDraft[];
      movements: StockMovementDraft[];
      audit: AuditDraft[];
      /** Renseigné par la seule validation finale : c'est elle qui verrouille. */
      closure: DayClosure | null;
    }
  | { ok: false; error: ClosingError; message: string };

type StepFailure = Extract<StepOutcome, { ok: false }>;

const fail = (error: ClosingError, message: string): StepFailure => ({ ok: false, error, message });

/**
 * Franchit une étape.
 *
 * Rien n'est appliqué ici : la fonction valide la déclaration et retourne les
 * faits à écrire. C'est le store qui les commit en une transaction, comme pour
 * une vente — un franchissement à moitié écrit serait pire qu'un refus.
 */
export function completeStep(
  session: ClosingSession,
  ctx: ClosingContext,
  declaration: ClosingDeclaration,
): StepOutcome {
  const step = declaration.step;

  if (session.status === 'VALIDATED') {
    return fail(
      'DAY_ALREADY_LOCKED',
      `La journée du ${formatBusinessDate(session.businessDate)} est déjà clôturée. Un Owner doit la rouvrir pour y revenir.`,
    );
  }
  if (isDayLocked(session.businessDate, session.siteId, ctx, ctx.policy)) {
    return fail(
      'DAY_ALREADY_LOCKED',
      `La journée du ${formatBusinessDate(session.businessDate)} a déjà été clôturée sur un autre appareil.`,
    );
  }
  if (isDone(session, step)) {
    return fail(
      'STEP_ALREADY_COMPLETED',
      `${CLOSING_STEP_LABEL[step]} : déjà fait. Revenez dessus si vous voulez le refaire.`,
    );
  }
  // Le refus de droit se dit avant le refus d'ordre : « vous n'avez pas le droit »
  // et « ce n'est pas encore le moment » n'appellent pas la même réaction.
  if (step === 'FINAL_VALIDATION' && !can(ctx.actor.role, 'CLOSE_DAY')) {
    return fail('FORBIDDEN', 'Seul un manager ou un owner peut clôturer la journée.');
  }
  const before = missingBefore(step, session, ctx);
  if (before.length) return fail('STEP_NOT_REACHABLE', before[0]);

  const built = buildStep(session, ctx, declaration);
  if (!built.ok) return built;

  const record: ClosingStepRecord = {
    step,
    declaration,
    completedAt: ctx.now,
    completedBy: ctx.actor.id,
  };

  return {
    ...built,
    session: {
      ...session,
      status: step === 'FINAL_VALIDATION' ? 'VALIDATED' : session.status,
      steps: [...session.steps, record],
    },
  };
}

type Built = Extract<StepOutcome, { ok: true }>;

function buildStep(
  session: ClosingSession,
  ctx: ClosingContext,
  declaration: ClosingDeclaration,
): Built | StepFailure {
  const empty: Built = {
    ok: true,
    session,
    events: [],
    movements: [],
    audit: [],
    closure: null,
  };

  switch (declaration.step) {
    /* ------------------------------------------------------ 1. Caisse */
    case 'CASH_COUNT': {
      if (!Number.isFinite(declaration.countedCash) || declaration.countedCash < 0) {
        return fail('INVALID_DECLARATION', 'Le montant compté doit être un nombre positif.');
      }
      const view = computeCash(ctx, declaration);

      const reason = declaration.reason?.trim() ?? '';
      if (view.requiresReason && reason.length < ctx.policy.minReasonLength) {
        return fail(
          'REASON_REQUIRED',
          `L'écart de ${fcfa(view.variance)} FCFA dépasse la tolérance de ${fcfa(ctx.policy.cashToleranceFcfa)} FCFA. Dites ce qui s'est passé avant de fermer la caisse.`,
        );
      }

      // La session encore ouverte est celle qu'on ferme ; à défaut, la clôture porte l'événement.
      const openTill = ctx.cashSessions.find((s) => s.siteId === ctx.siteId && !s.closedAt);
      return {
        ...empty,
        events: [{
          eventType: 'CASH_SESSION_CLOSED',
          entityType: 'CashSession',
          entityId: openTill?.id ?? session.id,
          payload: {
            businessDate: ctx.businessDate,
            expected: view.expected,
            countedCash: view.counted,
            variance: view.variance,
            reason: reason || undefined,
          },
        }],
        audit: [{
          action: `Caisse comptée — écart ${view.variance >= 0 ? '+' : ''}${fcfa(view.variance)} FCFA`,
          detail: reason
            ? `motif : ${reason}`
            : view.variance === 0
              ? 'caisse juste'
              : 'écart sous la tolérance',
          reference: `closing:${session.id.slice(0, 8)}`,
        }],
      };
    }

    /* ------------------------------------------ 2. Rapprochement ventes */
    case 'SALES_RECONCILIATION': {
      const methods = reconcilableMethods(ctx);
      const missing = methods.filter((m) => !Number.isFinite(declaration.declaredTotals[m] ?? NaN));
      if (missing.length) {
        return fail(
          'INCOMPLETE_COUNT',
          `Relevez le total ${missing.map((m) => PAYMENT_LABEL[m]).join(' et ')} avant de rapprocher.`,
        );
      }

      const view = computeSales(ctx, declaration);

      const reason = declaration.reason?.trim() ?? '';
      if (view.requiresReason && reason.length < ctx.policy.minReasonLength) {
        const offender = view.lines.find((l) => l.requiresReason)!;
        return fail(
          'REASON_REQUIRED',
          `${offender.label} : ${fcfa(offender.variance)} FCFA d'écart avec le système. Expliquez avant de continuer.`,
        );
      }

      return {
        ...empty,
        events: [{
          eventType: 'SALES_RECONCILED',
          entityType: 'DayClosing',
          entityId: session.id,
          payload: {
            businessDate: ctx.businessDate,
            siteId: ctx.siteId,
            lines: view.lines.map((l) => ({
              method: l.method,
              systemTotal: l.systemTotal,
              declaredTotal: l.declaredTotal,
              variance: l.variance,
            })),
            variance: view.variance,
            reason: reason || undefined,
          },
        }],
        audit: [{
          action: `Ventes rapprochées — ${view.salesCount} vente(s), ${fcfa(view.revenue)} FCFA`,
          detail: view.lines.length
            ? view.lines.map((l) => `${l.label} ${l.variance >= 0 ? '+' : ''}${fcfa(l.variance)}`).join(' · ')
            : 'aucune vente hors espèces',
          reference: `closing:${session.id.slice(0, 8)}`,
        }],
      };
    }

    /* ------------------------------------------------ 3. Écarts de stock */
    case 'STOCK_VARIANCE': {
      const counted = new Set(declaration.counts.map((c) => `${c.itemId}@${c.locationId}`));
      const notCounted = ctx.countScope.filter((s) => !counted.has(`${s.itemId}@${s.locationId}`));
      if (notCounted.length) {
        return fail(
          'INCOMPLETE_COUNT',
          `${notCounted.length} article(s) du périmètre n'ont pas été comptés.`,
        );
      }

      const view = computeStock(ctx, declaration);

      if (view.unjustified.length) {
        const l = view.unjustified[0];
        return fail(
          'REASON_REQUIRED',
          `${l.name} : ${formatQty(Math.abs(l.delta), l.unit)} ${l.delta < 0 ? 'manquant' : 'en trop'} (${fcfa(Math.abs(l.value))} FCFA). Choisissez un motif.`,
        );
      }

      // RULE-003 : la correction n'écrit pas un niveau, elle ajoute un mouvement.
      const movements: StockMovementDraft[] = view.lines
        .filter((l) => l.delta !== 0)
        .map((l) => ({
          itemId: l.itemId,
          locationId: l.locationId,
          quantity: l.delta,
          unit: l.unit,
          movementType: 'ADJUSTMENT' as MovementType,
          referenceType: 'DayClosing',
          referenceId: session.id,
        }));

      const events: ClosingEventDraft[] = [{
        eventType: 'STOCK_COUNTED',
        entityType: 'DayClosing',
        entityId: session.id,
        payload: {
          businessDate: ctx.businessDate,
          lines: view.lines.map((l) => ({
            itemId: l.itemId,
            locationId: l.locationId,
            theoretical: l.theoretical,
            counted: l.counted,
            delta: l.delta,
            reason: l.reason,
          })),
        },
      }];

      if (view.requiresReason) {
        events.push({
          eventType: 'STOCK_VARIANCE_DETECTED',
          entityType: 'DayClosing',
          entityId: session.id,
          payload: {
            businessDate: ctx.businessDate,
            totalValue: view.totalValue,
            lines: view.lines
              .filter((l) => l.requiresReason)
              .map((l) => ({ itemId: l.itemId, delta: l.delta, value: l.value, reason: l.reason })),
          },
        });
      }

      return {
        ...empty,
        movements,
        events,
        audit: [{
          action: `Écarts de stock — ${fcfa(view.totalValue)} FCFA`,
          detail: view.lines.length
            ? view.lines
                .filter((l) => l.delta !== 0)
                .map((l) => `${l.name} ${l.delta > 0 ? '+' : ''}${formatQty(l.delta, l.unit)}${l.reason ? ` (${WASTE_LABEL[l.reason]})` : ''}`)
                .join(' · ') || 'aucun écart'
            : 'aucun article compté',
          reference: `closing:${session.id.slice(0, 8)}`,
        }],
      };
    }

    /* ---------------------------------------------------- 4. Dépenses */
    case 'EXPENSES': {
      if (!declaration.confirmed) {
        return fail(
          'CONFIRMATION_REQUIRED',
          "Confirmez les dépenses de la journée : ce sont elles qui expliquent l'argent sorti du tiroir.",
        );
      }
      const view = expensesView(ctx);
      return {
        ...empty,
        audit: [{
          action: `Dépenses confirmées — ${fcfa(view.total)} FCFA`,
          detail: `${view.count} dépense(s) · ${fcfa(view.cashTotal)} FCFA en espèces${declaration.note ? ` · ${declaration.note.trim()}` : ''}`,
          reference: `closing:${session.id.slice(0, 8)}`,
        }],
      };
    }

    /* -------------------------------------------------- 5. Validation */
    case 'FINAL_VALIDATION': {
      if (!declaration.confirmed) {
        return fail(
          'CONFIRMATION_REQUIRED',
          'Confirmez la clôture : après validation, plus aucune saisie ne pourra être datée de cette journée.',
        );
      }
      if (!can(ctx.actor.role, 'CLOSE_DAY')) {
        return fail(
          'FORBIDDEN',
          'Seul un manager ou un owner peut clôturer la journée.',
        );
      }

      const view = finalValidationView(session, ctx);
      if (!view.ready) {
        return fail('STEP_NOT_REACHABLE', view.blockers[0]);
      }

      const cashDecl = declarationOf(session, 'CASH_COUNT');
      const salesDecl = declarationOf(session, 'SALES_RECONCILIATION');
      const { recap } = view;

      const closure: DayClosure = {
        id: uuid(),
        siteId: ctx.siteId,
        businessDate: ctx.businessDate,
        status: 'LOCKED',
        closedBy: ctx.actor.id,
        closedAt: ctx.now,
        record: {
          countedCash: recap.countedCash,
          cashVariance: recap.cashVariance,
          cashVarianceReason: cashDecl?.reason?.trim() || undefined,
          salesVariance: recap.salesVariance,
          salesVarianceReason: salesDecl?.reason?.trim() || undefined,
          stockVarianceValue: recap.stockVarianceValue,
          expensesTotal: recap.expensesTotal,
          revenue: recap.revenue,
        },
        reopenings: [],
      };

      return {
        ...empty,
        closure,
        events: [{
          eventType: 'DAY_CLOSED',
          entityType: 'DayClosure',
          entityId: closure.id,
          payload: {
            businessDate: ctx.businessDate,
            siteId: ctx.siteId,
            closingSessionId: session.id,
            recap,
          },
        }],
        audit: [{
          action: `Journée du ${formatBusinessDate(ctx.businessDate)} clôturée`,
          detail: `${fcfa(recap.revenue)} FCFA de ventes · écart caisse ${recap.cashVariance >= 0 ? '+' : ''}${fcfa(recap.cashVariance)} FCFA · ${fcfa(recap.expensesTotal)} FCFA de dépenses`,
          reference: `closure:${closure.id.slice(0, 8)}`,
        }],
      };
    }
  }
}

/* --------------------------------------------------------- Revenir en arrière */

export type RevertOutcome =
  | { ok: true; session: ClosingSession; audit: AuditDraft[] }
  | { ok: false; error: ClosingError; message: string };

/**
 * Revenir sur une étape déjà franchie.
 *
 * Les étapes suivantes tombent avec elle : elles avaient été franchies contre
 * des chiffres qui viennent de changer. Après la validation finale, plus rien
 * ne bouge — c'est tout l'objet de RULE-009.
 */
export function revertStep(session: ClosingSession, step: ClosingStepId): RevertOutcome {
  if (session.status === 'VALIDATED') {
    return {
      ok: false,
      error: 'DAY_ALREADY_LOCKED',
      message: `La journée du ${formatBusinessDate(session.businessDate)} est clôturée. Un Owner doit la rouvrir pour la modifier.`,
    };
  }
  if (!isDone(session, step)) {
    return {
      ok: false,
      error: 'STEP_NOT_REACHABLE',
      message: `${CLOSING_STEP_LABEL[step]} n'a pas encore été franchie.`,
    };
  }

  const from = stepIndex(step);
  const dropped = session.steps.filter((s) => stepIndex(s.step) >= from).map((s) => s.step);

  return {
    ok: true,
    session: { ...session, steps: session.steps.filter((s) => stepIndex(s.step) < from) },
    audit: [{
      action: `Retour sur « ${CLOSING_STEP_LABEL[step]} »`,
      detail:
        dropped.length > 1
          ? `à refaire : ${dropped.map((s) => CLOSING_STEP_LABEL[s]).join(', ')}`
          : 'étape à refaire',
      reference: `closing:${session.id.slice(0, 8)}`,
    }],
  };
}
