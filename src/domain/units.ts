import { UNIT_BASE, UNIT_LABEL, type DosingUnit, type Unit } from './types';

const ALL_UNITS = Object.keys(UNIT_BASE) as DosingUnit[];

/** Convertit une quantité entre deux unités de la même famille (§10). */
export function convert(quantity: number, from: DosingUnit, to: DosingUnit): number {
  const a = UNIT_BASE[from];
  const b = UNIT_BASE[to];
  if (a.base !== b.base) {
    throw new Error(`Conversion impossible : ${from} (${a.base}) vers ${to} (${b.base})`);
  }
  return (quantity * a.factor) / b.factor;
}

export function canConvert(from: DosingUnit, to: DosingUnit): boolean {
  return UNIT_BASE[from].base === UNIT_BASE[to].base;
}

/**
 * Formate une quantité pour le terrain : décimales seulement si utiles,
 * virgule décimale française, unité accolée.
 */
export function formatQty(quantity: number, unit: Unit): string {
  const rounded = Math.round(quantity * 100) / 100;
  const text = Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(rounded * 10 % 1 === 0 ? 1 : 2).replace('.', ',');
  return unit === 'unite' ? text : `${text} ${UNIT_LABEL[unit]}`;
}

/**
 * Les unités dans lesquelles on peut exprimer une même grandeur.
 *
 * On achète au kilo et on dose au gramme : une recette qui ne sait écrire que
 * l'unité d'achat oblige à saisir « 0,0015 kg » là où le carnet dit « 1,5 g ».
 * Les deux quantités sont la même — `convert()` les relie — mais une seule se
 * relit sans se tromper de virgule.
 *
 * Les unités de comptage (unité, sachet, carton…) partagent la même famille
 * sans être des sous-multiples les unes des autres : on les rend telles
 * quelles, c'est au contexte de décider s'il a un sens à en changer.
 *
 * Rendues de la plus grande à la plus petite, l'unité de référence en tête.
 */
export function subUnitsOf(unit: Unit): DosingUnit[] {
  const family = ALL_UNITS.filter((u) => UNIT_BASE[u].base === UNIT_BASE[unit].base);
  return family.sort((a, b) => {
    if (a === unit) return -1;
    if (b === unit) return 1;
    return UNIT_BASE[b].factor - UNIT_BASE[a].factor;
  });
}

/**
 * La même quantité, écrite comme on la lirait à voix haute.
 *
 * Le stock est enregistré dans l'unité de l'article — 0,005 L d'arôme, parce
 * que c'est le litre que la base connaît. Mais « 0,005 L » ne se relit pas :
 * on l'a saisi en millilitres et on veut le relire en millilitres. On descend
 * donc vers la sous-unité qui rend le nombre lisible, sans jamais toucher à ce
 * qui est stocké.
 */
export function readable(quantity: number, unit: Unit): { quantity: number; unit: DosingUnit } {
  if (quantity === 0) return { quantity, unit };
  for (const candidate of subUnitsOf(unit)) {
    const value = convert(quantity, unit, candidate);
    /* La première unité qui amène le nombre au-dessus de 1 : en dessous, on
       relit des zéros ; bien au-dessus, on relit des milliers. */
    if (Math.abs(value) >= 1) return { quantity: value, unit: candidate };
  }
  return { quantity, unit };
}

/**
 * Un dosage se relit au chiffre près : `formatQty` arrondit à deux décimales,
 * ce qui est juste pour un niveau de stock et faux pour une dose.
 */
export function formatDose(quantity: number, unit: Unit): string {
  const shown = readable(quantity, unit);
  const text = shown.quantity
    .toFixed(5)
    .replace(/0+$/, '')
    .replace(/\.$/, '')
    .replace('.', ',');
  return `${text} ${UNIT_LABEL[shown.unit]}`;
}

/**
 * L'unité dans laquelle une saisie doit être ENREGISTRÉE.
 *
 * Convertir systématiquement vers l'unité de l'article paraissait propre, mais
 * `recipe_ingredients.quantity` est un `numeric(14,4)` contraint à rester
 * strictement positif : 1 mg ramené au kilo vaut 0,000001, arrondi à 0,0000,
 * et la ligne est refusée. Une dose fine devenait donc impossible à
 * enregistrer, en silence.
 *
 * On garde donc l'unité saisie dès qu'elle existe en base, et on ne convertit
 * que ce qu'elle ne connaît pas — le milligramme, replié sur le gramme, sa
 * voisine immédiate. La quantité reste comparable : tout le domaine passe par
 * `convert()`, jamais par une égalité d'unités.
 */
export function storageUnit(entered: DosingUnit): Unit {
  return entered === 'mg' ? 'g' : entered;
}
