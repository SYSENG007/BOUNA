/**
 * Trésorerie — l'argent réellement entré et sorti.
 *
 * À ne pas confondre avec la marge. Une journée peut être rentable et vider la
 * caisse : on encaisse en espèces et on paie le fournisseur le même matin.
 * C'est la trésorerie qui dit si on peut acheter demain, pas le résultat.
 *
 * Trois partis pris.
 *
 * 1. **On ne compte l'argent qu'une fois.** Une réception de marchandise crée
 *    déjà une dépense (`receiveGoods`) ; additionner les achats ET les dépenses
 *    doublerait chaque sortie. Les sorties se lisent donc dans `expenses`, qui
 *    est le journal des paiements, et jamais dans `purchases`.
 *
 * 2. **Le moyen de paiement n'est pas un détail.** Les espèces sont dans le
 *    tiroir, le mobile money est sur un compte. Confondre les deux, c'est
 *    croire qu'on peut payer un fournisseur avec de l'argent qu'on n'a pas sous
 *    la main. Chaque flux est ventilé.
 *
 * 3. **Une journée sans saisie n'est pas une journée à zéro.** Comme partout
 *    ailleurs, `Measured<T>` porte la distinction jusqu'à l'écran.
 *
 * Logique pure : ni React, ni réseau, ni horloge implicite.
 */

import type { Expense, PaymentMethod, Sale, UUID } from './types';
import { PAYMENT_LABEL } from './types';
import type { Instant, Measured, Period, TimeOptions } from './analytics';
import { lastPeriods, measured, NO_DATA } from './analytics';

const METHODS: readonly PaymentMethod[] = ['CASH', 'MOBILE_MONEY', 'CARD', 'OTHER'];

export { PAYMENT_LABEL };

function round(n: number): number {
  return Math.round(n);
}

function within(iso: string | null | undefined, period: Period): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t >= period.start && t < period.end;
}

function emptyByMethod(): Record<PaymentMethod, MethodFlow> {
  return {
    CASH: { in: 0, out: 0, net: 0 },
    MOBILE_MONEY: { in: 0, out: 0, net: 0 },
    CARD: { in: 0, out: 0, net: 0 },
    OTHER: { in: 0, out: 0, net: 0 },
  };
}

/* ------------------------------------------------------------------ Types */

export interface MethodFlow {
  in: number;
  out: number;
  net: number;
}

export interface CashFlowInput {
  sales: Sale[];
  expenses: Expense[];
  /** Solde de départ, si on le connaît. Sinon la série part de zéro et ne
   *  raconte que la variation — ce qui reste honnête, et c'est dit à l'écran. */
  openingBalance?: number;
}

export interface CashFlowPoint {
  period: Period;
  /** `hasData: false` quand rien n'a été saisi ce jour-là. */
  flow: Measured<PeriodFlow>;
  /** Solde cumulé à la fin de la période. Reporté tel quel sur une journée vide. */
  balance: number;
}

export interface PeriodFlow {
  inflow: number;
  outflow: number;
  net: number;
  byMethod: Record<PaymentMethod, MethodFlow>;
  /** Nombre d'encaissements et de paiements — utile pour repérer une journée creuse. */
  inflowCount: number;
  outflowCount: number;
}

export interface CashFlowReport {
  points: CashFlowPoint[];
  openingBalance: number;
  closingBalance: number;
  totalIn: number;
  totalOut: number;
  net: number;
  byMethod: Record<PaymentMethod, MethodFlow>;
  /** Sortie moyenne par période vécue. `hasData: false` si rien n'est sorti. */
  averageBurn: Measured<number>;
  /**
   * Jours de trésorerie au rythme de sortie actuel. `hasData: false` quand
   * rien ne sort — un dénominateur nul ne donne pas « l'infini », il donne
   * « la question ne se pose pas ».
   */
  runway: Measured<number>;
  /** Périodes dont le net est négatif : on a consommé de la trésorerie. */
  negativeDays: number;
}

/* ------------------------------------------------------------- Agrégation */

/** Flux d'une période. `hasData: false` si aucun encaissement ni paiement. */
export function periodFlow(input: CashFlowInput, period: Period): Measured<PeriodFlow> {
  const sales = input.sales.filter((s) => s.status === 'COMPLETED' && within(s.createdAt, period));
  const expenses = input.expenses.filter((e) => within(e.createdAt, period));

  if (sales.length === 0 && expenses.length === 0) return NO_DATA;

  const byMethod = emptyByMethod();
  let inflow = 0;
  let outflow = 0;

  for (const s of sales) {
    byMethod[s.paymentMethod].in += s.total;
    inflow += s.total;
  }
  for (const e of expenses) {
    byMethod[e.paymentMethod].out += e.amount;
    outflow += e.amount;
  }
  for (const m of METHODS) {
    byMethod[m].in = round(byMethod[m].in);
    byMethod[m].out = round(byMethod[m].out);
    byMethod[m].net = byMethod[m].in - byMethod[m].out;
  }

  return measured({
    inflow: round(inflow),
    outflow: round(outflow),
    net: round(inflow) - round(outflow),
    byMethod,
    inflowCount: sales.length,
    outflowCount: expenses.length,
  });
}

/**
 * Série de trésorerie sur les `count` dernières périodes, solde cumulé compris.
 *
 * Le solde est reporté sur les périodes vides plutôt que remis à zéro : une
 * journée sans saisie ne fait pas disparaître l'argent du tiroir.
 */
export function cashFlowReport(
  input: CashFlowInput,
  at: Instant,
  count = 14,
  options: TimeOptions = {},
): CashFlowReport {
  const periods = lastPeriods(at, 'DAY', count, options);
  const opening = input.openingBalance ?? 0;

  const byMethod = emptyByMethod();
  const points: CashFlowPoint[] = [];
  let balance = opening;
  let totalIn = 0;
  let totalOut = 0;
  let burnTotal = 0;
  let burnDays = 0;
  let negativeDays = 0;

  for (const period of periods) {
    const flow = periodFlow(input, period);
    if (flow.hasData) {
      balance += flow.value.net;
      totalIn += flow.value.inflow;
      totalOut += flow.value.outflow;
      if (flow.value.net < 0) negativeDays++;
      if (flow.value.outflow > 0) {
        burnTotal += flow.value.outflow;
        burnDays++;
      }
      for (const m of METHODS) {
        byMethod[m].in += flow.value.byMethod[m].in;
        byMethod[m].out += flow.value.byMethod[m].out;
      }
    }
    points.push({ period, flow, balance });
  }

  for (const m of METHODS) byMethod[m].net = byMethod[m].in - byMethod[m].out;

  const averageBurn: Measured<number> = burnDays > 0 ? measured(round(burnTotal / burnDays)) : NO_DATA;
  const runway: Measured<number> =
    averageBurn.hasData && averageBurn.value > 0
      ? measured(Math.floor(Math.max(0, balance) / averageBurn.value))
      : NO_DATA;

  return {
    points,
    openingBalance: opening,
    closingBalance: round(balance),
    totalIn: round(totalIn),
    totalOut: round(totalOut),
    net: round(totalIn) - round(totalOut),
    byMethod,
    averageBurn,
    runway,
    negativeDays,
  };
}

/* ------------------------------------------------------------- Position */

export interface CashPosition {
  method: PaymentMethod;
  label: string;
  /** Ce qui reste disponible sur ce moyen de paiement. */
  balance: number;
  in: number;
  out: number;
}

/**
 * Où est l'argent, maintenant, moyen par moyen.
 *
 * C'est la lecture qui manque le plus au comptoir : « on a 340 000 FCFA » ne
 * dit pas si on peut payer le laitier en espèces ce matin.
 */
export function cashPositions(report: CashFlowReport): CashPosition[] {
  return METHODS.map((method) => ({
    method,
    label: PAYMENT_LABEL[method],
    balance: report.byMethod[method].net,
    in: report.byMethod[method].in,
    out: report.byMethod[method].out,
  })).filter((p) => p.in !== 0 || p.out !== 0);
}

/* --------------------------------------------------------- Sorties à venir */

export interface UpcomingOutflow {
  itemId: UUID;
  name: string;
  /** Quantité à racheter pour revenir au stock cible. */
  quantity: number;
  /** Au coût moyen pondéré courant. */
  estimatedCost: number;
}

/**
 * Ce que la liste de courses va coûter.
 *
 * La trésorerie ne se pilote pas sur le passé seul : un solde confortable qui
 * ne couvre pas le réapprovisionnement de demain n'est pas confortable. Le
 * montant est estimé au coût moyen pondéré — donc marqué comme déduit à l'écran.
 */
export function upcomingOutflow(
  needs: { itemId: UUID; name: string; quantity: number; unitCost: number | undefined }[],
): { lines: UpcomingOutflow[]; total: number; incomplete: boolean } {
  const lines: UpcomingOutflow[] = [];
  let total = 0;
  let incomplete = false;

  for (const n of needs) {
    if (n.quantity <= 0) continue;
    if (n.unitCost === undefined) {
      // Un article sans coût connu ne vaut pas zéro : il rend l'estimation partielle.
      incomplete = true;
      continue;
    }
    const estimatedCost = round(n.quantity * n.unitCost);
    lines.push({ itemId: n.itemId, name: n.name, quantity: n.quantity, estimatedCost });
    total += estimatedCost;
  }

  return { lines: lines.sort((a, b) => b.estimatedCost - a.estimatedCost), total, incomplete };
}
