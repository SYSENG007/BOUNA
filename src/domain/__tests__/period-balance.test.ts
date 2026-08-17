import { describe, expect, it } from 'vitest';
import { materialBalance, productFlows, type PeriodWindow } from '../period-balance';
import type { Item, Purchase, Sale, StockMovement } from '../types';

const W: PeriodWindow = { from: '2026-08-17T00:00:00.000Z', to: '2026-08-18T00:00:00.000Z' };

const item = (id: string, name: string, kind: Item['kind'], unit: Item['unit'], cost?: number): Item =>
  ({ id, name, kind, unit, weightedAvgCost: cost } as Item);

const CAFE = item('cafe', 'Café Touba', 'FINISHED', 'unite');
const LAIT = item('lait', 'Lait', 'RAW_MATERIAL', 'L', 1000);
const GOBELET = item('gobelet', 'Gobelet', 'PACKAGING', 'unite', 25);

let seq = 0;
const move = (
  itemId: string, quantity: number, type: StockMovement['movementType'],
  at: string, unit: StockMovement['unit'] = 'unite',
): StockMovement => ({
  id: `m${seq++}`, organizationId: 'o', siteId: 's', locationId: 'l',
  itemId, quantity, unit, movementType: type,
  referenceType: 'T', referenceId: 'r', userId: 'u', deviceId: 'd', createdAt: at,
  actor: { userId: 'u', userName: 'Bouna', post: 'OWNER', at } as StockMovement['actor'],
});

/**
 * L'équation que le suivi simple rend possible, et qui ne demande aucune
 * recette : préparé − vendu − reste = ce que personne n'a déclaré.
 */
describe('bilan en unités', () => {
  it('boucle préparé, vendu, restant', () => {
    const movements = [
      move('cafe', 5, 'PRODUCTION_OUTPUT', '2026-08-16T10:00:00.000Z'), // la veille
      move('cafe', 40, 'PRODUCTION_OUTPUT', '2026-08-17T07:00:00.000Z'),
      move('cafe', -30, 'SALE', '2026-08-17T12:00:00.000Z'),
      move('cafe', -2, 'WASTE', '2026-08-17T15:00:00.000Z'),
    ];
    const [row] = productFlows({ items: [CAFE], movements, window: W });

    expect(row.opening).toBe(5);
    expect(row.produced).toBe(40);
    expect(row.sold).toBe(30);
    expect(row.wasted).toBe(2);
    expect(row.expected).toBe(13);
    expect(row.closing).toBe(13);
    /* Personne n'a compté : l'écart vaut zéro et ne prouve rien. */
    expect(row.gap).toBe(0);
    expect(row.counted).toBe(false);
  });

  it("chiffre ce que le comptage du soir a dû corriger", () => {
    const movements = [
      move('cafe', 40, 'PRODUCTION_OUTPUT', '2026-08-17T07:00:00.000Z'),
      move('cafe', -30, 'SALE', '2026-08-17T12:00:00.000Z'),
      /* On attendait 10, on en compte 7 : trois sont partis sans être déclarés. */
      move('cafe', -3, 'ADJUSTMENT', '2026-08-17T21:00:00.000Z'),
    ];
    const [row] = productFlows({ items: [CAFE], movements, window: W });

    expect(row.expected).toBe(10);
    expect(row.closing).toBe(7);
    expect(row.gap).toBe(-3);
    expect(row.counted).toBe(true);
  });

  it('ignore ce qui se passe hors de la fenêtre', () => {
    const movements = [
      move('cafe', 40, 'PRODUCTION_OUTPUT', '2026-08-17T07:00:00.000Z'),
      move('cafe', 99, 'PRODUCTION_OUTPUT', '2026-08-18T07:00:00.000Z'), // le lendemain
    ];
    const [row] = productFlows({ items: [CAFE], movements, window: W });
    expect(row.produced).toBe(40);
    expect(row.closing).toBe(40);
  });

  it("ne compte pas un mouvement dont l'unité ne se traduit pas", () => {
    /* Un kilo face à un article compté à l'unité : aucun facteur ne les relie.
       L'écarter vaut mieux qu'inventer un chiffre sur lequel on agirait. */
    const movements = [move('cafe', 3, 'PRODUCTION_OUTPUT', '2026-08-17T07:00:00.000Z', 'kg')];
    const rows = productFlows({ items: [CAFE], movements, window: W });
    expect(rows).toHaveLength(0);
  });
});

/**
 * `coût matière = stock initial + achats − stock final`, la méthode qui ne
 * demande aucune fiche technique.
 */
describe('bilan en argent', () => {
  const movements = [
    move('lait', 10, 'PURCHASE_RECEIPT', '2026-08-16T08:00:00.000Z', 'L'),   // 10 L la veille
    move('lait', 20, 'PURCHASE_RECEIPT', '2026-08-17T08:00:00.000Z', 'L'),   // +20 L le jour même
    move('lait', -22, 'PRODUCTION_CONSUMPTION', '2026-08-17T09:00:00.000Z', 'L'),
  ];

  const purchase: Purchase = {
    id: 'p1', supplierId: 'f', locationId: 'l',
    lines: [{ itemId: 'lait', quantity: 20, unit: 'L', actualUnitPrice: 1000 }],
    transportCost: 2000, total: 22000, paymentMethod: 'CASH',
    createdAt: '2026-08-17T08:00:00.000Z', receivedAt: '2026-08-17T08:00:00.000Z',
    actor: { userId: 'u', userName: 'Bouna', post: 'OWNER', at: '2026-08-17T08:00:00.000Z' },
  } as Purchase;

  const sale = {
    id: 's1', status: 'COMPLETED', siteId: 's', total: 40000,
    createdAt: '2026-08-17T12:00:00.000Z',
  } as Sale;

  it('déduit la consommation du stock, pas des recettes', () => {
    const b = materialBalance({
      items: [LAIT, GOBELET, CAFE], movements, sales: [sale], purchases: [purchase], window: W,
    });
    expect(b.openingValue).toBe(10_000);   // 10 L × 1000
    expect(b.purchases).toBe(22_000);      // 20 L × 1000 + 2000 de transport
    expect(b.closingValue).toBe(8_000);    // 8 L restants
    expect(b.consumed).toBe(24_000);       // 10 000 + 22 000 − 8 000
    expect(b.grossMargin).toBe(16_000);    // 40 000 − 24 000
    expect(b.materialSharePct).toBe(60);
  });

  it('ne compte pas la dépense de réception en plus de la réception', () => {
    /* Une réception écrit un achat ET une dépense « Matières » : le même
       argent, vu de deux côtés. Les additionner doublerait chaque livraison —
       le seul piège de la méthode, et il est silencieux. */
    const b = materialBalance({
      items: [LAIT], movements, sales: [], purchases: [purchase], window: W,
    });
    expect(b.purchases).toBe(22_000);
  });

  it('avoue quand une matière en stock n\'a pas de coût connu', () => {
    const sansCout = item('sucre', 'Sucre', 'RAW_MATERIAL', 'kg');
    const b = materialBalance({
      items: [sansCout],
      movements: [move('sucre', 4, 'PURCHASE_RECEIPT', '2026-08-17T08:00:00.000Z', 'kg')],
      sales: [], purchases: [], window: W,
    });
    /* Le total est sous-évalué, donc le coût matière surévalué. Un chiffre
       dont on tait l'approximation est lu comme exact. */
    expect(b.incomplete).toBe(true);
  });

  it('signale un stock final que personne n\'a compté', () => {
    const b = materialBalance({
      items: [LAIT], movements, sales: [], purchases: [purchase], window: W,
    });
    expect(b.uncounted).toBe(true);
  });

  it('ne réclame pas de chiffre quand il n\'y a pas de chiffre d\'affaires', () => {
    const b = materialBalance({
      items: [LAIT], movements, sales: [], purchases: [purchase], window: W,
    });
    expect(b.materialSharePct).toBeNull();
  });
});
