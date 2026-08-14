import type { Item, StockMovement, UUID } from './types';
import { convert } from './units';

/**
 * RULE-002 : aucun stock ne peut être modifié directement.
 * RULE-003 : toute correction produit un StockMovement.
 *
 * Le stock est donc TOUJOURS une projection des mouvements. Aucune fonction
 * de ce module n'écrit un niveau de stock : elles ne font que replier la liste.
 */

export interface StockKey { itemId: UUID; locationId: UUID }

/** Stock d'un article sur un emplacement, exprimé dans l'unité de l'article. */
export function stockAt(movements: StockMovement[], itemId: UUID, locationId: UUID, item: Item): number {
  return movements.reduce((total, m) => {
    if (m.itemId !== itemId || m.locationId !== locationId) return total;
    return total + convert(m.quantity, m.unit, item.unit);
  }, 0);
}

/** Stock consolidé tous emplacements confondus. */
export function stockTotal(movements: StockMovement[], itemId: UUID, item: Item): number {
  return movements.reduce((total, m) => {
    if (m.itemId !== itemId) return total;
    return total + convert(m.quantity, m.unit, item.unit);
  }, 0);
}

/** Projection complète : Map<`itemId@locationId`, quantité>. */
export function projectStock(movements: StockMovement[], items: Map<UUID, Item>): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of movements) {
    const item = items.get(m.itemId);
    if (!item) continue;
    const key = `${m.itemId}@${m.locationId}`;
    out.set(key, (out.get(key) ?? 0) + convert(m.quantity, m.unit, item.unit));
  }
  return out;
}

/* ------------------------------------------------------------------ Coût */

/**
 * §40 — Coût moyen pondéré (Weighted Average Cost).
 *
 * Nouveau coût = (valeur du stock existant + valeur de l'entrée)
 *                / (quantité existante + quantité entrante)
 *
 * Une réception à un prix différent déplace donc le coût de tous les produits
 * qui consomment cet article (§41) — c'est voulu : la marge doit bouger avec le marché.
 */
export function weightedAverageCost(
  currentQty: number,
  currentCost: number,
  incomingQty: number,
  incomingUnitCost: number,
): number {
  const totalQty = currentQty + incomingQty;
  if (totalQty <= 0) return incomingUnitCost;
  if (currentQty <= 0) return incomingUnitCost;
  return (currentQty * currentCost + incomingQty * incomingUnitCost) / totalQty;
}

/* --------------------------------------------------- Réapprovisionnement */

export type StockHealth = 'OK' | 'SURVEILLER' | 'CRITIQUE' | 'RUPTURE';

/**
 * Santé d'un article. Le seuil « surveiller » se déclenche à 1,5× le minimum :
 * assez tôt pour acheter au calme, assez tard pour ne pas crier au loup.
 */
export function stockHealth(quantity: number, item: Item): StockHealth {
  const min = item.minimumStock ?? 0;
  if (quantity <= 0) return 'RUPTURE';
  if (min <= 0) return 'OK';
  if (quantity <= min) return 'CRITIQUE';
  if (quantity <= min * 1.5) return 'SURVEILLER';
  return 'OK';
}

/**
 * §12 — quantité suggérée = stock cible − stock actuel, jamais négative.
 * Exemple PRD : stock 5 L, minimum 10 L, cible 25 L → besoin 20 L.
 */
export function replenishmentNeed(quantity: number, item: Item): number {
  const target = item.targetStock ?? 0;
  return Math.max(0, Math.round((target - quantity) * 100) / 100);
}

/* ------------------------------------------------- Théorique vs réel §66 */


