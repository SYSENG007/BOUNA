import { describe, expect, it } from 'vitest';
import { evaluateRules, type Cooldowns } from '../rules';
import type { Item } from '../types';

const milk: Item = {
  id: 'it-lait', name: 'Lait entier', kind: 'RAW_MATERIAL', unit: 'L',
  minimumStock: 10, targetStock: 25, weightedAvgCost: 1000,
};

const base = {
  items: [milk],
  soldToday: new Map<string, number>(),
  cashVariance: null,
  wasteCostToday: 0,
};

const at = (qty: number) => ({ ...base, stockOf: () => qty });

describe('§44 — la règle propose une action, pas un constat', () => {
  it('déclenche sous le minimum avec la quantité à commander', () => {
    const { notifications } = evaluateRules(at(5), {});
    expect(notifications).toHaveLength(1);
    expect(notifications[0].severity).toBe('ACTION_REQUIRED');
    // Cible 25 − stock 5 = 20 L à acheter.
    expect(notifications[0].actionLabel).toContain('20 L');
    expect(notifications[0].recipientCapabilities).toContain('REQUEST_PURCHASE');
  });

  it('ne déclenche rien au-dessus des seuils', () => {
    expect(evaluateRules(at(24), {}).notifications).toHaveLength(0);
  });

  it('passe en CRITICAL à la rupture', () => {
    expect(evaluateRules(at(0), {}).notifications[0].severity).toBe('CRITICAL');
  });
});

describe('§45 — cooldown et déduplication', () => {
  it('ne répète pas la même alerte pendant le cooldown', () => {
    const t0 = Date.now();
    const first = evaluateRules(at(5), {}, t0);
    expect(first.notifications).toHaveLength(1);

    // 10 minutes plus tard : le cooldown est de 60 min.
    const second = evaluateRules(at(5), first.cooldowns, t0 + 10 * 60_000);
    expect(second.notifications).toHaveLength(0);
  });

  it('redéclenche une fois le cooldown écoulé', () => {
    const t0 = Date.now();
    const first = evaluateRules(at(5), {}, t0);
    const later = evaluateRules(at(5), first.cooldowns, t0 + 61 * 60_000);
    expect(later.notifications).toHaveLength(1);
  });

  it('ignore le cooldown si la sévérité s’aggrave', () => {
    const t0 = Date.now();
    const low = evaluateRules(at(5), {}, t0);
    // Une minute plus tard, on passe en rupture : l'alerte doit sortir.
    const out = evaluateRules(at(0), low.cooldowns, t0 + 60_000);
    expect(out.notifications).toHaveLength(1);
    expect(out.notifications[0].severity).toBe('CRITICAL');
  });

  it('ne redescend pas en sévérité pendant le cooldown', () => {
    const t0 = Date.now();
    const critical = evaluateRules(at(0), {}, t0);
    const cooldowns: Cooldowns = critical.cooldowns;
    const after = evaluateRules(at(5), cooldowns, t0 + 60_000);
    expect(after.notifications).toHaveLength(0);
  });
});

describe('Écart de caisse et pertes', () => {
  it('alerte au-delà du seuil de tolérance', () => {
    const { notifications } = evaluateRules({ ...at(24), cashVariance: -7000 }, {});
    expect(notifications).toHaveLength(1);
    expect(notifications[0].actionTarget).toBe('/finance/caisse');
  });

  it('ne se répète pas quand le cooldown vaut 0', () => {
    // 0 signifie « une seule fois », pas « à chaque évaluation » : sinon le
    // moteur, réévalué après chaque mouvement, boucle indéfiniment.
    const t0 = Date.now();
    const input = { ...at(24), cashVariance: -7000 };
    const first = evaluateRules(input, {}, t0);
    expect(first.notifications).toHaveLength(1);

    const again = evaluateRules(input, first.cooldowns, t0 + 6 * 3600_000);
    expect(again.notifications).toHaveLength(0);
  });

  it('reste muet sous le seuil', () => {
    expect(evaluateRules({ ...at(24), cashVariance: -500 }, {}).notifications).toHaveLength(0);
  });
});
