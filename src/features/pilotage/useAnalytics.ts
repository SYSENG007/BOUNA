import { useMemo } from 'react';
import { useBuna, LOCATIONS, RECIPES, RECIPE_VERSIONS, SITE, SUPPLIERS } from '../../store/BunaStore';
import type { AnalyticsInput } from '../../domain/analytics';
import type { CashFlowInput } from '../../domain/cashflow';

/**
 * Assemble l'entrée des modules analytiques depuis l'état du magasin.
 *
 * Ces modules étaient écrits, testés, et importés par aucun écran : chaque
 * tableau de bord recalculait ses agrégats à la main, avec des définitions qui
 * divergeaient déjà. Ce hook est le point de branchement unique — désormais
 * « marge nette » veut dire la même chose partout.
 */
export function useAnalyticsInput(): AnalyticsInput {
  const { state } = useBuna();
  return useMemo(
    () => ({
      items: state.items,
      sales: state.sales,
      // RULE-002 : ce sont des mouvements qui entrent, jamais un niveau.
      movements: state.movements,
      expenses: state.expenses,
      purchases: state.purchases,
      waste: state.waste,
      recipes: RECIPES,
      recipeVersions: RECIPE_VERSIONS,
      locations: LOCATIONS,
      sites: [SITE],
      suppliers: SUPPLIERS,
    }),
    [state.items, state.sales, state.movements, state.expenses, state.purchases, state.waste],
  );
}

/**
 * Entrée de trésorerie.
 *
 * Le solde d'ouverture est celui du tiroir au début du shift : c'est le seul
 * point de départ réel dont l'application dispose. Les sorties se lisent dans
 * les dépenses uniquement — une réception crée déjà sa dépense, compter aussi
 * les achats doublerait chaque paiement.
 */
export function useCashFlowInput(): CashFlowInput {
  const { state } = useBuna();
  return useMemo(
    () => ({
      sales: state.sales,
      expenses: state.expenses,
      openingBalance: state.cashSession.openingCash,
    }),
    [state.sales, state.expenses, state.cashSession.openingCash],
  );
}
