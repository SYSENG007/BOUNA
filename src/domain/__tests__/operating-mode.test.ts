import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OPERATING_MODE, OPERATING_MODES, OPERATING_MODE_SPECS, policyOf,
} from '../operating-mode';
import { evaluateRules } from '../rules';
import type { Item } from '../types';

/**
 * Le régime décide de ce que l'application EXIGE, jamais de ce qu'elle
 * enregistre. Ces tests tiennent la promesse : un seul endroit décide, les
 * écrans ne font que lire.
 */
describe("régime d'exploitation", () => {
  it('démarre en suivi simple', () => {
    /* Un établissement qui installe l'application n'a pas encore de recettes
       justes. Démarrer en suivi précis lui présenterait l'impasse — pas de
       recette, pas de production, pas de vente — dès le premier jour. */
    expect(DEFAULT_OPERATING_MODE).toBe('SIMPLE');
  });

  it("n'exige jamais de recette pour déclarer une préparation", () => {
    /* Même en suivi précis : la recette sert à DÉDUIRE, elle ne conditionne
       plus le droit de déclarer ce qu'on a réellement fabriqué. */
    for (const mode of OPERATING_MODES) {
      expect(policyOf(mode).recipeRequiredToProduce, mode).toBe(false);
    }
  });

  it('ne bloque la vente que là où le stock est un compte, pas une déclaration', () => {
    expect(policyOf('SIMPLE').saleBlockedWithoutStock).toBe(false);
    expect(policyOf('PRECIS').saleBlockedWithoutStock).toBe(true);
  });

  it('fait porter la contrepartie au régime qui en a besoin', () => {
    /* Sans comptage du soir, le suivi simple ne mesure rien : il ne fait que
       ne plus bloquer. C'est sa contrepartie, elle n'est pas négociable. */
    expect(policyOf('SIMPLE').countFinishedGoodsAtClosing).toBe(true);
  });

  it("n'annonce une marge par produit que quand elle a un sens", () => {
    expect(policyOf('SIMPLE').productMarginKnown).toBe(false);
    expect(policyOf('SIMPLE').costMethod).toBe('PERIOD');
    expect(policyOf('PRECIS').productMarginKnown).toBe(true);
    expect(policyOf('PRECIS').costMethod).toBe('RECIPE');
  });

  it('nomme ce que chaque régime ne saura pas dire', () => {
    /* Un choix dont on cache la contrepartie n'est pas un choix. */
    expect(OPERATING_MODE_SPECS.SIMPLE.silentOn.length).toBeGreaterThan(0);
    for (const mode of OPERATING_MODES) {
      expect(OPERATING_MODE_SPECS[mode].requires.length, mode).toBeGreaterThan(0);
      expect(OPERATING_MODE_SPECS[mode].derives.length, mode).toBeGreaterThan(0);
    }
  });
});

/**
 * Le bruit d'alerte est le risque concret du suivi simple : le stock des
 * produits finis y passe sous zéro tous les jours, par construction.
 */
describe('alertes de rupture selon le régime', () => {
  const finished: Item = {
    id: 'cafe', name: 'Café Touba', kind: 'FINISHED', unit: 'unite',
    minimumStock: 5, targetStock: 20, price: 500,
  };
  const matiere: Item = {
    id: 'lait', name: 'Lait', kind: 'RAW_MATERIAL', unit: 'L',
    minimumStock: 5, targetStock: 20,
  };

  const evaluate = (finishedGoodsAlerts: boolean) =>
    evaluateRules(
      {
        items: [finished, matiere],
        stockOf: () => -3,
        soldToday: new Map(),
        cashVariance: null,
        wasteCostToday: 0,
        finishedGoodsAlerts,
      },
      {},
    ).notifications;

  it('se tait sur les produits finis en suivi simple', () => {
    const titles = evaluate(false).map((n) => n.title);
    expect(titles.some((t) => t.includes('Café Touba'))).toBe(false);
  });

  it('continue d\'alerter sur les matières, qui se comptent pour de bon', () => {
    const titles = evaluate(false).map((n) => n.title);
    expect(titles.some((t) => t.includes('Lait'))).toBe(true);
  });

  it('alerte sur les deux en suivi précis', () => {
    const titles = evaluate(true).map((n) => n.title);
    expect(titles.some((t) => t.includes('Café Touba'))).toBe(true);
    expect(titles.some((t) => t.includes('Lait'))).toBe(true);
  });
});
