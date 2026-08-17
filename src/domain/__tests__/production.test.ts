import { describe, expect, it } from 'vitest';
import { consumedBy, consumptionVariance, feasibleUnits, observedRecipe, shortfallFor } from '../production';
import type { Item, StockMovement } from '../types';
import { convert, formatDose, storageUnit, subUnitsOf } from '../units';

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


/**
 * §66 — l'écart entre ce que les recettes prévoient et ce qui est réellement
 * sorti. Il se lisait sur un article nommé en dur et une dose supposée de
 * 150 mL par vente : sur un vrai catalogue, l'article n'existait pas et
 * l'écart affiché ne décrivait rien.
 */
describe('théorique vs réel — déduit des recettes, jamais supposé', () => {
  const make = (over: Partial<StockMovement>): StockMovement => ({
    id: 'm', organizationId: 'o', siteId: 's', locationId: 'loc', itemId: 'lait',
    quantity: 0, unit: 'L', movementType: 'PRODUCTION_CONSUMPTION',
    referenceType: 'ProductionBatch', referenceId: 'b',
    createdAt: '2026-08-15T10:00:00Z', ...over,
  } as StockMovement);

  const ingredientsOf = (id: string) => (id === 'latte' ? RECIPE : undefined);

  it('convertit la recette vers l\'unité de l\'article avant de comparer', () => {
    /* 10 lattes × 180 mL = 1,8 L attendus. */
    const sold = new Map([['latte', 10]]);
    const rows = consumptionVariance(sold, [], ingredientsOf, itemOf);
    const lait = rows.find((r) => r.itemId === 'lait')!;
    expect(lait.theoretical).toBe(1.8);
    expect(lait.unit).toBe('L');
    expect(lait.soldUnits).toBe(10);
  });

  it('mesure l\'écart contre les sorties réelles de production', () => {
    const sold = new Map([['latte', 10]]);
    /* 2,1 L réellement sortis pour 1,8 L prévus : 0,3 L de trop. */
    const rows = consumptionVariance(
      sold,
      [make({ itemId: 'lait', quantity: -2.1, unit: 'L' })],
      ingredientsOf,
      itemOf,
    );
    const lait = rows.find((r) => r.itemId === 'lait')!;
    expect(lait.actual).toBe(2.1);
    expect(lait.delta).toBeCloseTo(0.3, 5);
  });

  it('ne compte que la consommation de production', () => {
    const rows = consumptionVariance(
      new Map([['latte', 1]]),
      [
        make({ itemId: 'lait', quantity: -5, unit: 'L', movementType: 'WASTE' }),
        make({ itemId: 'lait', quantity: 20, unit: 'L', movementType: 'PURCHASE_RECEIPT' }),
      ],
      ingredientsOf,
      itemOf,
    );
    expect(rows.find((r) => r.itemId === 'lait')!.actual).toBe(0);
  });

  it('ne raconte rien sur un produit vendu sans recette', () => {
    const rows = consumptionVariance(new Map([['inconnu', 40]]), [], ingredientsOf, itemOf);
    expect(rows).toEqual([]);
  });

  it("classe l'écart le plus significatif en premier, en proportion", () => {
    const rows = consumptionVariance(
      new Map([['latte', 10]]),
      [
        make({ itemId: 'lait', quantity: -1.9, unit: 'L' }),
        make({ itemId: 'cafe', quantity: -500, unit: 'g' }),
      ],
      ingredientsOf,
      itemOf,
    );
    /* Café : 0,5 kg sortis pour 0,2 prévus, soit 150 % d'écart. Le gobelet en
       montre 100 % et le lait 6 % — l'ordre suit la gravité, pas l'unité. */
    expect(rows.map((r) => r.itemId)).toEqual(['cafe', 'gobelet', 'lait']);
  });
});


/**
 * Les sous-unités sont un confort de saisie, pas une donnée. Le milligramme
 * n'existe qu'à l'écran : ce qui part en base est toujours l'une des neuf
 * unités que PostgreSQL connaît, donc aucune migration n'est nécessaire.
 */
describe('sous-unités — saisir en mg, enregistrer en kg', () => {
  it('propose les sous-unités de la famille, la plus grande en tête', () => {
    expect(subUnitsOf('kg')).toEqual(['kg', 'g', 'mg']);
    expect(subUnitsOf('L')).toEqual(['L', 'mL']);
  });

  it('ne mélange jamais masse et volume', () => {
    expect(subUnitsOf('L')).not.toContain('g');
    expect(subUnitsOf('kg')).not.toContain('mL');
  });

  it('convertit la saisie vers l\'unité de l\'article', () => {
    /* 5 mL saisis sur un article compté en litres. */
    expect(convert(5, 'mL', 'L')).toBeCloseTo(0.005, 9);
    /* 1500 mg sur un article compté en kilos. */
    expect(convert(1500, 'mg', 'kg')).toBeCloseTo(0.0015, 9);
  });

  it('relit la quantité stockée dans la sous-unité où on l\'a saisie', () => {
    expect(formatDose(0.005, 'L')).toBe('5 mL');
    expect(formatDose(0.0015, 'kg')).toBe('1,5 g');
    /* Au-dessus de l'unité, on ne descend pas inutilement. */
    expect(formatDose(2.5, 'kg')).toBe('2,5 kg');
  });

  it('garde les unités de comptage telles quelles', () => {
    expect(formatDose(3, 'unite')).toBe('3 unité');
  });
});


/**
 * `recipe_ingredients.quantity` est un `numeric(14,4)` contraint `> 0`.
 * Une dose ramenée à une unité trop grande y tombe à zéro et la ligne est
 * refusée — le genre de refus qui ne se voit qu'en production.
 */
describe('précision — une dose fine doit survivre à l\'enregistrement', () => {
  const FOUR_DECIMALS = (n: number) => Math.round(n * 10_000) / 10_000;

  it('enregistre les milligrammes en grammes, pas en kilos', () => {
    expect(storageUnit('mg')).toBe('g');
  });

  it('garde telle quelle une unité que la base connaît déjà', () => {
    for (const u of ['kg', 'g', 'L', 'mL', 'unite'] as const) {
      expect(storageUnit(u)).toBe(u);
    }
  });

  it('ne réduit jamais une dose à zéro à quatre décimales', () => {
    /* Le cas qui cassait : 1 mg sur un article compté en kilos. */
    expect(FOUR_DECIMALS(convert(1, 'mg', 'kg'))).toBe(0);
    /* Replié sur le gramme, il reste écrivable — et strictement positif. */
    const stored = convert(1, 'mg', storageUnit('mg'));
    expect(FOUR_DECIMALS(stored)).toBeGreaterThan(0);
    expect(FOUR_DECIMALS(stored)).toBe(0.001);
  });

  it('reste comparable au stock de l\'article, quelle que soit l\'unité', () => {
    /* 1500 mg stockés en grammes valent bien 0,0015 kg de l'article. */
    const stored = convert(1500, 'mg', storageUnit('mg'));
    expect(convert(stored, storageUnit('mg'), 'kg')).toBeCloseTo(0.0015, 9);
  });
});


/**
 * Ce qu'un lot a consommé — le constat d'abord, la recette ensuite.
 *
 * C'est ici que se joue le déblocage : un établissement qui ouvre déclare ce
 * qu'il a préparé sans avoir de recette juste. Sans cette règle, pas de
 * production ; sans production, pas de produit fini ; sans produit fini, pas
 * de vente. La règle doit aussi tenir à l'identique côté serveur
 * (`complete_batch`), sinon les deux projections divergent sur le même fait.
 */
describe("ce qu'un lot a consommé", () => {
  const RECETTE = [
    { itemId: 'lait', quantity: 180, unit: 'mL' as const },
    { itemId: 'gobelet', quantity: 1, unit: 'unite' as const },
  ];

  it('multiplie la recette par la quantité produite — elle dose une unité', () => {
    const lines = consumedBy(40, undefined, RECETTE);
    expect(lines).toEqual([
      { itemId: 'lait', quantity: 7200, unit: 'mL' },
      { itemId: 'gobelet', quantity: 40, unit: 'unite' },
    ]);
  });

  it("ne multiplie PAS le constat : il vaut déjà pour tout le lot", () => {
    const declare = [{ itemId: 'lait', quantity: 2, unit: 'L' as const }];
    /* Le multiplier sortirait 80 L de lait pour 40 cafés. */
    expect(consumedBy(40, declare, RECETTE)).toEqual([{ itemId: 'lait', quantity: 2, unit: 'L' }]);
  });

  it('laisse le constat primer sur la recette, jusque dans les articles cités', () => {
    const declare = [{ itemId: 'cafe', quantity: 0.5, unit: 'kg' as const }];
    const lines = consumedBy(10, declare, RECETTE);
    expect(lines.map((l) => l.itemId)).toEqual(['cafe']);
  });

  it('retombe sur la recette quand le constat ne dit rien de chiffré', () => {
    const vide = [{ itemId: 'lait', quantity: 0, unit: 'L' as const }];
    expect(consumedBy(2, vide, RECETTE)).toHaveLength(2);
  });

  it("ne consomme rien quand il n'y a ni recette ni constat", () => {
    /* Le lot déclaré sans recette : il produit du stock sans en consommer.
       C'est incomplet, pas faux — le comptage du soir le rattrape. */
    expect(consumedBy(40, undefined, undefined)).toEqual([]);
    expect(consumedBy(40, [], [])).toEqual([]);
  });
});


/**
 * La recette que le terrain a déjà écrite.
 *
 * C'est la rampe entre les deux régimes : sans elle, le suivi simple serait un
 * cul-de-sac confortable, et le seul chemin vers la précision serait une
 * soirée de saisie.
 */
describe('la recette proposée par les lots', () => {
  const batch = (id: string, produced: number) => ({
    id, code: id, itemId: 'cafe', recipeVersionId: null, preparerId: 'u',
    locationId: 'l', plannedQuantity: produced, producedQuantity: produced,
    lossQuantity: 0, startedAt: '2026-08-17T07:00:00.000Z',
    completedAt: '2026-08-17T07:30:00.000Z',
    actor: { userId: 'u', userName: 'B', post: 'OWNER', at: '2026-08-17T07:00:00.000Z' },
  }) as unknown as Parameters<typeof observedRecipe>[1][number];

  const conso = (batchId: string, itemId: string, quantity: number, unit: 'L' | 'unite') => ({
    id: `${batchId}-${itemId}`, organizationId: 'o', siteId: 's', locationId: 'l',
    itemId, quantity: -quantity, unit, movementType: 'PRODUCTION_CONSUMPTION',
    referenceType: 'ProductionBatch', referenceId: batchId, userId: 'u', deviceId: 'd',
    createdAt: '2026-08-17T07:30:00.000Z',
    actor: { userId: 'u', userName: 'B', post: 'OWNER', at: '2026-08-17T07:30:00.000Z' },
  }) as unknown as StockMovement;

  it('moyenne la dose par unité produite, sur plusieurs lots', () => {
    const batches = [batch('b1', 10), batch('b2', 20), batch('b3', 5)];
    const movements = [
      conso('b1', 'lait', 2, 'L'),    // 0,2 L par unité
      conso('b2', 'lait', 4, 'L'),    // 0,2
      conso('b3', 'lait', 1, 'L'),    // 0,2
    ];
    const observed = observedRecipe('cafe', batches, movements)!;
    expect(observed.batches).toBe(3);
    expect(observed.produced).toBe(35);
    expect(observed.doses[0].quantity).toBeCloseTo(0.2, 4);
    /* Trois lots identiques : rien ne diverge, la dose peut être figée. */
    expect(observed.doses[0].spread).toBe(0);
  });

  it('signale un dosage irrégulier au lieu de le lisser', () => {
    const batches = [batch('b1', 10), batch('b2', 10), batch('b3', 10)];
    const movements = [
      conso('b1', 'lait', 1, 'L'),
      conso('b2', 'lait', 3, 'L'),
      conso('b3', 'lait', 2, 'L'),
    ];
    const observed = observedRecipe('cafe', batches, movements)!;
    expect(observed.doses[0].spread).toBeGreaterThan(0.3);
  });

  it("ignore les lots muets au lieu de les compter pour zéro", () => {
    /* Le piège : inclure un lot sans constat diviserait la dose par le nombre
       de lots muets — une recette deux fois trop légère, proposée avec
       l'aplomb d'une mesure. */
    const batches = [batch('b1', 10), batch('b2', 10), batch('b3', 10), batch('b4', 10)];
    const movements = [
      conso('b1', 'lait', 2, 'L'),
      conso('b2', 'lait', 2, 'L'),
      conso('b3', 'lait', 2, 'L'),
      // b4 : personne n'a noté ce qui est sorti.
    ];
    const observed = observedRecipe('cafe', batches, movements)!;
    expect(observed.batches).toBe(3);
    expect(observed.doses[0].quantity).toBeCloseTo(0.2, 4);
  });

  it('ne propose rien tant qu\'il n\'y a pas assez de lots', () => {
    const batches = [batch('b1', 10), batch('b2', 10)];
    const movements = [conso('b1', 'lait', 2, 'L'), conso('b2', 'lait', 2, 'L')];
    expect(observedRecipe('cafe', batches, movements)).toBeNull();
    /* Le seuil se règle : deux lots suffisent parfois à ouvrir la discussion. */
    expect(observedRecipe('cafe', batches, movements, 2)).not.toBeNull();
  });

  it('ne propose rien quand aucun lot n\'a noté de sortie', () => {
    const batches = [batch('b1', 10), batch('b2', 10), batch('b3', 10)];
    expect(observedRecipe('cafe', batches, [])).toBeNull();
  });
});
