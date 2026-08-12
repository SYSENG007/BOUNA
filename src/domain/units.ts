import { UNIT_BASE, type Unit } from './types';

/** Convertit une quantité entre deux unités de la même famille (§10). */
export function convert(quantity: number, from: Unit, to: Unit): number {
  const a = UNIT_BASE[from];
  const b = UNIT_BASE[to];
  if (a.base !== b.base) {
    throw new Error(`Conversion impossible : ${from} (${a.base}) vers ${to} (${b.base})`);
  }
  return (quantity * a.factor) / b.factor;
}

export function canConvert(from: Unit, to: Unit): boolean {
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
  return unit === 'unite' ? `${text}` : `${text} ${unit}`;
}
