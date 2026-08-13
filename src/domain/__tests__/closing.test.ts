import { describe, expect, it } from 'vitest';
import type { CashSession, Expense, Item, Sale, StockMovement } from '../types';
import {
  admitEvent, businessDateOf, cashCountView, closingContext, closingProgress, completeStep,
  DEFAULT_CLOSING_POLICY, dayClosureOf, finalValidationView, formatBusinessDate, isDayLocked,
  reopenDay, revertStep, salesReconciliationView, startClosing, stockVarianceView,
  type ClosingContext, type ClosingContextInput, type ClosingSession, type DayClosure,
} from '../closing';

/**
 * §37 — les cinq étapes de la clôture, et RULE-009.
 *
 * Les horodatages sont volontairement sans `Z` : JavaScript les lit en heure
 * locale, donc la journée métier calculée ici est la même sur la machine du
 * gérant que sur celle de l'intégration continue.
 */

const SITE = 's-buna';
const DAY = '2026-08-13';
const t = (time: string) => `${DAY}T${time}`;

const LAIT: Item = {
  id: 'it-lait', name: 'Lait entier', kind: 'RAW_MATERIAL', unit: 'L',
  minimumStock: 10, targetStock: 25, weightedAvgCost: 1000,
};

const LATTE: Item = {
  id: 'it-latte', name: 'Vanilla Iced Coffee', kind: 'FINISHED', unit: 'unite',
  price: 2500, weightedAvgCost: 900,
};

const TILL: CashSession = {
  id: 'cs-1', siteId: SITE, sellerId: 'u-aicha', shiftNumber: 2,
  openingCash: 25_000, countedCash: null, openedAt: t('07:00:00'), closedAt: null,
};

const sale = (over: Partial<Sale>): Sale => ({
  id: `sale-${over.number ?? 1}`,
  number: over.number ?? 1,
  siteId: SITE,
  locationId: 'loc-pos',
  cashSessionId: TILL.id,
  sellerId: 'u-aicha',
  lines: [{ itemId: LATTE.id, name: LATTE.name, quantity: 1, unitPrice: 2500, unitCost: 900 }],
  total: 2500,
  cogs: 900,
  paymentMethod: 'CASH',
  amountReceived: 2500,
  status: 'COMPLETED',
  createdAt: t('11:00:00'),
  ...over,
});

/* 40 lattes en espèces (100 000) + 8 en Mobile Money (20 000). */
const SALES: Sale[] = [
  ...Array.from({ length: 40 }, (_, i) => sale({ number: 100 + i, total: 2500 })),
  ...Array.from({ length: 8 }, (_, i) =>
    sale({ number: 200 + i, total: 2500, paymentMethod: 'MOBILE_MONEY' })),
];

/* 10 000 FCFA de transport payés en espèces : autant de moins dans le tiroir. */
const EXPENSES: Expense[] = [
  {
    id: 'ex-1', amount: 10_000, category: 'TRANSPORT', description: 'Transport marché → cuisine',
    paymentMethod: 'CASH', userId: 'u-fatou', createdAt: t('08:30:00'),
  },
  {
    id: 'ex-2', amount: 18_000, category: 'ENERGIE', description: 'Recharge électricité',
    paymentMethod: 'MOBILE_MONEY', userId: 'u-fatou', createdAt: t('09:00:00'),
  },
];

const mv = (over: Partial<StockMovement>): StockMovement => ({
  id: `m-${Math.random()}`, organizationId: 'org', siteId: SITE, locationId: 'loc-cuisine',
  itemId: LAIT.id, quantity: 0, unit: 'L', movementType: 'INITIAL',
  referenceType: 'Seed', referenceId: 'r', userId: 'u', deviceId: 'd',
  createdAt: t('06:00:00'), ...over,
});

/* Théorique du lait : 20 reçus − 3 consommés − 1 jeté = 16 L. */
const MOVEMENTS: StockMovement[] = [
  mv({ quantity: 20, movementType: 'PURCHASE_RECEIPT' }),
  mv({ quantity: -3, movementType: 'PRODUCTION_CONSUMPTION', createdAt: t('09:30:00') }),
  mv({ quantity: -1, movementType: 'WASTE', createdAt: t('15:00:00') }),
];

/** Attendu de caisse : 25 000 de fond + 100 000 d'espèces − 10 000 de dépenses. */
const EXPECTED_CASH = 115_000;

const ctxOf = (over: Partial<ClosingContextInput> = {}): ClosingContext =>
  closingContext({
    siteId: SITE,
    businessDate: DAY,
    actor: { id: 'u-mariama', role: 'MANAGER' },
    now: t('21:00:00'),
    items: [LAIT, LATTE],
    sales: SALES,
    expenses: EXPENSES,
    movements: MOVEMENTS,
    cashSessions: [TILL],
    ...over,
  });

const fresh = () => startClosing(SITE, DAY);

/* -------------------------------------------------------- Journée métier */

describe('La journée métier est celle de la caisse, pas celle du serveur', () => {
  it('lit une date déjà normalisée sans la déplacer', () => {
    expect(businessDateOf(DAY)).toBe(DAY);
  });

  it('rattache un horodatage à sa journée civile', () => {
    expect(businessDateOf(t('23:45:00'))).toBe(DAY);
  });

  it('rend à la veille ce qui est encaissé après minuit quand le café ferme tard', () => {
    const tardif = { ...DEFAULT_CLOSING_POLICY, dayStartHour: 4 };
    expect(businessDateOf('2026-08-14T01:30:00', tardif)).toBe('2026-08-13');
    expect(businessDateOf('2026-08-14T06:00:00', tardif)).toBe('2026-08-14');
  });

  it('écrit la date comme on la lit', () => {
    expect(formatBusinessDate(DAY)).toBe('13 août 2026');
    expect(formatBusinessDate('2026-09-01')).toBe('1er septembre 2026');
  });
});

/* ------------------------------------------- Étape 1 — comptage de caisse */

describe('Étape 1 — l’attendu reste masqué jusqu’à la saisie', () => {
  it('ne rend aucun montant attendu avant que le comptage soit déclaré', () => {
    const view = cashCountView(ctxOf(), null);
    expect(view.revealed).toBe(false);
    // Le champ n'est pas seulement caché : il est absent de l'objet.
    expect('expected' in view).toBe(false);
  });

  it('déduit l’attendu du fond de caisse, des ventes espèces et des dépenses espèces', () => {
    const view = cashCountView(ctxOf(), { step: 'CASH_COUNT', countedCash: EXPECTED_CASH });
    expect(view.revealed).toBe(true);
    if (!view.revealed) return;
    expect(view.breakdown).toEqual({ openingCash: 25_000, cashSales: 100_000, cashExpenses: 10_000 });
    expect(view.expected).toBe(EXPECTED_CASH);
  });

  it('caisse juste : rien à justifier', () => {
    const out = completeStep(fresh(), ctxOf(), { step: 'CASH_COUNT', countedCash: EXPECTED_CASH });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.events[0].eventType).toBe('CASH_SESSION_CLOSED');
    expect(out.audit[0].detail).toBe('caisse juste');
  });

  it('écart sous le seuil : constaté, pas fautif', () => {
    const view = cashCountView(ctxOf(), { step: 'CASH_COUNT', countedCash: EXPECTED_CASH - 300 });
    expect(view.revealed && view.variance).toBe(-300);
    expect(view.revealed && view.withinTolerance).toBe(true);

    const out = completeStep(fresh(), ctxOf(), { step: 'CASH_COUNT', countedCash: EXPECTED_CASH - 300 });
    expect(out.ok).toBe(true);
  });

  it('écart au-dessus du seuil sans motif : bloque', () => {
    const out = completeStep(fresh(), ctxOf(), { step: 'CASH_COUNT', countedCash: EXPECTED_CASH - 7_000 });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toBe('REASON_REQUIRED');
    expect(out.message).toContain('7');
  });

  it('le même écart passe une fois expliqué', () => {
    const out = completeStep(fresh(), ctxOf(), {
      step: 'CASH_COUNT',
      countedCash: EXPECTED_CASH - 7_000,
      reason: 'avance sur salaire prise dans le tiroir',
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.audit[0].detail).toContain('avance sur salaire');
  });

  it('refuse un montant qui n’est pas un montant', () => {
    const out = completeStep(fresh(), ctxOf(), { step: 'CASH_COUNT', countedCash: -1 });
    expect(out.ok === false && out.error).toBe('INVALID_DECLARATION');
  });
});

/* ------------------------------------- Étape 2 — rapprochement des ventes */

const afterCash = (ctx: ClosingContext): ClosingSession => {
  const out = completeStep(fresh(), ctx, { step: 'CASH_COUNT', countedCash: EXPECTED_CASH });
  if (!out.ok) throw new Error(out.message);
  return out.session;
};

describe('Étape 2 — rapprochement des ventes', () => {
  it('masque le total système tant que le relevé du canal n’est pas saisi', () => {
    expect(salesReconciliationView(ctxOf(), null).revealed).toBe(false);
  });

  it('ne masque rien quand il n’y a rien à compter', () => {
    const ctx = ctxOf({ sales: SALES.filter((s) => s.paymentMethod === 'CASH') });
    const view = salesReconciliationView(ctx, null);
    expect(view.revealed).toBe(true);
    expect(view.revealed && view.lines).toHaveLength(0);
  });

  it('exige un relevé pour chaque canal réellement utilisé', () => {
    const out = completeStep(afterCash(ctxOf()), ctxOf(), {
      step: 'SALES_RECONCILIATION', declaredTotals: {},
    });
    expect(out.ok === false && out.error).toBe('INCOMPLETE_COUNT');
    expect(out.ok === false && out.message).toContain('Mobile Money');
  });

  it('passe quand le relevé correspond', () => {
    const out = completeStep(afterCash(ctxOf()), ctxOf(), {
      step: 'SALES_RECONCILIATION', declaredTotals: { MOBILE_MONEY: 20_000 },
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.events[0].eventType).toBe('SALES_RECONCILED');
  });

  it('bloque un écart de canal non expliqué, puis l’accepte avec le motif', () => {
    const ctx = ctxOf();
    const bloque = completeStep(afterCash(ctx), ctx, {
      step: 'SALES_RECONCILIATION', declaredTotals: { MOBILE_MONEY: 15_000 },
    });
    expect(bloque.ok === false && bloque.error).toBe('REASON_REQUIRED');

    const passe = completeStep(afterCash(ctx), ctx, {
      step: 'SALES_RECONCILIATION',
      declaredTotals: { MOBILE_MONEY: 15_000 },
      reason: 'un transfert de 5 000 arrive demain matin',
    });
    expect(passe.ok).toBe(true);
  });

  it('RULE-010 — la file de synchronisation informe, elle ne bloque jamais', () => {
    const ctx = ctxOf({ pendingEventCount: 12 });
    const view = salesReconciliationView(ctx, {
      step: 'SALES_RECONCILIATION', declaredTotals: { MOBILE_MONEY: 20_000 },
    });
    expect(view.revealed && view.pendingEventCount).toBe(12);

    const out = completeStep(afterCash(ctx), ctx, {
      step: 'SALES_RECONCILIATION', declaredTotals: { MOBILE_MONEY: 20_000 },
    });
    expect(out.ok).toBe(true);
  });

  it('remonte les ventes annulées de la journée', () => {
    const ctx = ctxOf({
      sales: [...SALES, sale({ number: 999, status: 'VOIDED', voidReason: 'erreur de saisie' })],
    });
    const view = salesReconciliationView(ctx, {
      step: 'SALES_RECONCILIATION', declaredTotals: { MOBILE_MONEY: 20_000 },
    });
    expect(view.revealed && view.voided).toHaveLength(1);
    // Une vente annulée ne rapporte rien : elle sort du chiffre d'affaires.
    expect(view.revealed && view.revenue).toBe(120_000);
  });
});

/* ------------------------------------------ Étape 3 — écarts de stock */

const afterSales = (ctx: ClosingContext): ClosingSession => {
  const out = completeStep(afterCash(ctx), ctx, {
    step: 'SALES_RECONCILIATION', declaredTotals: { MOBILE_MONEY: 20_000 },
  });
  if (!out.ok) throw new Error(out.message);
  return out.session;
};

const SCOPE = [{ itemId: LAIT.id, locationId: 'loc-cuisine' }];

describe('Étape 3 — l’écart se calcule depuis les mouvements (RULE-002)', () => {
  it('projette le théorique au lieu de lire un niveau stocké', () => {
    const ctx = ctxOf({ countScope: SCOPE });
    const view = stockVarianceView(ctx, {
      step: 'STOCK_VARIANCE',
      counts: [{ itemId: LAIT.id, locationId: 'loc-cuisine', counted: 15.5 }],
    });
    expect(view.revealed).toBe(true);
    if (!view.revealed) return;
    expect(view.lines[0].theoretical).toBe(16); // 20 − 3 − 1
    expect(view.lines[0].delta).toBe(-0.5);
    expect(view.lines[0].value).toBe(-500); // valorisé au coût moyen pondéré
  });

  it('masque le théorique tant que le comptage n’est pas déclaré', () => {
    expect(stockVarianceView(ctxOf({ countScope: SCOPE }), null).revealed).toBe(false);
  });

  it('laisse passer un petit écart et émet un mouvement d’ajustement', () => {
    const ctx = ctxOf({ countScope: SCOPE });
    const out = completeStep(afterSales(ctx), ctx, {
      step: 'STOCK_VARIANCE',
      counts: [{ itemId: LAIT.id, locationId: 'loc-cuisine', counted: 15.5 }],
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.movements).toHaveLength(1);
    expect(out.movements[0]).toMatchObject({
      itemId: LAIT.id, quantity: -0.5, unit: 'L', movementType: 'ADJUSTMENT',
    });
  });

  it('bloque un écart significatif sans motif, puis l’accepte motivé', () => {
    const ctx = ctxOf({ countScope: SCOPE });
    const bloque = completeStep(afterSales(ctx), ctx, {
      step: 'STOCK_VARIANCE',
      counts: [{ itemId: LAIT.id, locationId: 'loc-cuisine', counted: 13 }],
    });
    expect(bloque.ok === false && bloque.error).toBe('REASON_REQUIRED');
    expect(bloque.ok === false && bloque.message).toContain('Lait entier');

    const passe = completeStep(afterSales(ctx), ctx, {
      step: 'STOCK_VARIANCE',
      counts: [{ itemId: LAIT.id, locationId: 'loc-cuisine', counted: 13, reason: 'CASSE' }],
    });
    expect(passe.ok).toBe(true);
    if (!passe.ok) return;
    expect(passe.events.map((e) => e.eventType)).toEqual(['STOCK_COUNTED', 'STOCK_VARIANCE_DETECTED']);
  });

  it('refuse un comptage partiel du périmètre', () => {
    const ctx = ctxOf({ countScope: [...SCOPE, { itemId: LATTE.id, locationId: 'loc-pos' }] });
    const out = completeStep(afterSales(ctx), ctx, {
      step: 'STOCK_VARIANCE',
      counts: [{ itemId: LAIT.id, locationId: 'loc-cuisine', counted: 16 }],
    });
    expect(out.ok === false && out.error).toBe('INCOMPLETE_COUNT');
  });

  it('n’émet aucun mouvement quand le comptage tombe juste', () => {
    const ctx = ctxOf({ countScope: SCOPE });
    const out = completeStep(afterSales(ctx), ctx, {
      step: 'STOCK_VARIANCE',
      counts: [{ itemId: LAIT.id, locationId: 'loc-cuisine', counted: 16 }],
    });
    expect(out.ok && out.movements).toHaveLength(0);
  });
});

/* --------------------------------------- Séquence complète et validation */

/** Franchit les quatre premières étapes avec une journée sans écart. */
function walkToValidation(ctx: ClosingContext): ClosingSession {
  let session = afterSales(ctx);
  for (const declaration of [
    { step: 'STOCK_VARIANCE' as const, counts: [] },
    { step: 'EXPENSES' as const, confirmed: true },
  ]) {
    const out = completeStep(session, ctx, declaration);
    if (!out.ok) throw new Error(out.message);
    session = out.session;
  }
  return session;
}

describe('Séquence des cinq étapes', () => {
  it('refuse de sauter une étape', () => {
    const out = completeStep(fresh(), ctxOf(), { step: 'EXPENSES', confirmed: true });
    expect(out.ok === false && out.error).toBe('STEP_NOT_REACHABLE');
  });

  it('refuse de franchir deux fois la même étape', () => {
    const ctx = ctxOf();
    const out = completeStep(afterCash(ctx), ctx, { step: 'CASH_COUNT', countedCash: EXPECTED_CASH });
    expect(out.ok === false && out.error).toBe('STEP_ALREADY_COMPLETED');
  });

  it('exige une confirmation explicite des dépenses', () => {
    const ctx = ctxOf();
    let session = afterSales(ctx);
    const stock = completeStep(session, ctx, { step: 'STOCK_VARIANCE', counts: [] });
    expect(stock.ok).toBe(true);
    if (!stock.ok) return;
    session = stock.session;

    const out = completeStep(session, ctx, { step: 'EXPENSES', confirmed: false });
    expect(out.ok === false && out.error).toBe('CONFIRMATION_REQUIRED');
  });

  it('garde le récapitulatif fermé tant que les quatre étapes ne sont pas faites', () => {
    const view = finalValidationView(afterCash(ctxOf()), ctxOf());
    expect(view.ready).toBe(false);
    expect(!view.ready && view.blockers.length).toBeGreaterThan(0);
  });

  it('décrit à l’écran ce qui manque, étape par étape', () => {
    const ctx = ctxOf();
    const debut = closingProgress(fresh(), ctx);
    expect(debut.map((p) => p.state)).toEqual(['CURRENT', 'PENDING', 'PENDING', 'PENDING', 'PENDING']);
    // L'étape courante dit le geste attendu ; les suivantes disent ce qui les retient.
    expect(debut[0].blockers[0]).toContain('Comptez les espèces');
    expect(debut[1].blockers[0]).toContain('Comptage de caisse');

    const ensuite = closingProgress(afterCash(ctx), ctx);
    expect(ensuite.map((p) => p.state)).toEqual(['DONE', 'CURRENT', 'PENDING', 'PENDING', 'PENDING']);
    expect(ensuite[1].blockers[0]).toContain('Mobile Money');
    expect(ensuite[0].revertable).toBe(true);
  });

  it('revenir en arrière fait tomber les étapes qui en dépendaient', () => {
    const ctx = ctxOf();
    const session = walkToValidation(ctx);
    expect(session.steps).toHaveLength(4);

    const back = revertStep(session, 'CASH_COUNT');
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.session.steps).toHaveLength(0);
    expect(back.audit[0].detail).toContain('Rapprochement des ventes');
  });

  it('un vendeur ne clôture pas la journée', () => {
    const ctx = ctxOf({ actor: { id: 'u-aicha', role: 'SELLER' } });
    const out = completeStep(walkToValidation(ctx), ctx, { step: 'FINAL_VALIDATION', confirmed: true });
    expect(out.ok === false && out.error).toBe('FORBIDDEN');
  });

  it('produit le récapitulatif du jour à la validation', () => {
    const ctx = ctxOf();
    const view = finalValidationView(walkToValidation(ctx), ctx);
    expect(view.ready).toBe(true);
    if (!view.ready) return;
    expect(view.recap.revenue).toBe(120_000);
    expect(view.recap.cogs).toBe(43_200); // 48 ventes × 900
    expect(view.recap.grossMargin).toBe(76_800);
    expect(view.recap.expensesTotal).toBe(28_000);
    expect(view.recap.cashVariance).toBe(0);
  });
});

/* --------------------------------------------- RULE-009 — verrouillage */

/** Déroule la clôture complète et retourne la journée verrouillée. */
function closeTheDay(over: Partial<ClosingContextInput> = {}): DayClosure {
  const ctx = ctxOf(over);
  const out = completeStep(walkToValidation(ctx), ctx, { step: 'FINAL_VALIDATION', confirmed: true });
  if (!out.ok) throw new Error(out.message);
  if (!out.closure) throw new Error('La validation finale doit produire une clôture');
  expect(out.session.status).toBe('VALIDATED');
  expect(out.events[0].eventType).toBe('DAY_CLOSED');
  return out.closure;
}

const ledger = (closure: DayClosure) => ({ closures: [closure] });

describe('RULE-009 — une journée validée est verrouillée', () => {
  it('verrouille la journée du site', () => {
    const closure = closeTheDay();
    expect(closure.status).toBe('LOCKED');
    expect(isDayLocked(DAY, SITE, ledger(closure))).toBe(true);
    expect(dayClosureOf(t('12:00:00'), SITE, ledger(closure))?.id).toBe(closure.id);
  });

  it('ne verrouille que ce site : l’autre boutique continue de vendre', () => {
    const closure = closeTheDay();
    expect(isDayLocked(DAY, 's-autre', ledger(closure))).toBe(false);
  });

  it('refuse une vente datée d’une journée verrouillée, en français', () => {
    const closure = closeTheDay();
    const refus = admitEvent(
      { siteId: SITE, occurredAt: t('18:00:00'), label: 'vente' },
      ledger(closure),
    );
    expect(refus.accepted).toBe(false);
    if (refus.accepted) return;
    expect(refus.businessDate).toBe(DAY);
    expect(refus.message).toContain('13 août 2026');
    expect(refus.message).toContain('vente');
    expect(refus.message).toContain('Owner');
  });

  it('laisse passer la même vente datée du lendemain', () => {
    const closure = closeTheDay();
    const admission = admitEvent(
      { siteId: SITE, occurredAt: '2026-08-14T09:00:00', label: 'vente' },
      ledger(closure),
    );
    expect(admission.accepted).toBe(true);
  });

  it('refuse de revenir sur une étape après la validation', () => {
    const ctx = ctxOf();
    const out = completeStep(walkToValidation(ctx), ctx, { step: 'FINAL_VALIDATION', confirmed: true });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const back = revertStep(out.session, 'CASH_COUNT');
    expect(back.ok === false && back.error).toBe('DAY_ALREADY_LOCKED');
  });

  it('refuse une seconde clôture de la même journée', () => {
    const closure = closeTheDay();
    const ctx = ctxOf({ closures: [closure] });
    const out = completeStep(fresh(), ctx, { step: 'CASH_COUNT', countedCash: EXPECTED_CASH });
    expect(out.ok === false && out.error).toBe('DAY_ALREADY_LOCKED');
  });
});

describe('RULE-009 — réouverture explicite par un OWNER', () => {
  const motif = 'une vente de 2 500 FCFA a été oubliée sur le carnet';

  it('rouvre, puis la vente du jour repasse', () => {
    const closure = closeTheDay();
    const out = reopenDay(DAY, SITE, ledger(closure), {
      actor: { id: 'u-bouna', role: 'OWNER' },
      reason: motif,
      at: '2026-08-14T08:00:00',
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    expect(out.closure.status).toBe('REOPENED');
    expect(isDayLocked(DAY, SITE, ledger(out.closure))).toBe(false);
    expect(admitEvent({ siteId: SITE, occurredAt: t('18:00:00'), label: 'vente' }, ledger(out.closure)).accepted).toBe(true);
  });

  it('garde la trace : événement, audit, motif et auteur', () => {
    const closure = closeTheDay();
    const out = reopenDay(DAY, SITE, ledger(closure), {
      actor: { id: 'u-bouna', role: 'OWNER' }, reason: motif,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    expect(out.events[0].eventType).toBe('DAY_REOPENED');
    expect(out.audit[0].detail).toContain(motif);
    // La clôture n'est pas effacée : la réouverture s'y ajoute.
    expect(out.closure.reopenings).toHaveLength(1);
    expect(out.closure.reopenings[0]).toMatchObject({ reopenedBy: 'u-bouna', role: 'OWNER', reason: motif });
    expect(out.closure.record.revenue).toBe(120_000);
  });

  it('refuse la réouverture à un manager', () => {
    const closure = closeTheDay();
    const out = reopenDay(DAY, SITE, ledger(closure), {
      actor: { id: 'u-mariama', role: 'MANAGER' }, reason: motif,
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toBe('FORBIDDEN');
    expect(out.message).toContain('Owner');
  });

  it('refuse la réouverture sans motif', () => {
    const closure = closeTheDay();
    const out = reopenDay(DAY, SITE, ledger(closure), {
      actor: { id: 'u-bouna', role: 'OWNER' }, reason: '  ',
    });
    expect(out.ok === false && out.error).toBe('REASON_REQUIRED');
  });

  it('refuse de rouvrir une journée qui n’a jamais été clôturée', () => {
    const out = reopenDay(DAY, SITE, { closures: [] }, {
      actor: { id: 'u-bouna', role: 'OWNER' }, reason: motif,
    });
    expect(out.ok === false && out.error).toBe('DAY_NOT_LOCKED');
  });

  it('une journée rouverte puis reclôturée redevient verrouillée', () => {
    const closure = closeTheDay();
    const reopened = reopenDay(DAY, SITE, ledger(closure), {
      actor: { id: 'u-bouna', role: 'OWNER' }, reason: motif,
    });
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;

    const ctx = ctxOf({ closures: [reopened.closure] });
    const out = completeStep(walkToValidation(ctx), ctx, { step: 'FINAL_VALIDATION', confirmed: true });
    expect(out.ok).toBe(true);
    if (!out.ok || !out.closure) return;
    expect(out.closure.status).toBe('LOCKED');
  });
});
