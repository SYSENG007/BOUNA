import type { Item, Unit, UUID } from './types';
import { canConvert, convert } from './units';

/**
 * Ce que les matières permettent encore de produire.
 *
 * Le calcul vivait dans l'écran Production, qui l'affichait ; l'écran de
 * déclaration, lui, ne le connaissait pas et laissait enregistrer un batch de
 * vingt-deux unités avec de quoi en faire zéro. Le stock devenait une fiction :
 * du lait à −15 L, un « Rupture » sur un article qu'on venait de consommer
 * deux fois. Les deux écrans lisent désormais la même fonction.
 *
 * On prend le maillon le plus faible de la recette — c'est lui qui casse le
 * service. Et on compare dans l'unité de l'ARTICLE : une recette en millilitres
 * face à un stock en litres, comparés bruts, donnent n'importe quoi.
 */
export interface RecipeIngredientLike {
  itemId: UUID;
  quantity: number;
  unit: Unit;
}

export interface Feasibility {
  /** Unités entières réalisables. Zéro si un ingrédient manque. */
  units: number;
  /** L'ingrédient qui limite, celui qu'il faut racheter en premier. */
  limitingItemId?: UUID;
  limitingName: string;
  /** Aucune recette exploitable : on ne sait pas, ce n'est pas « zéro ». */
  unknown: boolean;
}

export function feasibleUnits(
  ingredients: readonly RecipeIngredientLike[],
  itemOf: (id: UUID) => Item | undefined,
  availableOf: (id: UUID) => number,
): Feasibility {
  let min = Infinity;
  let limitingItemId: UUID | undefined;
  let limitingName = '—';
  let seen = 0;

  for (const ing of ingredients) {
    const item = itemOf(ing.itemId);
    /* Une unité qu'on ne sait pas traduire n'est pas une contrainte qu'on peut
       évaluer : on l'ignore comme un ingrédient inconnu, plutôt que d'arrêter
       l'écran de préparation sur une exception. */
    if (!item || !canConvert(ing.unit, item.unit)) continue;
    seen += 1;
    const perUnit = convert(ing.quantity, ing.unit, item.unit);
    if (perUnit <= 0) continue;
    const possible = availableOf(ing.itemId) / perUnit;
    if (possible < min) {
      min = possible;
      limitingItemId = item.id;
      limitingName = item.name;
    }
  }

  if (seen === 0 || min === Infinity) {
    return { units: 0, limitingName: '—', unknown: true };
  }
  return { units: Math.max(0, Math.floor(min)), limitingItemId, limitingName, unknown: false };
}

/**
 * De combien le stock passerait-il en négatif si on déclarait `quantity` ?
 *
 * On ne bloque pas la déclaration : le préparateur a réellement fabriqué ce
 * qu'il déclare, et lui refuser sa saisie ne ferait qu'éloigner l'application
 * du terrain. Mais on lui montre la conséquence avant qu'il valide.
 */
export interface Shortfall {
  itemId: UUID;
  name: string;
  missing: number;
  unit: Unit;
  /** Part du besoin qui n'est pas couverte, de 0 à 1. */
  ratio: number;
}

export function shortfallFor(
  ingredients: readonly RecipeIngredientLike[],
  itemOf: (id: UUID) => Item | undefined,
  availableOf: (id: UUID) => number,
  quantity: number,
): Shortfall[] {
  const out: Shortfall[] = [];
  for (const ing of ingredients) {
    const item = itemOf(ing.itemId);
    if (!item || !canConvert(ing.unit, item.unit)) continue;
    const needed = convert(ing.quantity, ing.unit, item.unit) * quantity;
    const missing = needed - availableOf(ing.itemId);
    if (missing > 0.0001) {
      out.push({
        itemId: item.id,
        name: item.name,
        missing: Math.round(missing * 100) / 100,
        unit: item.unit,
        ratio: needed > 0 ? missing / needed : 1,
      });
    }
  }
  /* Trier sur la quantité manquante reviendrait à comparer 22 gobelets à
     3,96 litres de lait. La part non couverte, elle, se compare. */
  return out.sort((a, b) => b.ratio - a.ratio || a.name.localeCompare(b.name));
}
