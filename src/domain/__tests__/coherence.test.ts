import { describe, expect, it } from 'vitest';
import { coherenceFindings, worstSeverity } from '../coherence';
import type { Item, Sale, StockMovement } from '../types';
import type { PeriodWindow } from '../period-balance';

const W: PeriodWindow = { from: '2026-08-17T00:00:00.000Z', to: '2026-08-18T00:00:00.000Z' };

const CAFE = { id: 'cafe', name: 'Café Touba', kind: 'FINISHED', unit: 'unite', price: 500 } as Item;
const LAIT = { id: 'lait', name: 'Lait', kind: 'RAW_MATERIAL', unit: 'L', weightedAvgCost: 1000 } as Item;

let seq = 0;
const move = (
  itemId: string, quantity: number, type: StockMovement['movementType'],
  at = '2026-08-17T10:00:00.000Z', unit: StockMovement['unit'] = 'unite',
): StockMovement => ({
  id: `m${seq++}`, organizationId: 'o', siteId: 's', locationId: 'l',
  itemId, quantity, unit, movementType: type, referenceType: 'T', referenceId: 'r',
  userId: 'u', deviceId: 'd', createdAt: at,
  actor: { userId: 'u', userName: 'B', post: 'OWNER', at } as StockMovement['actor'],
});

const sale = (total: number): Sale => ({
  id: 's1', status: 'COMPLETED', siteId: 's', total,
  createdAt: '2026-08-17T12:00:00.000Z',
} as Sale);

const run = (movements: StockMovement[], sales: Sale[] = [], items: Item[] = [CAFE, LAIT]) =>
  coherenceFindings({ items, movements, sales, purchases: [], window: W, mode: 'SIMPLE' });

/**
 * Le suivi simple ne bloque plus rien au moment du geste. Ces constats sont ce
 * qui remplace le blocage : on ne refuse pas la vente, on dit le soir ce
 * qu'elle a rendu invérifiable.
 */
describe('analyse de cohérence de la journée', () => {
  it('voit les ventes qui dépassent ce qui a été déclaré préparé', () => {
    /* Le cas du terrain : 40 vendus, 30 déclarés préparés. */
    const found = run([
      move('cafe', 30, 'PRODUCTION_OUTPUT'),
      move('cafe', -40, 'SALE'),
    ], [sale(20_000)]);

    const f = found.find((x) => x.id === 'vendu-sans-stock:cafe')!;
    expect(f.severity).toBe('CRITIQUE');
    expect(f.statement).toContain('40');
    expect(f.statement).toContain('30');
    /* Le constat seul ne suffit pas : il doit dire ce que ça fausse. */
    expect(f.consequence).toContain('marge');
    expect(f.suggestion.length).toBeGreaterThan(0);
  });

  it('ne dit rien quand les ventes tiennent dans ce qui existait', () => {
    const found = run([
      move('cafe', 40, 'PRODUCTION_OUTPUT'),
      move('cafe', -30, 'SALE'),
    ], [sale(15_000)]);
    expect(found.some((f) => f.id.startsWith('vendu-sans-stock'))).toBe(false);
  });

  it('signale un stock qui termine sous zéro', () => {
    const found = run([move('cafe', -3, 'SALE')], [sale(1500)]);
    expect(found.some((f) => f.id === 'stock-negatif:cafe')).toBe(true);
  });

  it("signale un produit vendu sans qu'aucune préparation n'ait été déclarée", () => {
    const found = run([move('cafe', -5, 'SALE')], [sale(2500)]);
    const f = found.find((x) => x.id === 'jamais-prepare:cafe')!;
    expect(f.consequence).toContain('100 %');
  });

  it("dit qu'une marge sans coût n'est pas un bénéfice", () => {
    const found = run([], [sale(30_000)]);
    const f = found.find((x) => x.id === 'marge-sans-cout')!;
    expect(f.severity).toBe('CRITIQUE');
  });

  it('doute d\'une part matière invraisemblable, dans les deux sens', () => {
    /* 10 L de lait consommés sur 12 000 FCFA de ventes : 83 % de part matière. */
    const haute = run([
      move('lait', 20, 'PURCHASE_RECEIPT', '2026-08-16T08:00:00.000Z', 'L'),
      move('lait', -10, 'PRODUCTION_CONSUMPTION', '2026-08-17T09:00:00.000Z', 'L'),
    ], [sale(12_000)]);
    expect(haute.some((f) => f.id === 'part-matiere-haute')).toBe(true);

    const basse = run([
      move('lait', 20, 'PURCHASE_RECEIPT', '2026-08-16T08:00:00.000Z', 'L'),
      move('lait', -1, 'PRODUCTION_CONSUMPTION', '2026-08-17T09:00:00.000Z', 'L'),
    ], [sale(200_000)]);
    expect(basse.some((f) => f.id === 'part-matiere-basse')).toBe(true);
  });

  it('rappelle que sans comptage, le stock final est une déduction', () => {
    const found = run([
      move('lait', 20, 'PURCHASE_RECEIPT', '2026-08-16T08:00:00.000Z', 'L'),
      move('lait', -5, 'PRODUCTION_CONSUMPTION', '2026-08-17T09:00:00.000Z', 'L'),
    ], [sale(50_000)]);
    expect(found.some((f) => f.id === 'jamais-compte')).toBe(true);
  });

  it('se tait quand la journée est cohérente', () => {
    const found = run([
      move('lait', 20, 'PURCHASE_RECEIPT', '2026-08-16T08:00:00.000Z', 'L'),
      move('cafe', 40, 'PRODUCTION_OUTPUT'),
      move('cafe', -30, 'SALE'),
      move('lait', -6, 'PRODUCTION_CONSUMPTION', '2026-08-17T09:00:00.000Z', 'L'),
      move('lait', -1, 'ADJUSTMENT', '2026-08-17T21:00:00.000Z', 'L'),
    ], [sale(20_000)]);
    expect(found).toEqual([]);
    expect(worstSeverity(found)).toBeNull();
  });

  it('remonte le plus grave en tête', () => {
    const found = run([move('cafe', -5, 'SALE')], [sale(2500)]);
    expect(found[0].severity).toBe('CRITIQUE');
    expect(worstSeverity(found)).toBe('CRITIQUE');
  });
});
