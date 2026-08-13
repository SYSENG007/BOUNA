import type {
  Expense, ExpenseCategory, Item, PriceObservation, Purchase, Recipe, RecipeVersion,
  Sale, Site, StockLocation, StockMovement, Supplier, Unit, UUID, WasteEvent,
} from './types';
import { canConvert, convert } from './units';
import { weightedAverageCost } from './stock';

/**
 * Analytique — Sprint 7. Logique pure : ni React, ni réseau, ni horloge implicite.
 *
 * Trois partis pris structurent tout le module.
 *
 * 1. RULE-002 — rien ici ne lit un « niveau ». Les quantités reçues sont
 *    reprojetées depuis `StockMovement[]`, exactement comme le stock.
 *
 * 2. « Pas de données » n'est pas « zéro ». Une journée jamais saisie et une
 *    journée sans vente sont deux faits différents ; le type `Measured<T>`
 *    porte la distinction jusqu'à l'écran, qui ne peut donc pas afficher
 *    « 0 FCFA » pour une journée dont personne n'a rien dit.
 *
 * 3. Les coûts imputés sont toujours visibles. Une rentabilité horaire dépend
 *    entièrement de la façon dont on répartit les charges ; cacher la clé de
 *    répartition reviendrait à fabriquer la réponse. La base d'imputation est
 *    donc un paramètre, et elle est rendue avec le résultat.
 *
 * Les montants sont en FCFA entiers — la devise n'a pas de sous-unité.
 */

/* ==================================================================== Mesure */

/**
 * Une mesure qui sait qu'elle peut ne pas exister.
 *
 * L'union discriminée est volontaire : TypeScript force l'appelant à traiter
 * `hasData: false` avant de lire `value`. Un simple `number | null` se serait
 * fait absorber par un `?? 0` quelque part dans un composant.
 */
export type Measured<T> =
  | { readonly hasData: true; readonly value: T }
  | { readonly hasData: false; readonly value: null };

export const NO_DATA: Measured<never> = { hasData: false, value: null };

export function measured<T>(value: T): Measured<T> {
  return { hasData: true, value };
}

/* ===================================================================== Temps */

export type Granularity = 'DAY' | 'WEEK' | 'MONTH';
export type Instant = Date | string | number;

export interface TimeOptions {
  /**
   * Décalage du fuseau d'exploitation, en minutes. Dakar vit à UTC+0 toute
   * l'année : la valeur par défaut 0 est donc juste sur le terrain, et rend
   * les calculs déterministes quelle que soit la machine qui les exécute.
   */
  utcOffsetMinutes?: number;
  /** Premier jour de la semaine — lundi par défaut. */
  weekStartsOn?: 0 | 1;
}

export interface Period {
  granularity: Granularity;
  /** Borne incluse, en millisecondes epoch. */
  start: number;
  /** Borne exclue : un fait daté exactement à `end` appartient à la période suivante. */
  end: number;
  /**
   * Clé stable et triable — `J:2026-08-13`, `S:2026-08-10`, `M:2026-08-01`.
   * Volontairement bâtie sur la date de début plutôt que sur un numéro de
   * semaine ISO : les semaines à cheval sur deux années ne se numérotent pas
   * sans ambiguïté, une date de début si.
   */
  key: string;
  /** Libellé français prêt pour l'écran. */
  label: string;
  /** Fuseau utilisé pour découper la période — `previousPeriod` le rejoue. */
  offsetMinutes: number;
  /** Premier jour de semaine utilisé — conservé pour la même raison. */
  weekStartsOn: 0 | 1;
}

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY_MS = 86_400_000;

const MONTHS_FR = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];
const WEEKDAYS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

function toMs(at: Instant): number {
  if (at instanceof Date) return at.getTime();
  if (typeof at === 'number') return at;
  return Date.parse(at);
}

/** Date lue « en heure locale » : on décale, puis on lit les getters UTC. */
function local(ms: number, offsetMinutes: number): Date {
  return new Date(ms + offsetMinutes * MINUTE);
}

function fromLocalParts(y: number, m: number, d: number, offsetMinutes: number): number {
  return Date.UTC(y, m, d) - offsetMinutes * MINUTE;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function isoDate(ms: number, offsetMinutes: number): string {
  const d = local(ms, offsetMinutes);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function dayLabel(ms: number, offsetMinutes: number): string {
  const d = local(ms, offsetMinutes);
  return `${WEEKDAYS_FR[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS_FR[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function weekLabel(start: number, end: number, offsetMinutes: number): string {
  const a = local(start, offsetMinutes);
  const b = local(end - 1, offsetMinutes);
  const sameMonth = a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear();
  // Une semaine à cheval sur deux mois doit le dire : « 31 août – 6 septembre ».
  return sameMonth
    ? `${a.getUTCDate()} – ${b.getUTCDate()} ${MONTHS_FR[b.getUTCMonth()]} ${b.getUTCFullYear()}`
    : `${a.getUTCDate()} ${MONTHS_FR[a.getUTCMonth()]} – ${b.getUTCDate()} ${MONTHS_FR[b.getUTCMonth()]} ${b.getUTCFullYear()}`;
}

/** Découpe la période calendaire qui contient l'instant donné. */
export function periodOf(at: Instant, granularity: Granularity, options: TimeOptions = {}): Period {
  const offsetMinutes = options.utcOffsetMinutes ?? 0;
  const weekStartsOn = options.weekStartsOn ?? 1;
  const d = local(toMs(at), offsetMinutes);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();

  let start: number;
  let end: number;
  if (granularity === 'DAY') {
    start = fromLocalParts(y, m, day, offsetMinutes);
    end = start + DAY_MS;
  } else if (granularity === 'WEEK') {
    const midnight = fromLocalParts(y, m, day, offsetMinutes);
    const back = (d.getUTCDay() - weekStartsOn + 7) % 7;
    start = midnight - back * DAY_MS;
    end = start + 7 * DAY_MS;
  } else {
    start = fromLocalParts(y, m, 1, offsetMinutes);
    end = fromLocalParts(y, m + 1, 1, offsetMinutes);
  }

  const prefix = granularity === 'DAY' ? 'J' : granularity === 'WEEK' ? 'S' : 'M';
  const label =
    granularity === 'DAY'
      ? dayLabel(start, offsetMinutes)
      : granularity === 'WEEK'
        ? weekLabel(start, end, offsetMinutes)
        : `${MONTHS_FR[local(start, offsetMinutes).getUTCMonth()]} ${local(start, offsetMinutes).getUTCFullYear()}`;

  return {
    granularity, start, end, label, offsetMinutes, weekStartsOn,
    key: `${prefix}:${isoDate(start, offsetMinutes)}`,
  };
}

/**
 * Période calendaire précédente.
 *
 * On ne soustrait pas une durée : février ne dure pas autant que mars, et un
 * mois moins 30 jours retomberait à cheval sur deux mois. On recule d'un cran
 * dans le calendrier, puis on redécoupe.
 */
export function previousPeriod(period: Period): Period {
  const opts: TimeOptions = {
    utcOffsetMinutes: period.offsetMinutes,
    weekStartsOn: period.weekStartsOn,
  };
  if (period.granularity === 'MONTH') {
    const d = local(period.start, period.offsetMinutes);
    return periodOf(fromLocalParts(d.getUTCFullYear(), d.getUTCMonth() - 1, 1, period.offsetMinutes), 'MONTH', opts);
  }
  return periodOf(period.start - 1, period.granularity, opts);
}

/** Les `count` dernières périodes, de la plus ancienne à celle qui contient `at`. */
export function lastPeriods(
  at: Instant,
  granularity: Granularity,
  count: number,
  options: TimeOptions = {},
): Period[] {
  const out: Period[] = [];
  let current = periodOf(at, granularity, options);
  for (let i = 0; i < Math.max(0, count); i++) {
    out.unshift(current);
    current = previousPeriod(current);
  }
  return out;
}

function within(iso: string | null | undefined, period: Period): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t >= period.start && t < period.end;
}

/* ==================================================================== Entrée */

export interface AnalyticsInput {
  items: Item[];
  sales: Sale[];
  movements: StockMovement[];
  expenses?: Expense[];
  purchases?: Purchase[];
  waste?: WasteEvent[];
  recipes?: Recipe[];
  recipeVersions?: RecipeVersion[];
  locations?: StockLocation[];
  sites?: Site[];
  suppliers?: Supplier[];
}

/** Restriction d'un calcul à un site — utilisée pour rendre les sites comparables. */
export interface Scope {
  siteId?: UUID;
}

export interface ProfitabilityOptions {
  /** Comment imputer les charges qui ne se rattachent à aucune vente. */
  allocation?: CostAllocation;
  /**
   * Catégories de dépenses déjà comptées dans le COGS. Une réception de
   * marchandise crée à la fois une entrée de stock (qui deviendra du COGS à la
   * vente) et une dépense : les imputer une seconde fois compterait le même
   * argent deux fois et rendrait toutes les heures déficitaires.
   */
  stockExpenseCategories?: ExpenseCategory[];
  /**
   * Rattachement d'une dépense à un site. `Expense` ne porte pas de `siteId` :
   * sans cette fonction, les dépenses restent au niveau organisation et sont
   * réparties entre les sites selon la base d'imputation choisie.
   */
  expenseSiteOf?: (expense: Expense) => UUID | null;
}

/**
 * Base d'imputation des charges qui ne se rattachent à aucune vente.
 *
 * `PART_EGALE` — une part identique par heure ouverte, ou par site. Répond à
 * « faut-il rester ouvert à cette heure-là ? » : une heure d'ouverture coûte un
 * salaire et de l'électricité, qu'elle vende ou non.
 * `PRORATA_CA` — au poids du chiffre d'affaires. Répond à « ce site paie-t-il
 * sa part des frais communs ? ».
 *
 * Les deux sont légitimes et ils ne donnent pas le même verdict : une heure
 * creuse paraît gratuite au prorata et coûteuse à part égale. Le choix est donc
 * explicite, jamais deviné, et il est rendu avec le résultat.
 */
export type CostAllocation = 'PART_EGALE' | 'PRORATA_CA' | 'AUCUNE';

const DEFAULT_STOCK_CATEGORIES: ExpenseCategory[] = ['MATIERE', 'EMBALLAGE'];

/* ------------------------------------------------------------- Utilitaires */

function round(n: number): number {
  return Math.round(n);
}

/** Pourcentage à une décimale. `null` quand le dénominateur ne dit rien. */
function pct(part: number, whole: number): number | null {
  if (whole === 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}

/**
 * Variation entre deux périodes. `null` si la précédente vaut zéro : « +∞ % »
 * n'est pas une information, et « +300 % » à partir d'une perte non plus.
 */
export function variationPct(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

/**
 * Répartit un montant entier selon des poids, sans perdre de francs.
 * Méthode du plus fort reste : la somme des parts vaut exactement le total,
 * sinon la ligne « total » d'un écran contredirait la somme de ses lignes.
 */
function distribute(total: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const target = Math.round(total);
  const sum = weights.reduce((s, w) => s + Math.max(0, w), 0);
  const exact = sum > 0
    ? weights.map((w) => (target * Math.max(0, w)) / sum)
    : weights.map(() => target / n);
  const out = exact.map((v) => Math.floor(v));
  let rest = target - out.reduce((s, v) => s + v, 0);
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < order.length && rest > 0; k++) {
    out[order[k].i] += 1;
    rest -= 1;
  }
  return out;
}

function siteOfLocation(locationId: UUID, locations: StockLocation[] | undefined): UUID | null {
  return locations?.find((l) => l.id === locationId)?.siteId ?? null;
}

/** Ventes retenues dans le chiffre d'affaires : une vente annulée n'a rien vendu. */
function completedSales(input: AnalyticsInput, period: Period, scope: Scope = {}): Sale[] {
  return input.sales.filter(
    (s) => s.status === 'COMPLETED' && within(s.createdAt, period) && (!scope.siteId || s.siteId === scope.siteId),
  );
}

/**
 * La période a-t-elle été vécue ?
 *
 * Un fait daté suffit : une vente (même annulée), une dépense, un achat, une
 * perte, ou un mouvement de stock autre que l'amorçage. Une journée ouverte
 * sans aucune vente laisse forcément une trace ; une journée jamais saisie n'en
 * laisse aucune. C'est exactement la frontière entre « 0 FCFA » et « — ».
 */
export function hasFacts(input: AnalyticsInput, period: Period, scope: Scope = {}): boolean {
  const site = scope.siteId;
  const locations = input.locations;

  if (input.sales.some((s) => within(s.createdAt, period) && (!site || s.siteId === site))) return true;
  if (input.movements.some(
    (m) => m.movementType !== 'INITIAL' && within(m.createdAt, period) && (!site || m.siteId === site),
  )) return true;
  if ((input.waste ?? []).some(
    (w) => within(w.createdAt, period) && (!site || siteOfLocation(w.locationId, locations) === site),
  )) return true;
  if ((input.purchases ?? []).some(
    (p) => (within(p.createdAt, period) || within(p.receivedAt, period))
      && (!site || siteOfLocation(p.locationId, locations) === site),
  )) return true;
  // Une dépense sans site rattaché ne prouve l'activité que d'une organisation.
  if (!site && (input.expenses ?? []).some((e) => within(e.createdAt, period))) return true;
  return false;
}

/* ======================================================= 1. Agrégats période */

export interface PeriodTotals {
  revenue: number;
  orders: number;
  /** `null` quand aucune commande n'a été encaissée : la moyenne n'existe pas. */
  averageBasket: number | null;
  cogs: number;
  grossMargin: number;
  /** Marge brute rapportée au chiffre d'affaires, en %. `null` sans chiffre d'affaires. */
  marginPct: number | null;
  unitsSold: number;
  /** Charges d'exploitation de la période, hors marchandise déjà comptée en COGS. */
  operatingExpenses: number;
  wasteCost: number;
  /** Marge brute − charges d'exploitation − pertes. */
  netMargin: number;
}

export interface PeriodChange {
  revenuePct: number | null;
  ordersPct: number | null;
  averageBasketPct: number | null;
  grossMarginPct: number | null;
  unitsSoldPct: number | null;
  netMarginPct: number | null;
}

export interface PeriodReport {
  period: Period;
  previous: Period;
  current: Measured<PeriodTotals>;
  /** `hasData: false` quand la période précédente n'a jamais été renseignée. */
  comparison: Measured<PeriodTotals>;
  /** Variations ; `hasData: false` dès qu'un des deux termes manque. */
  change: Measured<PeriodChange>;
}

function operatingExpensesOf(
  input: AnalyticsInput,
  period: Period,
  options: ProfitabilityOptions,
  scope: Scope = {},
): { total: number; lines: Expense[] } {
  const excluded = options.stockExpenseCategories ?? DEFAULT_STOCK_CATEGORIES;
  const lines = (input.expenses ?? []).filter((e) => {
    if (!within(e.createdAt, period)) return false;
    if (excluded.includes(e.category)) return false;
    if (!scope.siteId) return true;
    return options.expenseSiteOf?.(e) === scope.siteId;
  });
  return { total: round(lines.reduce((s, e) => s + e.amount, 0)), lines };
}

function wasteCostOf(input: AnalyticsInput, period: Period, scope: Scope = {}): number {
  return round(
    (input.waste ?? [])
      .filter(
        (w) => within(w.createdAt, period)
          && (!scope.siteId || siteOfLocation(w.locationId, input.locations) === scope.siteId),
      )
      .reduce((s, w) => s + w.cost, 0),
  );
}

/** Agrégats d'une période. `hasData: false` si la période n'a jamais été vécue. */
export function periodTotals(
  input: AnalyticsInput,
  period: Period,
  options: ProfitabilityOptions = {},
  scope: Scope = {},
): Measured<PeriodTotals> {
  if (!hasFacts(input, period, scope)) return NO_DATA;

  const sales = completedSales(input, period, scope);
  const revenue = round(sales.reduce((s, x) => s + x.total, 0));
  const cogs = round(sales.reduce((s, x) => s + x.cogs, 0));
  const grossMargin = revenue - cogs;
  const unitsSold = sales.reduce((s, x) => s + x.lines.reduce((q, l) => q + l.quantity, 0), 0);
  const operatingExpenses = operatingExpensesOf(input, period, options, scope).total;
  const wasteCost = wasteCostOf(input, period, scope);

  return measured({
    revenue,
    orders: sales.length,
    averageBasket: sales.length ? round(revenue / sales.length) : null,
    cogs,
    grossMargin,
    marginPct: pct(grossMargin, revenue),
    unitsSold,
    operatingExpenses,
    wasteCost,
    netMargin: grossMargin - operatingExpenses - wasteCost,
  });
}

/** Agrégats de la période contenant `at`, comparés à la période calendaire précédente. */
export function periodReport(
  input: AnalyticsInput,
  at: Instant,
  granularity: Granularity,
  options: ProfitabilityOptions & TimeOptions = {},
  scope: Scope = {},
): PeriodReport {
  const period = periodOf(at, granularity, options);
  const previous = previousPeriod(period);
  const current = periodTotals(input, period, options, scope);
  const comparison = periodTotals(input, previous, options, scope);

  // Comparer à une période inexistante fabriquerait une progression de +100 %
  // là où il n'y a qu'un trou de saisie.
  const change: Measured<PeriodChange> =
    current.hasData && comparison.hasData
      ? measured({
          revenuePct: variationPct(current.value.revenue, comparison.value.revenue),
          ordersPct: variationPct(current.value.orders, comparison.value.orders),
          averageBasketPct:
            current.value.averageBasket !== null && comparison.value.averageBasket !== null
              ? variationPct(current.value.averageBasket, comparison.value.averageBasket)
              : null,
          grossMarginPct: variationPct(current.value.grossMargin, comparison.value.grossMargin),
          unitsSoldPct: variationPct(current.value.unitsSold, comparison.value.unitsSold),
          netMarginPct: variationPct(current.value.netMargin, comparison.value.netMargin),
        })
      : NO_DATA;

  return { period, previous, current, comparison, change };
}

/** Série continue de périodes — les trous restent des trous. */
export function periodSeries(
  input: AnalyticsInput,
  at: Instant,
  granularity: Granularity,
  count: number,
  options: ProfitabilityOptions & TimeOptions = {},
  scope: Scope = {},
): { period: Period; totals: Measured<PeriodTotals> }[] {
  return lastPeriods(at, granularity, count, options).map((period) => ({
    period,
    totals: periodTotals(input, period, options, scope),
  }));
}

/* ==================================================== 2. Rentabilité horaire */

export interface HourProfitability {
  /** Heure locale, 0–23. */
  hour: number;
  label: string;
  revenue: number;
  orders: number;
  unitsSold: number;
  cogs: number;
  grossMargin: number;
  wasteCost: number;
  /** Part des charges d'exploitation imputée à cette heure. */
  allocatedCost: number;
  /** Marge brute − pertes − charges imputées. C'est le chiffre qui décide. */
  netMargin: number;
  /** Vrai quand l'heure rapporte au moins ce qu'elle coûte. */
  coversItsCost: boolean;
  /** Part du chiffre d'affaires de la période, en %. */
  revenueSharePct: number | null;
}

export interface HourlyReport {
  period: Period;
  /** Base d'imputation réellement appliquée — rendue pour que l'écran l'affiche. */
  allocation: CostAllocation;
  /** Charges d'exploitation réparties sur les heures ouvertes. */
  allocatedTotal: number;
  /**
   * Dépenses écartées de l'imputation parce que déjà comptées en COGS.
   * Rendues explicitement : c'est la première chose qu'un owner conteste.
   */
  excludedFromAllocation: number;
  /** Nombre d'heures ayant connu une activité. */
  openHours: number;
  /** Uniquement les heures vécues — une heure fermée est absente, pas à zéro. */
  hours: HourProfitability[];
  /** Heures dont la marge nette est négative, de la pire à la moins mauvaise. */
  lossMakingHours: HourProfitability[];
}

function hourOf(iso: string, offsetMinutes: number): number {
  return local(Date.parse(iso), offsetMinutes).getUTCHours();
}

/**
 * Rentabilité heure par heure.
 *
 * Les charges ne sont jamais rattachées à l'heure de leur paiement : une
 * recharge d'électricité réglée à 17 h ne rend pas 17 h déficitaire. Elles sont
 * réparties sur les heures effectivement ouvertes, ce qui est la seule lecture
 * qui réponde à « faut-il ouvrir de 6 h à 8 h ? ».
 */
export function hourlyProfitability(
  input: AnalyticsInput,
  period: Period,
  options: ProfitabilityOptions = {},
  scope: Scope = {},
): Measured<HourlyReport> {
  if (!hasFacts(input, period, scope)) return NO_DATA;

  const off = period.offsetMinutes;
  const allocation = options.allocation ?? 'PART_EGALE';
  const sales = completedSales(input, period, scope);
  const waste = (input.waste ?? []).filter(
    (w) => within(w.createdAt, period)
      && (!scope.siteId || siteOfLocation(w.locationId, input.locations) === scope.siteId),
  );
  const activity = input.movements.filter(
    (m) => m.movementType !== 'INITIAL' && within(m.createdAt, period)
      && (!scope.siteId || m.siteId === scope.siteId),
  );

  interface Bucket {
    revenue: number; orders: number; units: number; cogs: number; waste: number;
  }
  const buckets = new Map<number, Bucket>();
  const touch = (h: number): Bucket => {
    const existing = buckets.get(h);
    if (existing) return existing;
    const fresh: Bucket = { revenue: 0, orders: 0, units: 0, cogs: 0, waste: 0 };
    buckets.set(h, fresh);
    return fresh;
  };

  for (const m of activity) touch(hourOf(m.createdAt, off));
  for (const s of sales) {
    const b = touch(hourOf(s.createdAt, off));
    b.revenue += s.total;
    b.cogs += s.cogs;
    b.orders += 1;
    b.units += s.lines.reduce((q, l) => q + l.quantity, 0);
  }
  for (const w of waste) touch(hourOf(w.createdAt, off)).waste += w.cost;

  const hoursSorted = [...buckets.keys()].sort((a, b) => a - b);
  const expenses = operatingExpensesOf(input, period, options, scope);
  const excludedFromAllocation = round(
    (input.expenses ?? [])
      .filter((e) => within(e.createdAt, period))
      .reduce((s, e) => s + e.amount, 0) - expenses.total,
  );

  // Prorata du CA quand il n'y a aucun CA : on retombe sur le partage égal,
  // sinon la charge disparaîtrait purement et simplement du rapport.
  const totalRevenue = round(sales.reduce((s, x) => s + x.total, 0));
  const weights =
    allocation === 'PRORATA_CA' && totalRevenue > 0
      ? hoursSorted.map((h) => buckets.get(h)!.revenue)
      : hoursSorted.map(() => 1);
  const shares = allocation === 'AUCUNE'
    ? hoursSorted.map(() => 0)
    : distribute(expenses.total, weights);

  const hours: HourProfitability[] = hoursSorted.map((h, i) => {
    const b = buckets.get(h)!;
    const revenue = round(b.revenue);
    const cogs = round(b.cogs);
    const grossMargin = revenue - cogs;
    const wasteCost = round(b.waste);
    const allocatedCost = shares[i];
    const netMargin = grossMargin - wasteCost - allocatedCost;
    return {
      hour: h,
      label: `${h} h – ${(h + 1) % 24} h`,
      revenue,
      orders: b.orders,
      unitsSold: b.units,
      cogs,
      grossMargin,
      wasteCost,
      allocatedCost,
      netMargin,
      coversItsCost: netMargin >= 0,
      revenueSharePct: pct(revenue, totalRevenue),
    };
  });

  return measured({
    period,
    allocation,
    allocatedTotal: allocation === 'AUCUNE' ? 0 : expenses.total,
    excludedFromAllocation,
    openHours: hours.length,
    hours,
    lossMakingHours: hours.filter((h) => !h.coversItsCost).sort((a, b) => a.netMargin - b.netMargin),
  });
}

/* ======================================================= 3. Rentabilité site */

export interface SiteProfitability {
  siteId: UUID;
  name: string | null;
  revenue: number;
  orders: number;
  unitsSold: number;
  cogs: number;
  grossMargin: number;
  wasteCost: number;
  /** Dépenses explicitement rattachées au site. */
  directExpenses: number;
  /** Part des charges d'organisation imputée au site. */
  allocatedOverhead: number;
  netMargin: number;
  marginPct: number | null;
  averageBasket: number | null;
  /** Marge nette pour 1 000 FCFA vendus — le chiffre qui rend deux sites comparables. */
  netMarginPerThousand: number | null;
}

export interface SiteReport {
  period: Period;
  allocation: CostAllocation;
  /** Charges d'organisation réparties faute de rattachement à un site. */
  unattributedExpenses: number;
  sites: SiteProfitability[];
  /** Sites connus dont la période est vide — absents du classement, pas à zéro. */
  sitesWithoutData: UUID[];
}

/**
 * Rentabilité par site.
 *
 * `Expense` ne porte pas de `siteId` : les dépenses non rattachées sont donc
 * des charges d'organisation, réparties au prorata du chiffre d'affaires par
 * défaut — un petit kiosque ne doit pas porter la même part de frais communs
 * qu'un site trois fois plus gros.
 */
export function siteProfitability(
  input: AnalyticsInput,
  period: Period,
  options: ProfitabilityOptions = {},
): Measured<SiteReport> {
  const allocation = options.allocation ?? 'PRORATA_CA';
  const knownSites = input.sites?.map((s) => s.id) ?? [];
  const seen = new Set<UUID>(knownSites);
  for (const s of input.sales) if (within(s.createdAt, period)) seen.add(s.siteId);
  for (const m of input.movements) if (within(m.createdAt, period)) seen.add(m.siteId);

  const active = [...seen].filter((siteId) => hasFacts(input, period, { siteId }));
  if (active.length === 0) return NO_DATA;

  const excluded = options.stockExpenseCategories ?? DEFAULT_STOCK_CATEGORIES;
  const periodExpenses = (input.expenses ?? []).filter(
    (e) => within(e.createdAt, period) && !excluded.includes(e.category),
  );
  const unattributed = round(
    periodExpenses
      .filter((e) => {
        const siteId = options.expenseSiteOf?.(e) ?? null;
        return siteId === null || !active.includes(siteId);
      })
      .reduce((s, e) => s + e.amount, 0),
  );

  const rows = active.map((siteId) => {
    const scope: Scope = { siteId };
    const sales = completedSales(input, period, scope);
    const revenue = round(sales.reduce((s, x) => s + x.total, 0));
    const cogs = round(sales.reduce((s, x) => s + x.cogs, 0));
    const directExpenses = operatingExpensesOf(input, period, options, scope).total;
    return {
      siteId,
      name: input.sites?.find((s) => s.id === siteId)?.name ?? null,
      revenue,
      orders: sales.length,
      unitsSold: sales.reduce((s, x) => s + x.lines.reduce((q, l) => q + l.quantity, 0), 0),
      cogs,
      grossMargin: revenue - cogs,
      wasteCost: wasteCostOf(input, period, scope),
      directExpenses,
    };
  });

  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const weights =
    allocation === 'PRORATA_CA' && totalRevenue > 0 ? rows.map((r) => r.revenue) : rows.map(() => 1);
  const shares = allocation === 'AUCUNE' ? rows.map(() => 0) : distribute(unattributed, weights);

  const sites: SiteProfitability[] = rows.map((r, i) => {
    const allocatedOverhead = shares[i];
    const netMargin = r.grossMargin - r.wasteCost - r.directExpenses - allocatedOverhead;
    return {
      ...r,
      allocatedOverhead,
      netMargin,
      marginPct: pct(r.grossMargin, r.revenue),
      averageBasket: r.orders ? round(r.revenue / r.orders) : null,
      netMarginPerThousand: r.revenue > 0 ? Math.round((netMargin / r.revenue) * 1000) : null,
    };
  });

  sites.sort((a, b) => b.netMargin - a.netMargin);

  return measured({
    period,
    allocation,
    unattributedExpenses: unattributed,
    sites,
    sitesWithoutData: knownSites.filter((id) => !active.includes(id)),
  });
}

/* ================================================ 4. Analytique fournisseurs */

export interface SupplierItemStats {
  supplierId: UUID;
  itemId: UUID;
  /** Unité de comparaison — celle de l'article quand la conversion est possible. */
  unit: Unit;
  /** Nombre de lignes d'achat observées. */
  observations: number;
  /** Prix moyen pondéré par les quantités, dans l'unité de l'article. */
  averageUnitPrice: number | null;
  firstUnitPrice: number | null;
  lastUnitPrice: number | null;
  /** Évolution du dernier prix par rapport au premier, en %. */
  priceTrendPct: number | null;
  /** Tout ce qui a été commandé sur la fenêtre, livré ou non. */
  quantityOrdered: number;
  /**
   * Part de ce commandé qui appartient à des commandes réceptionnées.
   * C'est le dénominateur du taux de service : une commande encore en route
   * n'est pas une commande mal livrée.
   */
  quantityExpected: number;
  /** Quantité reçue reprojetée depuis les mouvements — jamais lue d'un champ (RULE-002). */
  quantityReceived: Measured<number>;
  /** Reçu ÷ attendu, en %. `hasData: false` tant que rien n'est réceptionné. */
  fillRatePct: Measured<number>;
  totalSpent: number;
  /**
   * Faux quand l'unité d'achat ne se convertit pas vers l'unité de l'article
   * (acheter des « bouteilles » d'un article stocké en litres sans taille de
   * conditionnement au catalogue). Les prix ne sont alors pas comparables.
   */
  comparable: boolean;
}

export interface SupplierStats {
  supplierId: UUID;
  name: string | null;
  purchases: number;
  totalSpent: number;
  /** Délai moyen commande → réception, en heures. `null` si rien n'a été reçu. */
  averageLeadTimeHours: number | null;
  fastestLeadTimeHours: number | null;
  slowestLeadTimeHours: number | null;
  /** Commandes encore sans réception à la fin de la fenêtre. */
  pendingDeliveries: number;
  /** Fiabilité globale : reçu ÷ commandé sur toutes les lignes comparables. */
  fillRatePct: Measured<number>;
  items: SupplierItemStats[];
}

export interface SupplierPriceRow {
  supplierId: UUID;
  name: string | null;
  averageUnitPrice: number;
  /** Écart au meilleur prix observé, en FCFA par unité d'article. */
  gapAbsolute: number;
  gapPct: number | null;
}

export interface ItemPriceComparison {
  itemId: UUID;
  name: string | null;
  unit: Unit;
  bestSupplierId: UUID;
  bestUnitPrice: number;
  rows: SupplierPriceRow[];
  /** Ce qu'aurait économisé la période en achetant tout au meilleur prix observé. */
  potentialSaving: number;
}

export interface SupplierReport {
  /** Bornes appliquées, ou `null` quand tout l'historique est pris. */
  period: Period | null;
  suppliers: SupplierStats[];
  /** Points de prix datés, triés — de quoi tracer une courbe par article. */
  observations: PriceObservation[];
  comparison: ItemPriceComparison[];
}

/** Quantité réellement reçue pour un achat, reprojetée depuis les mouvements. */
function receivedFor(input: AnalyticsInput, purchaseId: UUID): Map<UUID, number> | null {
  const receipts = input.movements.filter(
    (m) => m.movementType === 'PURCHASE_RECEIPT' && m.referenceId === purchaseId,
  );
  // Aucun mouvement : la réception n'a pas été saisie. Ce n'est pas « zéro reçu ».
  if (receipts.length === 0) return null;
  const byItem = new Map<UUID, number>();
  for (const m of receipts) {
    const item = input.items.find((i) => i.id === m.itemId);
    const qty = item && canConvert(m.unit, item.unit) ? convert(m.quantity, m.unit, item.unit) : m.quantity;
    byItem.set(m.itemId, (byItem.get(m.itemId) ?? 0) + qty);
  }
  return byItem;
}

/**
 * Analytique fournisseurs : prix dans le temps, délai, fiabilité, écart au
 * meilleur prix observé. Sans achat sur la fenêtre, il n'y a rien à dire —
 * et surtout pas « 0 FCFA ».
 */
export function supplierAnalytics(
  input: AnalyticsInput,
  period?: Period,
): Measured<SupplierReport> {
  const purchases = (input.purchases ?? []).filter((p) => !period || within(p.createdAt, period));
  if (purchases.length === 0) return NO_DATA;

  const itemsById = new Map(input.items.map((i) => [i.id, i]));
  const observations: PriceObservation[] = [];

  interface Acc {
    quantity: number; spent: number; observations: number; comparable: boolean;
    unit: Unit; first: { at: number; price: number } | null; last: { at: number; price: number } | null;
    received: number; receivedKnown: boolean; orderedKnown: number;
  }
  const perSupplier = new Map<UUID, Map<UUID, Acc>>();
  const leadTimes = new Map<UUID, number[]>();
  const pending = new Map<UUID, number>();
  const spentBySupplier = new Map<UUID, number>();
  const countBySupplier = new Map<UUID, number>();

  for (const purchase of purchases) {
    countBySupplier.set(purchase.supplierId, (countBySupplier.get(purchase.supplierId) ?? 0) + 1);
    spentBySupplier.set(
      purchase.supplierId,
      (spentBySupplier.get(purchase.supplierId) ?? 0) + purchase.total,
    );

    if (purchase.receivedAt) {
      const delay = (Date.parse(purchase.receivedAt) - Date.parse(purchase.createdAt)) / HOUR;
      if (Number.isFinite(delay)) {
        const list = leadTimes.get(purchase.supplierId) ?? [];
        list.push(Math.max(0, Math.round(delay * 10) / 10));
        leadTimes.set(purchase.supplierId, list);
      }
    } else {
      pending.set(purchase.supplierId, (pending.get(purchase.supplierId) ?? 0) + 1);
    }

    const received = receivedFor(input, purchase.id);
    const byItem = perSupplier.get(purchase.supplierId) ?? new Map<UUID, Acc>();
    perSupplier.set(purchase.supplierId, byItem);

    for (const line of purchase.lines) {
      const item = itemsById.get(line.itemId);
      const comparable = !!item && canConvert(line.unit, item.unit);
      const unit = comparable && item ? item.unit : line.unit;
      // Prix ramené à l'unité de l'article : 1 100 FCFA/bouteille n'est pas
      // comparable à 1 050 FCFA/L tant que le catalogue ignore le contenu.
      const perItemUnit = comparable && item
        ? line.actualUnitPrice / convert(1, line.unit, item.unit)
        : line.actualUnitPrice;
      const quantity = comparable && item ? convert(line.quantity, line.unit, item.unit) : line.quantity;
      const at = Date.parse(purchase.createdAt);

      const acc = byItem.get(line.itemId) ?? {
        quantity: 0, spent: 0, observations: 0, comparable: true, unit,
        first: null, last: null, received: 0, receivedKnown: false, orderedKnown: 0,
      };
      acc.unit = unit;
      acc.comparable = acc.comparable && comparable;
      acc.quantity += quantity;
      acc.spent += quantity * perItemUnit;
      acc.observations += 1;
      if (!acc.first || at < acc.first.at) acc.first = { at, price: perItemUnit };
      if (!acc.last || at >= acc.last.at) acc.last = { at, price: perItemUnit };
      if (received) {
        acc.receivedKnown = true;
        acc.received += received.get(line.itemId) ?? 0;
        acc.orderedKnown += quantity;
      }
      byItem.set(line.itemId, acc);

      observations.push({
        itemId: line.itemId,
        supplierId: purchase.supplierId,
        unitPrice: Math.round(perItemUnit),
        observedAt: purchase.createdAt,
      });
    }
  }

  observations.sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));

  const suppliers: SupplierStats[] = [...perSupplier.entries()].map(([supplierId, byItem]) => {
    const delays = leadTimes.get(supplierId) ?? [];
    const items: SupplierItemStats[] = [...byItem.entries()].map(([itemId, acc]) => ({
      supplierId,
      itemId,
      unit: acc.unit,
      observations: acc.observations,
      averageUnitPrice: acc.quantity > 0 ? Math.round(acc.spent / acc.quantity) : null,
      firstUnitPrice: acc.first ? Math.round(acc.first.price) : null,
      lastUnitPrice: acc.last ? Math.round(acc.last.price) : null,
      priceTrendPct:
        acc.first && acc.last ? variationPct(acc.last.price, acc.first.price) : null,
      quantityOrdered: Math.round(acc.quantity * 100) / 100,
      quantityExpected: acc.orderedKnown,
      quantityReceived: acc.receivedKnown ? measured(Math.round(acc.received * 100) / 100) : NO_DATA,
      fillRatePct:
        acc.receivedKnown && acc.orderedKnown > 0
          ? measured(pct(acc.received, acc.orderedKnown) ?? 0)
          : NO_DATA,
      totalSpent: round(acc.spent),
      comparable: acc.comparable,
    }));

    const ordered = items.reduce(
      (s, i) => s + (i.fillRatePct.hasData && i.quantityOrdered !== null ? i.quantityOrdered : 0),
      0,
    );
    const got = items.reduce(
      (s, i) => s + (i.fillRatePct.hasData && i.quantityReceived.hasData ? i.quantityReceived.value : 0),
      0,
    );

    return {
      supplierId,
      name: input.suppliers?.find((s) => s.id === supplierId)?.name ?? null,
      purchases: countBySupplier.get(supplierId) ?? 0,
      totalSpent: round(spentBySupplier.get(supplierId) ?? 0),
      averageLeadTimeHours: delays.length
        ? Math.round((delays.reduce((s, d) => s + d, 0) / delays.length) * 10) / 10
        : null,
      fastestLeadTimeHours: delays.length ? Math.min(...delays) : null,
      slowestLeadTimeHours: delays.length ? Math.max(...delays) : null,
      pendingDeliveries: pending.get(supplierId) ?? 0,
      fillRatePct: ordered > 0 ? measured(pct(got, ordered) ?? 0) : NO_DATA,
      items: items.sort((a, b) => b.totalSpent - a.totalSpent),
    };
  });

  /* Écart au meilleur fournisseur — uniquement entre prix réellement comparables. */
  const comparison: ItemPriceComparison[] = [];
  const itemIds = new Set<UUID>();
  for (const s of suppliers) for (const i of s.items) if (i.comparable) itemIds.add(i.itemId);

  for (const itemId of itemIds) {
    const rows = suppliers
      .flatMap((s) => s.items.filter((i) => i.itemId === itemId && i.comparable && i.averageUnitPrice !== null)
        .map((i) => ({ supplier: s, stats: i })))
      .sort((a, b) => a.stats.averageUnitPrice! - b.stats.averageUnitPrice!);
    if (rows.length === 0) continue;

    const best = rows[0];
    const bestPrice = best.stats.averageUnitPrice!;
    comparison.push({
      itemId,
      name: itemsById.get(itemId)?.name ?? null,
      unit: best.stats.unit,
      bestSupplierId: best.supplier.supplierId,
      bestUnitPrice: bestPrice,
      rows: rows.map(({ supplier, stats }) => ({
        supplierId: supplier.supplierId,
        name: supplier.name,
        averageUnitPrice: stats.averageUnitPrice!,
        gapAbsolute: stats.averageUnitPrice! - bestPrice,
        gapPct: pct(stats.averageUnitPrice! - bestPrice, bestPrice),
      })),
      potentialSaving: round(
        rows.reduce(
          (s, { stats }) => s + (stats.averageUnitPrice! - bestPrice) * (stats.quantityOrdered ?? 0),
          0,
        ),
      ),
    });
  }

  comparison.sort((a, b) => b.potentialSaving - a.potentialSaving);

  return measured({
    period: period ?? null,
    suppliers: suppliers.sort((a, b) => b.totalSpent - a.totalSpent),
    observations,
    comparison,
  });
}

/* ==================================================== 5. Marge par produit */

export interface ProductMargin {
  itemId: UUID;
  name: string;
  unitsSold: number;
  revenue: number;
  cogs: number;
  grossMargin: number;
  marginPct: number | null;
  averageUnitPrice: number;
  /** Coût moyen pondéré réellement constaté sur les ventes de la période. */
  averageUnitCost: number;
  /** Coût moyen pondéré courant du catalogue — le coût de demain, pas celui d'hier. */
  currentUnitCost: number | null;
  /** Coût théorique de la recette, valorisé au CMP des ingrédients. */
  recipeUnitCost: number | null;
  /** Dérive du coût constaté par rapport à la recette, en % (surdosage, casse). */
  costDriftPct: number | null;
  /** Vendu sous son coût : la marge du produit est négative. */
  soldAtLoss: boolean;
}

/**
 * Coût théorique d'une unité produite, au coût moyen pondéré des ingrédients.
 * `null` dès qu'un ingrédient est inconnu ou son unité inconvertible : un coût
 * partiel serait pris pour un coût complet, et flatterait la marge.
 */
export function recipeUnitCost(version: RecipeVersion, items: Map<UUID, Item>): number | null {
  let total = 0;
  for (const ing of version.ingredients) {
    const item = items.get(ing.itemId);
    if (!item || item.weightedAvgCost === undefined) return null;
    if (!canConvert(ing.unit, item.unit)) return null;
    total += convert(ing.quantity, ing.unit, item.unit) * item.weightedAvgCost;
  }
  return Math.round(total);
}

/**
 * Marge par produit, en coût moyen pondéré.
 *
 * Le COGS est celui figé sur chaque ligne de vente (`SaleLine.unitCost`) : le
 * coût du jour de la vente, pas celui d'aujourd'hui. Les lignes sont repliées
 * avec `weightedAverageCost()` — la même fonction qu'à la réception, pour que
 * le coût moyen d'une période obéisse à la règle de §40 et pas à une autre.
 */
export function productMargins(
  input: AnalyticsInput,
  period: Period,
  scope: Scope = {},
): Measured<ProductMargin[]> {
  if (!hasFacts(input, period, scope)) return NO_DATA;

  const sales = completedSales(input, period, scope);
  const itemsById = new Map(input.items.map((i) => [i.id, i]));

  interface Acc { name: string; qty: number; revenue: number; cost: number }
  const byItem = new Map<UUID, Acc>();

  for (const sale of sales) {
    for (const line of sale.lines) {
      const acc = byItem.get(line.itemId) ?? { name: line.name, qty: 0, revenue: 0, cost: 0 };
      // §40 — repli du coût moyen pondéré, ligne après ligne.
      acc.cost = weightedAverageCost(acc.qty, acc.cost, line.quantity, line.unitCost);
      acc.qty += line.quantity;
      acc.revenue += line.quantity * line.unitPrice;
      byItem.set(line.itemId, acc);
    }
  }

  const rows: ProductMargin[] = [...byItem.entries()].map(([itemId, acc]) => {
    const item = itemsById.get(itemId);
    const revenue = round(acc.revenue);
    const cogs = round(acc.qty * acc.cost);
    const grossMargin = revenue - cogs;

    const recipe = input.recipes?.find((r) => r.itemId === itemId);
    const version = recipe
      ? input.recipeVersions?.find((v) => v.id === recipe.currentVersionId)
      : undefined;
    const theoretical = version ? recipeUnitCost(version, itemsById) : null;
    const realized = round(acc.cost);

    return {
      itemId,
      name: item?.name ?? acc.name,
      unitsSold: Math.round(acc.qty * 100) / 100,
      revenue,
      cogs,
      grossMargin,
      marginPct: pct(grossMargin, revenue),
      averageUnitPrice: acc.qty > 0 ? round(acc.revenue / acc.qty) : 0,
      averageUnitCost: realized,
      currentUnitCost: item?.weightedAvgCost ?? null,
      recipeUnitCost: theoretical,
      costDriftPct: theoretical && theoretical > 0 ? variationPct(realized, theoretical) : null,
      soldAtLoss: grossMargin < 0,
    };
  });

  return measured(rows.sort((a, b) => b.grossMargin - a.grossMargin));
}
