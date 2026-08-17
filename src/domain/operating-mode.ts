/**
 * Le régime d'exploitation — ce que l'application EXIGE, et ce qu'elle OSE
 * déduire.
 *
 * Il ne change pas ce que le système enregistre. Mêmes événements, mêmes
 * mouvements, mêmes projections : le stock reste une projection (RULE-002),
 * l'événement reste l'unité, l'idempotence reste sur `event.id`. Basculer d'un
 * régime à l'autre ne recalcule rien et ne réécrit aucun passé — le passé est
 * simplement moins détaillé, comme un carnet dont les premières pages sont
 * plus succinctes.
 *
 * Ce qui bouge, c'est le grain du coût. En suivi précis, il se lit par produit,
 * depuis la recette. En suivi simple, il se lit par période :
 *
 *     coût matière = stock initial + entrées − stock final
 *
 * C'est la méthode que tient n'importe quel restaurant avant d'avoir ses
 * fiches techniques. Elle ne demande aucune recette, elle est juste au franc
 * près sur la période, et elle est muette sur le détail par produit. Ce n'est
 * pas un pis-aller : c'est une autre unité de mesure, plus grossière et plus
 * sûre.
 *
 * ------------------------------------------------------------------------
 * POURQUOI CE MODULE EXISTE
 *
 * Deux régimes, c'est deux chemins qui divergent, et un `if (mode === ...)`
 * semé dans quinze écrans qu'on oublie de tester. Les écrans lisent donc une
 * POLITIQUE, jamais l'enum : un seul endroit à tester, un seul à changer, et un
 * troisième régime demain ne toucherait aucun écran.
 */

export type OperatingMode = 'SIMPLE' | 'PRECIS';

export const OPERATING_MODES: readonly OperatingMode[] = ['SIMPLE', 'PRECIS'];

/**
 * « Simple » ne veut pas dire « dégradé ».
 *
 * C'est aujourd'hui le seul des deux régimes qui dise la vérité sur les coûts :
 * en suivi précis, un produit fini se vend au coût moyen pondéré de sa fiche,
 * lequel n'est écrit que par les réceptions — jamais par la production. Un
 * produit fabriqué sort donc à coût nul et affiche 100 % de marge. Le nom est
 * court parce qu'il doit tenir dans un interrupteur ; l'écran de réglages
 * énonce ce que chaque régime sait et ne sait pas dire, plutôt que de les
 * classer.
 */
export const OPERATING_MODE_LABEL: Record<OperatingMode, string> = {
  SIMPLE: 'Suivi simple',
  PRECIS: 'Suivi précis',
};

/** Ce que le régime décide, écran par écran. Personne ne lit `mode` directement. */
export interface OperatingPolicy {
  /** Une préparation exige-t-elle une recette figée pour être déclarée ? */
  recipeRequiredToProduce: boolean;
  /**
   * Le manque de stock empêche-t-il d'encaisser ?
   *
   * En suivi simple, non : le stock de produits finis est une déclaration, pas
   * un compte. Vendre plus que ce qui a été déclaré préparé est une question
   * pour le soir, pas un refus au comptoir — et refuser la vente serait refuser
   * le seul chiffre que l'établissement connaisse vraiment.
   */
  saleBlockedWithoutStock: boolean;
  /** D'où vient le coût : de la recette, ou du comptage de période. */
  costMethod: 'RECIPE' | 'PERIOD';
  /**
   * Les produits finis lèvent-ils des alertes de rupture ?
   *
   * En suivi simple, non : leur stock plonge sous zéro par construction dès
   * qu'on vend plus que déclaré. Une alerte par produit et par service ne
   * serait pas une information, seulement du bruit qui apprend à ignorer les
   * alertes — y compris les vraies.
   */
  finishedGoodsAlerts: boolean;
  /**
   * Le comptage des produits finis est-il exigé pour clôturer ?
   *
   * C'est la contrepartie du suivi simple, et elle n'est pas négociable : sans
   * comptage, le régime ne mesure rien — il ne fait que ne plus bloquer. C'est
   * lui qui referme l'équation préparé − vendu − restant, et qui rattrape les
   * stocks négatifs que la journée a laissés.
   */
  countFinishedGoodsAtClosing: boolean;
  /** La marge par produit a-t-elle un sens ? Sinon on ne l'affiche pas. */
  productMarginKnown: boolean;
}

const POLICIES: Record<OperatingMode, OperatingPolicy> = {
  SIMPLE: {
    recipeRequiredToProduce: false,
    saleBlockedWithoutStock: false,
    costMethod: 'PERIOD',
    finishedGoodsAlerts: false,
    countFinishedGoodsAtClosing: true,
    productMarginKnown: false,
  },
  PRECIS: {
    recipeRequiredToProduce: false,
    saleBlockedWithoutStock: true,
    costMethod: 'RECIPE',
    finishedGoodsAlerts: true,
    countFinishedGoodsAtClosing: false,
    productMarginKnown: true,
  },
};

export function policyOf(mode: OperatingMode): OperatingPolicy {
  return POLICIES[mode] ?? POLICIES.SIMPLE;
}

/**
 * Le régime par défaut.
 *
 * Simple, et c'est délibéré : un établissement qui installe l'application n'a
 * pas encore de recettes justes. Démarrer en suivi précis lui présenterait une
 * impasse — pas de recette, pas de production ; pas de production, pas de
 * produit fini ; pas de produit fini, pas de vente — dès le premier jour.
 */
export const DEFAULT_OPERATING_MODE: OperatingMode = 'SIMPLE';

/* --------------------------------------------------- Ce que dit l'écran */

/**
 * Ce que chaque régime demande, déduit et ignore.
 *
 * Le contenu vit ici et pas dans l'écran, sur le modèle de
 * `CLOSING_STEP_SPECS` : le réglage qui change la méthode de toute la maison
 * doit énoncer ses conséquences, et ces conséquences doivent rester à côté du
 * code qui les applique — sinon la prose et le comportement dérivent.
 */
export interface OperatingModeSpec {
  mode: OperatingMode;
  label: string;
  /** Une ligne, à la première personne. */
  summary: string;
  /** Ce que je déclare. */
  declares: string[];
  /** Ce que le système en déduit. */
  derives: string[];
  /** Ce qu'il ne sait pas dire — nommé, jamais masqué. */
  silentOn: string[];
  /** Sa contrepartie : ce qu'il faut tenir pour que le régime mesure quelque chose. */
  requires: string;
}

export const OPERATING_MODE_SPECS: Record<OperatingMode, OperatingModeSpec> = {
  SIMPLE: {
    mode: 'SIMPLE',
    label: OPERATING_MODE_LABEL.SIMPLE,
    summary: 'Je déclare ce que je prépare, et je compte ce qui reste le soir.',
    declares: [
      'Mon approvisionnement et ce qu’il a coûté',
      'Ce que j’ai préparé, en nombre de produits',
      'Ce qu’il me reste en fin de journée',
    ],
    derives: [
      'Le nombre de produits finis disponibles à la vente',
      'Le coût matière de la période : stock initial + achats − stock final',
      'La part matière du chiffre d’affaires',
      'L’écart entre ce qui a été préparé, vendu, et compté',
    ],
    silentOn: [
      'Ce que coûte exactement une unité de chaque produit',
      'La marge produit par produit',
    ],
    requires: 'Le comptage des produits finis, chaque soir, à la clôture.',
  },
  PRECIS: {
    mode: 'PRECIS',
    label: OPERATING_MODE_LABEL.PRECIS,
    summary: 'Je tiens mes recettes, et le système en déduit tout le reste.',
    declares: [
      'Mes recettes, ingrédient par ingrédient',
      'La quantité réellement produite à chaque préparation',
    ],
    derives: [
      'La consommation de matières, à chaque préparation',
      'Le coût d’une unité, au coût moyen pondéré des ingrédients',
      'La marge de chaque produit',
      'L’écart entre ce que la recette prévoit et ce qui est réellement sorti',
    ],
    silentOn: [],
    requires: 'Une recette juste pour chaque produit préparé, tenue à jour.',
  },
};
