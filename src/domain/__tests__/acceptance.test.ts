import { describe, expect, it } from 'vitest';
import {
  projectStock, replenishmentNeed, stockAt, stockHealth, stockTotal, weightedAverageCost,
} from '../stock';
import { convert } from '../units';
import type { Item, StockMovement } from '../types';
import { fcfa } from '../money';
import { TEST_ACTOR } from './actors';

/**
 * §107 — Critical Acceptance Tests.
 * Ces tests encodent les règles métier que le produit ne doit jamais casser.
 */

const milk: Item = {
  id: 'it-lait', name: 'Lait entier', kind: 'RAW_MATERIAL', unit: 'L',
  minimumStock: 10, targetStock: 25, weightedAvgCost: 1000,
};

const mv = (over: Partial<StockMovement>): StockMovement => ({
  id: 'm', organizationId: 'o', siteId: 's', locationId: 'loc-a', itemId: 'it-lait',
  quantity: 0, unit: 'L', movementType: 'INITIAL', referenceType: 'T', referenceId: 'r',
  userId: 'u', deviceId: 'd', createdAt: '2026-08-12T10:00:00Z', actor: TEST_ACTOR, ...over,
});

describe('RULE-002 — le stock est une projection des mouvements', () => {
  it('additionne entrées et sorties plutôt que d\'écraser un niveau', () => {
    const movements = [
      mv({ quantity: 20, movementType: 'PURCHASE_RECEIPT' }),
      mv({ quantity: -3, movementType: 'PRODUCTION_CONSUMPTION' }),
      mv({ quantity: -1, movementType: 'WASTE' }),
    ];
    expect(stockAt(movements, 'it-lait', 'loc-a', milk)).toBe(16);
  });

  it('sépare les emplacements et les reconsolide au total', () => {
    const movements = [
      mv({ quantity: 10, locationId: 'loc-a' }),
      mv({ quantity: 6, locationId: 'loc-b' }),
    ];
    expect(stockAt(movements, 'it-lait', 'loc-a', milk)).toBe(10);
    expect(stockTotal(movements, 'it-lait', milk)).toBe(16);
  });

  it('convertit les unités : une recette en mL se déduit d\'un achat en L', () => {
    const movements = [
      mv({ quantity: 20, unit: 'L' }),
      mv({ quantity: -150, unit: 'mL', movementType: 'PRODUCTION_CONSUMPTION' }),
    ];
    expect(stockAt(movements, 'it-lait', 'loc-a', milk)).toBeCloseTo(19.85, 5);
  });

  it('projette tous les articles en une passe', () => {
    const items = new Map([['it-lait', milk]]);
    const projected = projectStock([mv({ quantity: 5 }), mv({ quantity: 2 })], items);
    expect(projected.get('it-lait@loc-a')).toBe(7);
  });
});

describe('§107 Replenishment — stock 5 L, minimum 10, cible 25 → besoin 20', () => {
  it('calcule le besoin depuis la cible', () => {
    expect(replenishmentNeed(5, milk)).toBe(20);
  });

  it('ne propose jamais un besoin négatif', () => {
    expect(replenishmentNeed(30, milk)).toBe(0);
  });

  it('classe la santé du stock sans jamais mentir sur une rupture', () => {
    expect(stockHealth(0, milk)).toBe('RUPTURE');
    expect(stockHealth(8, milk)).toBe('CRITIQUE');
    expect(stockHealth(13, milk)).toBe('SURVEILLER');
    expect(stockHealth(24, milk)).toBe('OK');
  });
});

describe('§40 — Weighted Average Cost', () => {
  it('10 L @ 1 000 puis 10 L @ 1 200 donne 1 100', () => {
    expect(weightedAverageCost(10, 1000, 10, 1200)).toBe(1100);
  });

  it('prend le prix entrant quand le stock est vide', () => {
    expect(weightedAverageCost(0, 0, 20, 1100)).toBe(1100);
    expect(weightedAverageCost(-2, 900, 20, 1100)).toBe(1100);
  });

  it('§41 — une hausse fournisseur déplace le coût du produit fini', () => {
    const before = weightedAverageCost(10, 1000, 0, 0);
    const after = weightedAverageCost(10, 1000, 10, 1400);
    expect(after).toBeGreaterThan(before);
  });
});

describe('§10 — conversions d\'unités', () => {
  it('convertit dans les deux sens au sein d\'une famille', () => {
    expect(convert(1, 'L', 'mL')).toBe(1000);
    expect(convert(1500, 'g', 'kg')).toBe(1.5);
  });

  it('refuse une conversion entre familles incompatibles', () => {
    expect(() => convert(1, 'L', 'kg')).toThrow();
  });
});

describe('Affichage FCFA', () => {
  it('sépare les milliers et utilise le vrai signe moins', () => {
    expect(fcfa(487500)).toBe('487\u00A0500');
    expect(fcfa(-1500)).toBe('\u22121\u00A0500');
  });
});
