import { describe, expect, it } from 'vitest';
import { feasibleUnits, shortfallFor } from '../production';
import type { Item } from '../types';

const item = (id: string, name: string, unit: Item['unit']): Item =>
  ({ id, organizationId: 'org', name, kind: 'RAW_MATERIAL', unit, active: true } as Item);

const CATALOG = new Map<string, Item>([
  ['lait', item('lait', 'Lait entier', 'L')],
  ['cafe', item('cafe', 'Café en grains', 'kg')],
  ['gobelet', item('gobelet', 'Gobelet', 'unite')],
]);
const itemOf = (id: string) => CATALOG.get(id);

/* Recette en mL et g face à un stock en L et kg : c'est là que le calcul
   naïf se trompe d'un facteur mille. */
const RECIPE = [
  { itemId: 'lait', quantity: 180, unit: 'mL' as const },
  { itemId: 'cafe', quantity: 20, unit: 'g' as const },
  { itemId: 'gobelet', quantity: 1, unit: 'unite' as const },
];

describe('faisabilité de production', () => {
  it("convertit l'unité de recette vers celle de l'article", () => {
    // 6,2 L de lait à 180 mL l'unité = 34 unités, pas 0.
    const stock = { lait: 6.2, cafe: 5, gobelet: 500 } as Record<string, number>;
    const f = feasibleUnits(RECIPE, itemOf, (id) => stock[id] ?? 0);
    expect(f.units).toBe(34);
    expect(f.limitingName).toBe('Lait entier');
  });

  it('désigne le maillon le plus faible, pas le premier venu', () => {
    const stock = { lait: 100, cafe: 5, gobelet: 12 } as Record<string, number>;
    const f = feasibleUnits(RECIPE, itemOf, (id) => stock[id] ?? 0);
    expect(f.units).toBe(12);
    expect(f.limitingName).toBe('Gobelet');
  });

  it('rend zéro quand un ingrédient manque', () => {
    const stock = { lait: 0, cafe: 5, gobelet: 500 } as Record<string, number>;
    expect(feasibleUnits(RECIPE, itemOf, (id) => stock[id] ?? 0).units).toBe(0);
  });

  it("distingue « je ne sais pas » de « zéro »", () => {
    const f = feasibleUnits([], itemOf, () => 0);
    expect(f.unknown).toBe(true);
  });

  it('chiffre ce qui manquerait pour la quantité déclarée', () => {
    // Le cas réel : déclarer 22 unités avec 6,2 L de lait.
    const stock = { lait: 6.2, cafe: 5, gobelet: 500 } as Record<string, number>;
    const manque = shortfallFor(RECIPE, itemOf, (id) => stock[id] ?? 0, 22);
    expect(manque).toHaveLength(0); // 22 × 180 mL = 3,96 L < 6,2 L

    const apres = shortfallFor(RECIPE, itemOf, () => 0, 22);
    expect(apres.find((m) => m.name === 'Lait entier')).toMatchObject({ missing: 3.96, unit: 'L' });
  });

  it('classe par part non couverte, pas par quantité brute', () => {
    // Stock nul partout : tout manque à 100 %, l'ordre reste stable.
    const rien = shortfallFor(RECIPE, itemOf, () => 0, 100);
    expect(rien.every((m) => m.ratio === 1)).toBe(true);

    // Le lait manque à 80 %, les gobelets à 10 % : le lait passe devant,
    // alors qu'il « manque » 8 L contre 10 gobelets.
    const stock = { lait: 3.6, cafe: 100, gobelet: 90 } as Record<string, number>;
    const partiel = shortfallFor(RECIPE, itemOf, (id) => stock[id] ?? 0, 100);
    expect(partiel[0].name).toBe('Lait entier');
  });
});
