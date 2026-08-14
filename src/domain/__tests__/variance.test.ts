import { describe, expect, it } from 'vitest';
import {
  breakdownBySource, isCostly, isOpen, openVariances, recoveredCost, resolve,
  unresolvedAmount, type Variance, type VarianceSource,
} from '../variance';
import { TEST_ACTOR } from './actors';

const MANAGER = { ...TEST_ACTOR, userId: 'u-matel', userName: 'Matel', post: 'MANAGER' as const, under: 'RESOLVE_VARIANCE' as const };

let n = 0;
const variance = (over: Partial<Variance> & { source: VarianceSource; delta: number }): Variance => ({
  id: `v-${++n}`,
  reference: 'ref',
  subject: 'Lait entier',
  theoretical: 16,
  declared: 16 + over.delta,
  amount: Math.abs(over.delta) * 1000,
  actor: TEST_ACTOR,
  resolution: null,
  resolver: null,
  createdAt: '2026-08-12T18:00:00Z',
  ...over,
});

describe('Un écart est une question ouverte', () => {
  it('reste ouvert tant que personne ne lui a donné de motif', () => {
    const v = variance({ source: 'STOCK', delta: -2 });
    expect(isOpen(v)).toBe(true);
    expect(unresolvedAmount([v])).toBe(2000);
  });

  it('classe les écarts ouverts du plus lourd au plus léger', () => {
    const petit = variance({ source: 'STOCK', delta: -1 });
    const gros = variance({ source: 'CASH', delta: -8 });
    expect(openVariances([petit, gros])[0].id).toBe(gros.id);
  });

  it('ne compte plus un écart soldé dans ce qui reste à expliquer', () => {
    const v = variance({ source: 'STOCK', delta: -2 });
    const soldé = resolve(v, 'PERTE', MANAGER)!;
    expect(unresolvedAmount([soldé])).toBe(0);
  });
});

describe('Le motif décide de ce que l\'écart coûte', () => {
  it('ne compte rien pour une erreur de saisie corrigée', () => {
    const v = resolve(variance({ source: 'STOCK', delta: -3 }), 'ERREUR_SAISIE', MANAGER)!;
    expect(isCostly('ERREUR_SAISIE')).toBe(false);
    expect(recoveredCost([v])).toBe(0);
  });

  it('compte une perte, un vol et un produit offert', () => {
    const rows = [
      resolve(variance({ source: 'STOCK', delta: -1 }), 'PERTE', MANAGER)!,
      resolve(variance({ source: 'CASH', delta: -2 }), 'VOL', MANAGER)!,
      resolve(variance({ source: 'STOCK', delta: -3 }), 'OFFERT', MANAGER)!,
    ];
    expect(recoveredCost(rows)).toBe(1000 + 2000 + 3000);
  });
});

describe('Le premier motif fait foi', () => {
  it('refuse de resolder un écart déjà soldé', () => {
    const v = resolve(variance({ source: 'CASH', delta: -5 }), 'PERTE', MANAGER)!;
    expect(resolve(v, 'ERREUR_SAISIE', MANAGER)).toBeNull();
  });

  it('ne mute pas l\'écart d\'origine', () => {
    const v = variance({ source: 'CASH', delta: -5 });
    resolve(v, 'PERTE', MANAGER);
    expect(v.resolution).toBeNull();
  });

  it('retient qui a soldé, en plus de qui a constaté', () => {
    const v = resolve(variance({ source: 'CASH', delta: -5 }), 'PERTE', MANAGER)!;
    expect(v.actor.userId).toBe('u-aicha');
    expect(v.resolver?.userId).toBe('u-matel');
    expect(v.resolver?.under).toBe('RESOLVE_VARIANCE');
  });
});

describe('La répartition par source', () => {
  it('sépare la caisse, le stock et le rendement', () => {
    const rows = [
      variance({ source: 'CASH', delta: -2 }),
      variance({ source: 'STOCK', delta: -3 }),
      resolve(variance({ source: 'YIELD', delta: -1 }), 'PERTE', MANAGER)!,
    ];
    const b = breakdownBySource(rows);
    expect(b.find((x) => x.source === 'CASH')!.openAmount).toBe(2000);
    expect(b.find((x) => x.source === 'STOCK')!.open).toBe(1);
    expect(b.find((x) => x.source === 'YIELD')!.resolved).toBe(1);
    expect(b.find((x) => x.source === 'YIELD')!.costlyAmount).toBe(1000);
  });
});
