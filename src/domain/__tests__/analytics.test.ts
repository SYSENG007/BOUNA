import { describe, expect, it } from 'vitest';
import {
  hourlyProfitability, lastPeriods, periodOf, periodReport, periodSeries, periodTotals,
  previousPeriod, productMargins, recipeUnitCost, siteProfitability, supplierAnalytics,
  variationPct, type AnalyticsInput, type Measured,
} from '../analytics';
import type {
  Expense, Item, Purchase, Recipe, RecipeVersion, Sale, SaleLine, Site, StockLocation,
  StockMovement, WasteEvent,
} from '../types';

/**
 * Cas de terrain, pas cas d'école : une semaine à cheval sur deux mois, une
 * journée jamais saisie, un fournisseur qui livre moins que commandé, un
 * produit vendu à perte, une comparaison à une période qui n'existe pas.
 */

/** Déplie une mesure attendue. Un test ne doit jamais passer sur un trou. */
function must<T>(m: Measured<T>): T {
  if (!m.hasData) throw new Error('mesure absente alors qu’elle était attendue');
  return m.value;
}

/* ------------------------------------------------------------- Catalogue */

const CAFE: Item = { id: 'it-cafe', name: 'Café en grains', kind: 'RAW_MATERIAL', unit: 'kg', weightedAvgCost: 4500 };
const LAIT: Item = { id: 'it-lait', name: 'Lait entier', kind: 'RAW_MATERIAL', unit: 'L', weightedAvgCost: 1100 };
const GOBELET: Item = { id: 'it-gobelet', name: 'Gobelets', kind: 'PACKAGING', unit: 'unite', weightedAvgCost: 28 };
const VANILLA: Item = { id: 'it-vanilla', name: 'Vanilla Iced Coffee', kind: 'FINISHED', unit: 'unite', price: 2500, weightedAvgCost: 1120 };
const TONIC: Item = { id: 'it-tonic', name: 'Espresso Tonic', kind: 'FINISHED', unit: 'unite', price: 3000, weightedAvgCost: 1290 };

const ITEMS = [CAFE, LAIT, GOBELET, VANILLA, TONIC];

const LOCATIONS: StockLocation[] = [
  { id: 'loc-pos-a', siteId: 'site-auchan', name: 'Comptoir Auchan', type: 'POS' },
  { id: 'loc-pos-b', siteId: 'site-plateau', name: 'Comptoir Plateau', type: 'POS' },
  { id: 'loc-central', siteId: 'site-auchan', name: 'Stock principal', type: 'CENTRAL' },
];

const SITES: Site[] = [
  { id: 'site-auchan', organizationId: 'org', name: 'Coffee Bar Auchan' },
  { id: 'site-plateau', organizationId: 'org', name: 'Coffee Bar Plateau' },
  { id: 'site-thies', organizationId: 'org', name: 'Coffee Bar Thiès' },
];

/* --------------------------------------------------------------- Fabriques */

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${++seq}`;

/** `[itemId, quantité, prix unitaire, coût unitaire figé]`. */
type LineTuple = [string, number, number, number];

function sale(createdAt: string, lines: LineTuple[], over: Partial<Sale> = {}): Sale {
  const saleLines: SaleLine[] = lines.map(([itemId, quantity, unitPrice, unitCost]) => ({
    itemId, name: ITEMS.find((i) => i.id === itemId)?.name ?? itemId, quantity, unitPrice, unitCost,
  }));
  return {
    id: nextId('sale'),
    number: seq,
    siteId: 'site-auchan',
    locationId: 'loc-pos-a',
    cashSessionId: null,
    sellerId: 'u-aicha',
    lines: saleLines,
    total: saleLines.reduce((s, l) => s + l.quantity * l.unitPrice, 0),
    cogs: saleLines.reduce((s, l) => s + l.quantity * l.unitCost, 0),
    paymentMethod: 'CASH',
    amountReceived: 0,
    status: 'COMPLETED',
    createdAt,
    ...over,
  };
}

function mv(over: Partial<StockMovement> & { createdAt: string }): StockMovement {
  return {
    id: nextId('mv'),
    organizationId: 'org',
    siteId: 'site-auchan',
    locationId: 'loc-pos-a',
    itemId: 'it-vanilla',
    quantity: -1,
    unit: 'unite',
    movementType: 'SALE',
    referenceType: 'Sale',
    referenceId: 'r',
    userId: 'u-aicha',
    deviceId: 'd',
    ...over,
  };
}

function expense(createdAt: string, amount: number, category: Expense['category']): Expense {
  return {
    id: nextId('ex'), amount, category, description: category,
    paymentMethod: 'CASH', userId: 'u-fatou', createdAt,
  };
}

function waste(createdAt: string, cost: number, locationId = 'loc-pos-a'): WasteEvent {
  return {
    id: nextId('w'), itemId: 'it-vanilla', locationId, quantity: 1, unit: 'unite',
    cost, reason: 'INVENDU', userId: 'u-aicha', createdAt,
  };
}

function input(over: Partial<AnalyticsInput> = {}): AnalyticsInput {
  return { items: ITEMS, sales: [], movements: [], locations: LOCATIONS, sites: SITES, ...over };
}

/* ==================================================== Découpage des périodes */

describe('Périodes — le calendrier, pas une durée glissante', () => {
  it('garde entière une semaine à cheval sur deux mois', () => {
    // Lundi 31 août 2026 → dimanche 6 septembre.
    const week = periodOf('2026-09-02T10:00:00Z', 'WEEK');
    expect(week.key).toBe('S:2026-08-31');
    expect(new Date(week.start).toISOString()).toBe('2026-08-31T00:00:00.000Z');
    expect(new Date(week.end).toISOString()).toBe('2026-09-07T00:00:00.000Z');
    expect(week.label).toBe('31 août – 6 septembre 2026');
  });

  it('additionne les deux mois dans la semaine, et les sépare dans les mois', () => {
    const state = input({
      sales: [
        sale('2026-08-31T09:00:00Z', [['it-vanilla', 4, 2500, 1000]]), // 10 000 en août
        sale('2026-09-02T09:00:00Z', [['it-vanilla', 2, 2500, 1000]]), // 5 000 en septembre
      ],
    });

    const week = must(periodTotals(state, periodOf('2026-09-02T10:00:00Z', 'WEEK')));
    expect(week.revenue).toBe(15000);

    const aout = must(periodTotals(state, periodOf('2026-08-15T10:00:00Z', 'MONTH')));
    const septembre = must(periodTotals(state, periodOf('2026-09-15T10:00:00Z', 'MONTH')));
    expect(aout.revenue).toBe(10000);
    expect(septembre.revenue).toBe(5000);
  });

  it('recule d’un cran de calendrier, jamais d’une durée fixe', () => {
    const mars = periodOf('2026-03-15T00:00:00Z', 'MONTH');
    const fevrier = previousPeriod(mars);
    expect(fevrier.key).toBe('M:2026-02-01');
    // 28 jours : soustraire la durée de mars serait retombé au 13 février.
    expect((fevrier.end - fevrier.start) / 86_400_000).toBe(28);

    const semaine = periodOf('2026-09-02T10:00:00Z', 'WEEK');
    expect(previousPeriod(semaine).key).toBe('S:2026-08-24');
  });

  it('exclut la borne de fin : minuit appartient à la période suivante', () => {
    const jour = periodOf('2026-08-13T12:00:00Z', 'DAY');
    const state = input({ sales: [sale('2026-08-14T00:00:00Z', [['it-vanilla', 1, 2500, 1000]])] });
    expect(periodTotals(state, jour).hasData).toBe(false);
  });

  it('respecte le fuseau d’exploitation déclaré', () => {
    // 23 h 30 UTC un 12 août, c’est déjà le 13 pour un comptoir à UTC+1.
    const state = input({ sales: [sale('2026-08-12T23:30:00Z', [['it-vanilla', 1, 2500, 1000]])] });
    const jour = periodOf('2026-08-13T10:00:00Z', 'DAY', { utcOffsetMinutes: 60 });
    expect(jour.key).toBe('J:2026-08-13');
    expect(must(periodTotals(state, jour)).revenue).toBe(2500);
    // Sans le décalage, la même vente appartient à la veille.
    expect(periodTotals(state, periodOf('2026-08-13T10:00:00Z', 'DAY')).hasData).toBe(false);
  });

  it('déroule les dernières périodes de la plus ancienne à la plus récente', () => {
    const keys = lastPeriods('2026-08-13T10:00:00Z', 'DAY', 3).map((p) => p.key);
    expect(keys).toEqual(['J:2026-08-11', 'J:2026-08-12', 'J:2026-08-13']);
  });
});

/* ====================================== « Pas de données » n’est pas « zéro » */

/**
 * Trois journées : le 11 n’a jamais été saisi, le 12 a été ouvert sans vendre,
 * le 13 a vendu. C’est le jeu de base de la plupart des tests suivants.
 */
function troisJours(): AnalyticsInput {
  return input({
    sales: [
      sale('2026-08-13T08:30:00Z', [['it-vanilla', 4, 2500, 1000]]),
      sale('2026-08-13T08:45:00Z', [['it-vanilla', 1, 2500, 1000]]),
      sale('2026-08-13T17:10:00Z', [['it-tonic', 1, 3000, 1290]]),
    ],
    movements: [
      mv({ createdAt: '2026-08-13T06:00:00Z', movementType: 'PURCHASE_RECEIPT', itemId: 'it-cafe', quantity: 5, unit: 'kg', locationId: 'loc-central' }),
      mv({ createdAt: '2026-08-13T08:30:00Z', quantity: -4 }),
      mv({ createdAt: '2026-08-13T17:10:00Z', itemId: 'it-tonic' }),
      // Le 12 : le comptoir a ouvert, corrigé un stock, et n’a rien vendu.
      mv({ createdAt: '2026-08-12T09:00:00Z', movementType: 'ADJUSTMENT', quantity: -2 }),
    ],
    expenses: [
      expense('2026-08-13T06:00:00Z', 22000, 'MATIERE'),
      expense('2026-08-13T17:00:00Z', 18000, 'ENERGIE'),
      expense('2026-08-12T09:00:00Z', 5000, 'ENERGIE'),
    ],
    waste: [waste('2026-08-13T17:30:00Z', 1200)],
  });
}

describe('Une période sans données n’est pas une période à zéro', () => {
  it('ne rend rien pour une journée jamais saisie', () => {
    const totals = periodTotals(troisJours(), periodOf('2026-08-11T12:00:00Z', 'DAY'));
    expect(totals.hasData).toBe(false);
    expect(totals.value).toBeNull();
  });

  it('rend un vrai zéro pour une journée ouverte sans vente', () => {
    const totals = must(periodTotals(troisJours(), periodOf('2026-08-12T12:00:00Z', 'DAY')));
    expect(totals.revenue).toBe(0);
    expect(totals.orders).toBe(0);
    // Aucune commande : la moyenne n’existe pas, elle ne vaut pas 0.
    expect(totals.averageBasket).toBeNull();
    expect(totals.marginPct).toBeNull();
    // La journée a quand même coûté 5 000 FCFA d’électricité.
    expect(totals.netMargin).toBe(-5000);
  });

  it('agrège la journée vendue sans confondre marchandise et charges', () => {
    const totals = must(periodTotals(troisJours(), periodOf('2026-08-13T12:00:00Z', 'DAY')));
    expect(totals.revenue).toBe(15500);
    expect(totals.orders).toBe(3);
    expect(totals.unitsSold).toBe(6);
    expect(totals.averageBasket).toBe(5167);
    expect(totals.cogs).toBe(6290);
    expect(totals.grossMargin).toBe(9210);
    expect(totals.marginPct).toBe(59.4);
    // 22 000 FCFA d’achat de matière sont déjà dans le COGS : les compter en
    // charges les compterait deux fois.
    expect(totals.operatingExpenses).toBe(18000);
    expect(totals.wasteCost).toBe(1200);
    expect(totals.netMargin).toBe(-9990);
  });

  it('ne compte pas une vente annulée dans le chiffre d’affaires', () => {
    const state = input({
      sales: [
        sale('2026-08-13T09:00:00Z', [['it-vanilla', 2, 2500, 1000]], { status: 'VOIDED', voidReason: 'erreur de saisie' }),
      ],
    });
    const totals = must(periodTotals(state, periodOf('2026-08-13T12:00:00Z', 'DAY')));
    // La journée existe — quelqu’un a travaillé — mais elle n’a rien vendu.
    expect(totals.revenue).toBe(0);
    expect(totals.orders).toBe(0);
  });

  it('laisse les trous visibles dans une série', () => {
    const serie = periodSeries(troisJours(), '2026-08-13T12:00:00Z', 'DAY', 3);
    expect(serie.map((p) => p.totals.hasData)).toEqual([false, true, true]);
    expect(serie.map((p) => p.period.key)).toEqual(['J:2026-08-11', 'J:2026-08-12', 'J:2026-08-13']);
  });
});

/* ============================================ Comparaison période précédente */

describe('Comparaison à la période précédente', () => {
  it('ne compare pas à une période qui n’a jamais existé', () => {
    // Le 12 est renseigné, le 11 ne l’est pas.
    const report = periodReport(troisJours(), '2026-08-12T12:00:00Z', 'DAY');
    expect(report.current.hasData).toBe(true);
    expect(report.previous.key).toBe('J:2026-08-11');
    expect(report.comparison.hasData).toBe(false);
    expect(report.change.hasData).toBe(false);
  });

  it('refuse une variation à partir de zéro plutôt que d’inventer +100 %', () => {
    const report = periodReport(troisJours(), '2026-08-13T12:00:00Z', 'DAY');
    expect(report.comparison.hasData).toBe(true);
    const change = must(report.change);
    // La veille a fait 0 FCFA : la progression n’est pas chiffrable.
    expect(change.revenuePct).toBeNull();
    expect(change.averageBasketPct).toBeNull();
  });

  it('chiffre la variation quand les deux périodes existent', () => {
    const state = input({
      sales: [
        sale('2026-08-12T09:00:00Z', [['it-vanilla', 4, 2500, 1000]]), // 10 000
        sale('2026-08-13T09:00:00Z', [['it-vanilla', 5, 2500, 1000]]), // 12 500
      ],
    });
    const change = must(periodReport(state, '2026-08-13T12:00:00Z', 'DAY').change);
    expect(change.revenuePct).toBe(25);
    expect(change.ordersPct).toBe(0);
    expect(change.unitsSoldPct).toBe(25);
  });

  it('mesure une baisse depuis une perte sans changer de signe', () => {
    expect(variationPct(-2000, -1000)).toBe(-100);
    expect(variationPct(500, 0)).toBeNull();
  });
});

/* ======================================================= Rentabilité horaire */

describe('Rentabilité par heure — honnête sur les coûts imputés', () => {
  const jour = periodOf('2026-08-13T12:00:00Z', 'DAY');

  it('n’impute pas une charge à l’heure où elle a été payée', () => {
    const report = must(hourlyProfitability(troisJours(), jour));
    // Trois heures vécues : 6 h (réception), 8 h (rush), 17 h (fin de service).
    expect(report.hours.map((h) => h.hour)).toEqual([6, 8, 17]);
    expect(report.openHours).toBe(3);
    expect(report.allocation).toBe('PART_EGALE');
    // L’électricité a été rechargée à 17 h ; elle ne rend pas 17 h coupable.
    expect(report.hours.map((h) => h.allocatedCost)).toEqual([6000, 6000, 6000]);
  });

  it('ne compte jamais la marchandise deux fois et le dit', () => {
    const report = must(hourlyProfitability(troisJours(), jour));
    expect(report.allocatedTotal).toBe(18000);
    expect(report.excludedFromAllocation).toBe(22000);
  });

  it('répartit au franc près : la somme des parts vaut le total', () => {
    const report = must(hourlyProfitability(troisJours(), jour, { allocation: 'PRORATA_CA' }));
    expect(report.hours.reduce((s, h) => s + h.allocatedCost, 0)).toBe(18000);
    // 12 500 / 15 500 et 3 000 / 15 500 ne tombent pas rond : le reste va à la
    // plus forte décimale, il ne s’évapore pas.
    expect(report.hours.map((h) => h.allocatedCost)).toEqual([0, 14516, 3484]);
  });

  it('désigne les heures qui coûtent plus qu’elles ne rapportent', () => {
    const report = must(hourlyProfitability(troisJours(), jour));
    const [six, huit, dixsept] = report.hours;

    expect(huit.revenue).toBe(12500);
    expect(huit.orders).toBe(2);
    expect(huit.grossMargin).toBe(7500);
    expect(huit.netMargin).toBe(1500);
    expect(huit.coversItsCost).toBe(true);

    expect(six.netMargin).toBe(-6000); // une heure de réception ne vend rien
    expect(dixsept.wasteCost).toBe(1200);
    expect(dixsept.netMargin).toBe(-5490); // 1 710 − 1 200 − 6 000

    expect(report.lossMakingHours.map((h) => h.hour)).toEqual([6, 17]);
  });

  it('change de verdict selon la base d’imputation — donc elle est rendue', () => {
    const egale = must(hourlyProfitability(troisJours(), jour, { allocation: 'PART_EGALE' }));
    const prorata = must(hourlyProfitability(troisJours(), jour, { allocation: 'PRORATA_CA' }));

    const sixEgale = egale.hours.find((h) => h.hour === 6)!;
    const sixProrata = prorata.hours.find((h) => h.hour === 6)!;
    // Au prorata du CA, une heure sans vente paraît gratuite : c’est
    // précisément pourquoi elle ne peut pas décider d’un horaire d’ouverture.
    expect(sixEgale.coversItsCost).toBe(false);
    expect(sixProrata.coversItsCost).toBe(true);
    expect(prorata.allocation).toBe('PRORATA_CA');
  });

  it('ne rend rien pour une journée jamais saisie', () => {
    expect(hourlyProfitability(troisJours(), periodOf('2026-08-11T12:00:00Z', 'DAY')).hasData).toBe(false);
  });
});

/* ========================================================= Rentabilité site */

describe('Rentabilité par site — comparable d’un site à l’autre', () => {
  const jour = periodOf('2026-08-13T12:00:00Z', 'DAY');

  function deuxSites(): AnalyticsInput {
    return input({
      sales: [
        sale('2026-08-13T09:00:00Z', [['it-vanilla', 5, 2500, 1000]]), // Auchan 12 500
        sale('2026-08-13T11:00:00Z', [['it-vanilla', 3, 2500, 1000]]), // Auchan 7 500
        sale('2026-08-13T10:00:00Z', [['it-vanilla', 4, 2500, 1250]], {
          siteId: 'site-plateau', locationId: 'loc-pos-b',
        }), // Plateau 10 000
      ],
      expenses: [expense('2026-08-13T08:00:00Z', 15000, 'SALAIRE')],
    });
  }

  it('répartit les charges d’organisation au prorata du chiffre d’affaires', () => {
    const report = must(siteProfitability(deuxSites(), jour));
    expect(report.unattributedExpenses).toBe(15000);

    const auchan = report.sites.find((s) => s.siteId === 'site-auchan')!;
    const plateau = report.sites.find((s) => s.siteId === 'site-plateau')!;

    expect(auchan.name).toBe('Coffee Bar Auchan');
    expect(auchan.revenue).toBe(20000);
    expect(auchan.grossMargin).toBe(12000);
    expect(auchan.allocatedOverhead).toBe(10000);
    expect(auchan.netMargin).toBe(2000);
    expect(plateau.allocatedOverhead).toBe(5000);
    expect(plateau.netMargin).toBe(0);

    // Classement par marge nette : le site qui paie ses charges d’abord.
    expect(report.sites[0].siteId).toBe('site-auchan');
    expect(auchan.allocatedOverhead + plateau.allocatedOverhead).toBe(15000);
  });

  it('rend les sites comparables malgré leur taille', () => {
    const report = must(siteProfitability(deuxSites(), jour));
    const auchan = report.sites.find((s) => s.siteId === 'site-auchan')!;
    const plateau = report.sites.find((s) => s.siteId === 'site-plateau')!;
    expect(auchan.marginPct).toBe(60);
    expect(plateau.marginPct).toBe(50);
    expect(auchan.netMarginPerThousand).toBe(100); // 100 FCFA nets pour 1 000 vendus
    expect(plateau.netMarginPerThousand).toBe(0);
  });

  it('n’invente pas un site à zéro quand il n’a rien saisi', () => {
    const report = must(siteProfitability(deuxSites(), jour));
    expect(report.sites.map((s) => s.siteId)).not.toContain('site-thies');
    expect(report.sitesWithoutData).toEqual(['site-thies']);
  });

  it('rattache une dépense au site quand l’organisation sait le faire', () => {
    const report = must(siteProfitability(deuxSites(), jour, { expenseSiteOf: () => 'site-plateau' }));
    const plateau = report.sites.find((s) => s.siteId === 'site-plateau')!;
    expect(report.unattributedExpenses).toBe(0);
    expect(plateau.directExpenses).toBe(15000);
    expect(plateau.netMargin).toBe(-10000);
  });

  it('ne rend rien quand aucun site n’a vécu la période', () => {
    expect(siteProfitability(deuxSites(), periodOf('2026-08-11T12:00:00Z', 'DAY')).hasData).toBe(false);
  });
});

/* ==================================================== Analytique fournisseurs */

describe('Analytique fournisseurs', () => {
  function achat(over: Partial<Purchase> & Pick<Purchase, 'id' | 'supplierId' | 'createdAt'>): Purchase {
    const lines = over.lines ?? [];
    return {
      locationId: 'loc-central',
      lines,
      transportCost: 0,
      total: lines.reduce((s, l) => s + l.quantity * l.actualUnitPrice, 0),
      paymentMethod: 'CASH',
      receivedAt: null,
      ...over,
    };
  }

  function marche(): AnalyticsInput {
    return input({
      purchases: [
        achat({
          id: 'pu-1', supplierId: 'sup-cafe',
          createdAt: '2026-08-10T08:00:00Z', receivedAt: '2026-08-10T14:00:00Z',
          lines: [{ itemId: 'it-cafe', quantity: 5, unit: 'kg', actualUnitPrice: 4500 }],
        }),
        achat({
          id: 'pu-2', supplierId: 'sup-torref',
          createdAt: '2026-08-11T08:00:00Z', receivedAt: '2026-08-12T08:00:00Z',
          lines: [{ itemId: 'it-cafe', quantity: 4, unit: 'kg', actualUnitPrice: 4200 }],
        }),
        achat({
          id: 'pu-3', supplierId: 'sup-cafe', createdAt: '2026-08-12T08:00:00Z',
          lines: [{ itemId: 'it-cafe', quantity: 3, unit: 'kg', actualUnitPrice: 4800 }],
        }),
        achat({
          id: 'pu-4', supplierId: 'sup-laiterie', createdAt: '2026-08-12T09:00:00Z',
          lines: [{ itemId: 'it-lait', quantity: 20, unit: 'bouteille', actualUnitPrice: 1100 }],
        }),
      ],
      movements: [
        // Commandé 5 kg, reçu 4 : l’écart se lit dans les mouvements, pas dans
        // un champ « quantité reçue » qui n’existe pas.
        mv({ createdAt: '2026-08-10T14:00:00Z', movementType: 'PURCHASE_RECEIPT', referenceId: 'pu-1', itemId: 'it-cafe', quantity: 4, unit: 'kg', locationId: 'loc-central' }),
        mv({ createdAt: '2026-08-12T08:00:00Z', movementType: 'PURCHASE_RECEIPT', referenceId: 'pu-2', itemId: 'it-cafe', quantity: 4, unit: 'kg', locationId: 'loc-central' }),
      ],
      suppliers: [
        { id: 'sup-cafe', name: 'Torréfaction Dakar' },
        { id: 'sup-torref', name: 'Café du Fouta' },
        { id: 'sup-laiterie', name: 'Laiterie du Terroir' },
      ],
    });
  }

  it('mesure la fiabilité sur les mouvements, pas sur la promesse', () => {
    const report = must(supplierAnalytics(marche()));
    const cafe = report.suppliers.find((s) => s.supplierId === 'sup-cafe')!;
    const ligne = cafe.items.find((i) => i.itemId === 'it-cafe')!;

    expect(ligne.quantityOrdered).toBe(8);
    expect(must(ligne.quantityReceived)).toBe(4);
    // 4 reçus sur les 5 commandés ET réceptionnés ; la commande encore en
    // attente ne pèse pas sur le taux de service.
    expect(must(ligne.fillRatePct)).toBe(80);
    expect(must(cafe.fillRatePct)).toBe(80);
    expect(cafe.pendingDeliveries).toBe(1);
  });

  it('ne transforme pas une livraison en attente en livraison vide', () => {
    const report = must(supplierAnalytics(marche()));
    const laiterie = report.suppliers.find((s) => s.supplierId === 'sup-laiterie')!;
    const ligne = laiterie.items[0];
    expect(ligne.quantityReceived.hasData).toBe(false);
    expect(ligne.fillRatePct.hasData).toBe(false);
    expect(laiterie.fillRatePct.hasData).toBe(false);
    expect(laiterie.averageLeadTimeHours).toBeNull();
  });

  it('mesure le délai de livraison commande → réception', () => {
    const report = must(supplierAnalytics(marche()));
    expect(report.suppliers.find((s) => s.supplierId === 'sup-cafe')!.averageLeadTimeHours).toBe(6);
    expect(report.suppliers.find((s) => s.supplierId === 'sup-torref')!.averageLeadTimeHours).toBe(24);
  });

  it('suit le prix dans le temps et sort une tendance', () => {
    const report = must(supplierAnalytics(marche()));
    const ligne = report.suppliers
      .find((s) => s.supplierId === 'sup-cafe')!.items.find((i) => i.itemId === 'it-cafe')!;

    expect(ligne.firstUnitPrice).toBe(4500);
    expect(ligne.lastUnitPrice).toBe(4800);
    expect(ligne.priceTrendPct).toBe(6.7);
    // Moyenne pondérée par les quantités : (5 × 4 500 + 3 × 4 800) / 8.
    expect(ligne.averageUnitPrice).toBe(4613);
    // Points datés, triés — de quoi tracer une courbe par article.
    expect(report.observations.map((o) => o.unitPrice)).toEqual([4500, 4200, 4800, 1100]);
  });

  it('chiffre l’écart au meilleur fournisseur observé', () => {
    const report = must(supplierAnalytics(marche()));
    const cafe = report.comparison.find((c) => c.itemId === 'it-cafe')!;
    expect(cafe.bestSupplierId).toBe('sup-torref');
    expect(cafe.bestUnitPrice).toBe(4200);
    expect(cafe.unit).toBe('kg');

    const cher = cafe.rows.find((r) => r.supplierId === 'sup-cafe')!;
    expect(cher.gapAbsolute).toBe(413);
    expect(cher.gapPct).toBe(9.8);
    expect(cafe.potentialSaving).toBe(3304); // 413 FCFA × 8 kg achetés au prix fort
  });

  it('refuse de comparer des prix exprimés dans des unités inconvertibles', () => {
    const report = must(supplierAnalytics(marche()));
    // 1 100 FCFA la bouteille pour un article stocké en litres : le catalogue
    // ignore le contenu d’une bouteille, la comparaison serait un mensonge.
    const lait = report.suppliers.find((s) => s.supplierId === 'sup-laiterie')!.items[0];
    expect(lait.comparable).toBe(false);
    expect(lait.unit).toBe('bouteille');
    expect(report.comparison.some((c) => c.itemId === 'it-lait')).toBe(false);
  });

  it('ne rend rien quand la fenêtre ne contient aucun achat', () => {
    expect(supplierAnalytics(marche(), periodOf('2026-08-09T12:00:00Z', 'DAY')).hasData).toBe(false);
  });

  it('restreint l’analyse à la fenêtre demandée', () => {
    const report = must(supplierAnalytics(marche(), periodOf('2026-08-10T12:00:00Z', 'DAY')));
    expect(report.suppliers.map((s) => s.supplierId)).toEqual(['sup-cafe']);
    expect(report.suppliers[0].items[0].averageUnitPrice).toBe(4500);
  });
});

/* ======================================================== Marge par produit */

describe('Marge par produit, en coût moyen pondéré', () => {
  const jour = periodOf('2026-08-13T12:00:00Z', 'DAY');

  const RECIPE: Recipe = { id: 'rc-vanilla', itemId: 'it-vanilla', name: 'Vanilla', currentVersionId: 'rv-1' };
  const VERSION: RecipeVersion = {
    id: 'rv-1', recipeId: 'rc-vanilla', version: 1, frozen: true,
    ingredients: [
      { itemId: 'it-cafe', quantity: 200, unit: 'g' },  // 0,2 kg × 4 500 = 900
      { itemId: 'it-lait', quantity: 100, unit: 'mL' }, // 0,1 L × 1 100 = 110
    ],
  };

  function ventes(): AnalyticsInput {
    return input({
      sales: [
        sale('2026-08-13T09:00:00Z', [['it-vanilla', 2, 2500, 1000]]),
        sale('2026-08-13T11:00:00Z', [['it-vanilla', 3, 2500, 1200]]),
        // Espresso Tonic bradé à 1 000 FCFA alors qu’il coûte 1 290.
        sale('2026-08-13T15:00:00Z', [['it-tonic', 2, 1000, 1290]]),
      ],
      recipes: [RECIPE],
      recipeVersions: [VERSION],
    });
  }

  it('replie les coûts figés de chaque vente en coût moyen pondéré', () => {
    const margins = must(productMargins(ventes(), jour));
    const vanilla = margins.find((m) => m.itemId === 'it-vanilla')!;

    // (2 × 1 000 + 3 × 1 200) / 5 = 1 120 — la même règle qu’à la réception.
    expect(vanilla.averageUnitCost).toBe(1120);
    expect(vanilla.unitsSold).toBe(5);
    expect(vanilla.revenue).toBe(12500);
    expect(vanilla.cogs).toBe(5600);
    expect(vanilla.grossMargin).toBe(6900);
    expect(vanilla.marginPct).toBe(55.2);
    expect(vanilla.soldAtLoss).toBe(false);
  });

  it('nomme un produit vendu à perte au lieu de l’écraser dans un total', () => {
    const margins = must(productMargins(ventes(), jour));
    const tonic = margins.find((m) => m.itemId === 'it-tonic')!;
    expect(tonic.revenue).toBe(2000);
    expect(tonic.cogs).toBe(2580);
    expect(tonic.grossMargin).toBe(-580);
    expect(tonic.marginPct).toBe(-29);
    expect(tonic.soldAtLoss).toBe(true);
    // Classement par marge : la perte reste visible, en dernier.
    expect(margins[margins.length - 1].itemId).toBe('it-tonic');
  });

  it('compare le coût constaté au coût de la recette', () => {
    const margins = must(productMargins(ventes(), jour));
    const vanilla = margins.find((m) => m.itemId === 'it-vanilla')!;
    expect(vanilla.recipeUnitCost).toBe(1010);
    // 1 120 constatés contre 1 010 théoriques : 10,9 % de dérive à expliquer.
    expect(vanilla.costDriftPct).toBe(10.9);
    expect(vanilla.currentUnitCost).toBe(1120);
  });

  it('préfère ne rien dire à un coût de recette incomplet', () => {
    const items = new Map(ITEMS.map((i) => [i.id, i]));
    expect(recipeUnitCost(VERSION, items)).toBe(1010);

    // Une unité inconvertible (des « sachets » de café stocké en kg) rendrait
    // un coût partiel — donc flatteur. On rend `null`.
    const bancale: RecipeVersion = {
      ...VERSION, ingredients: [{ itemId: 'it-cafe', quantity: 2, unit: 'sachet' }],
    };
    expect(recipeUnitCost(bancale, items)).toBeNull();

    const inconnu: RecipeVersion = {
      ...VERSION, ingredients: [{ itemId: 'it-fantome', quantity: 1, unit: 'unite' }],
    };
    expect(recipeUnitCost(inconnu, items)).toBeNull();
  });

  it('ne rend rien pour une journée jamais saisie', () => {
    expect(productMargins(ventes(), periodOf('2026-08-11T12:00:00Z', 'DAY')).hasData).toBe(false);
  });
});
