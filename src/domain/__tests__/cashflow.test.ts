import { describe, expect, it } from 'vitest';
import type { Expense, PaymentMethod, Sale } from '../types';
import { cashFlowReport, cashPositions, periodFlow, upcomingOutflow } from '../cashflow';
import { periodOf } from '../analytics';
import { TEST_ACTOR } from './actors';

const DAY = '2026-08-12';
const t = (time: string) => `${DAY}T${time}.000Z`;

let n = 0;
function sale(time: string, total: number, paymentMethod: PaymentMethod = 'CASH'): Sale {
  return {
    id: `s-${++n}`, number: n, siteId: 'site', locationId: 'pos', cashSessionId: null,
    sellerId: 'u-aicha', lines: [], total, cogs: 0, paymentMethod, amountReceived: total,
    status: 'COMPLETED', createdAt: t(time), actor: TEST_ACTOR,
  };
}
function expense(time: string, amount: number, paymentMethod: PaymentMethod = 'CASH'): Expense {
  return {
    id: `e-${++n}`, amount, category: 'TRANSPORT', description: 'x',
    paymentMethod, userId: 'u-baboy', createdAt: t(time), actor: TEST_ACTOR,
  };
}

const period = periodOf(t('12:00:00'), 'DAY');

describe('La trésorerie compte l\'argent une seule fois', () => {
  it('additionne les encaissements et retranche les paiements', () => {
    const flow = periodFlow(
      { sales: [sale('09:00:00', 2500), sale('10:00:00', 1500)], expenses: [expense('11:00:00', 1000)] },
      period,
    );
    expect(flow.hasData).toBe(true);
    if (!flow.hasData) return;
    expect(flow.value.inflow).toBe(4000);
    expect(flow.value.outflow).toBe(1000);
    expect(flow.value.net).toBe(3000);
  });

  it('ignore les ventes annulées : elles n\'ont rien encaissé', () => {
    const voided = { ...sale('09:00:00', 5000), status: 'VOIDED' as const };
    const flow = periodFlow({ sales: [voided], expenses: [] }, period);
    expect(flow.hasData).toBe(false);
  });

  it('ventile par moyen de paiement : les espèces ne sont pas le mobile money', () => {
    const flow = periodFlow({
      sales: [sale('09:00:00', 3000, 'CASH'), sale('10:00:00', 2000, 'MOBILE_MONEY')],
      expenses: [expense('11:00:00', 2500, 'CASH')],
    }, period);
    if (!flow.hasData) throw new Error('flux attendu');
    expect(flow.value.byMethod.CASH.net).toBe(500);
    expect(flow.value.byMethod.MOBILE_MONEY.net).toBe(2000);
    expect(flow.value.byMethod.CARD.net).toBe(0);
  });
});

describe('Une journée sans saisie n\'est pas une journée à zéro', () => {
  it('rend hasData: false quand rien n\'a été saisi', () => {
    expect(periodFlow({ sales: [], expenses: [] }, period).hasData).toBe(false);
  });

  it('reporte le solde sur les journées vides plutôt que de le remettre à zéro', () => {
    // Une journée sans saisie ne fait pas disparaître l'argent du tiroir.
    const report = cashFlowReport(
      { sales: [sale('09:00:00', 5000)], expenses: [], openingBalance: 10_000 },
      t('12:00:00'),
      3,
    );
    expect(report.points).toHaveLength(3);
    expect(report.points[0].flow.hasData).toBe(false);
    expect(report.points[0].balance).toBe(10_000);
    expect(report.closingBalance).toBe(15_000);
  });
});

describe('L\'autonomie de trésorerie', () => {
  it('se calcule sur la sortie moyenne des jours ouvrés', () => {
    const report = cashFlowReport({
      sales: [sale('09:00:00', 20_000)],
      expenses: [expense('11:00:00', 5000)],
      openingBalance: 0,
    }, t('12:00:00'), 3);
    // 15 000 disponibles, 5 000 de sortie moyenne → 3 jours.
    expect(report.runway.hasData).toBe(true);
    if (report.runway.hasData) expect(report.runway.value).toBe(3);
  });

  it('ne répond pas « l\'infini » quand rien ne sort', () => {
    const report = cashFlowReport(
      { sales: [sale('09:00:00', 20_000)], expenses: [], openingBalance: 0 },
      t('12:00:00'), 3,
    );
    expect(report.runway.hasData).toBe(false);
    expect(report.averageBurn.hasData).toBe(false);
  });

  it('compte les journées qui ont consommé de la trésorerie', () => {
    const report = cashFlowReport(
      { sales: [], expenses: [expense('11:00:00', 5000)], openingBalance: 20_000 },
      t('12:00:00'), 2,
    );
    expect(report.negativeDays).toBe(1);
    expect(report.closingBalance).toBe(15_000);
  });
});

describe('Où est l\'argent', () => {
  it('n\'affiche que les moyens réellement utilisés', () => {
    const report = cashFlowReport({
      sales: [sale('09:00:00', 3000, 'CASH')],
      expenses: [expense('10:00:00', 1000, 'MOBILE_MONEY')],
    }, t('12:00:00'), 1);
    const positions = cashPositions(report);
    expect(positions.map((p) => p.method).sort()).toEqual(['CASH', 'MOBILE_MONEY']);
    expect(positions.find((p) => p.method === 'CASH')!.balance).toBe(3000);
    expect(positions.find((p) => p.method === 'MOBILE_MONEY')!.balance).toBe(-1000);
  });
});

describe('Ce qui va sortir', () => {
  it('valorise la liste de courses au coût moyen pondéré', () => {
    const out = upcomingOutflow([
      { itemId: 'a', name: 'Lait', quantity: 20, unitCost: 1000 },
      { itemId: 'b', name: 'Café', quantity: 5, unitCost: 4500 },
    ]);
    expect(out.total).toBe(42_500);
    // Trié par poids : ce qui coûte le plus se regarde en premier.
    expect(out.lines[0].name).toBe('Café');
    expect(out.incomplete).toBe(false);
  });

  it('signale une estimation partielle plutôt que de compter un article à zéro', () => {
    const out = upcomingOutflow([
      { itemId: 'a', name: 'Lait', quantity: 20, unitCost: 1000 },
      { itemId: 'b', name: 'Article sans coût', quantity: 5, unitCost: undefined },
    ]);
    expect(out.total).toBe(20_000);
    expect(out.incomplete).toBe(true);
    expect(out.lines).toHaveLength(1);
  });

  it('ignore ce qui n\'est pas à racheter', () => {
    const out = upcomingOutflow([{ itemId: 'a', name: 'Lait', quantity: 0, unitCost: 1000 }]);
    expect(out.total).toBe(0);
    expect(out.lines).toEqual([]);
  });
});
