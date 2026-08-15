import type { Item, StockMovement, Unit, UUID } from './types';
import { canConvert, convert } from './units';

/**
 * RULE-002 : aucun stock ne peut être modifié directement.
 * RULE-003 : toute correction produit un StockMovement.
 *
 * Le stock est donc TOUJOURS une projection des mouvements. Aucune fonction
 * de ce module n'écrit un niveau de stock : elles ne font que replier la liste.
 */

export interface StockKey { itemId: UUID; locationId: UUID }

/**
 * Ce qu'un mouvement ajoute au stock de son article, ou rien.
 *
 * `convert()` refuse — à raison — de traduire des kg en unités : le facteur
 * n'existe pas, et l'inventer donnerait un stock faux sans le dire. Mais ce
 * refus levé au milieu du repli remontait jusqu'à `BunaProvider`, au-dessus de
 * toutes les limites d'écran : un seul mouvement dont l'unité ne correspondait
 * plus à celle de son article éteignait l'application entière — comptoir
 * compris — et le rechargement la rallumait sur le même état enregistré.
 *
 * Le cas n'a rien d'exotique : il suffit qu'on change l'unité d'un article déjà
 * mouvementé, ou qu'une ligne serveur arrive avec une unité inconnue que le
 * mappeur replie sur « unité ».
 *
 * Un article dont on ne sait plus lire le stock est un article à signaler, pas
 * une caisse à fermer. On écarte donc le mouvement au lieu de l'inventer, et
 * `unitMismatches()` dit lesquels ont été écartés — pour que ce silence ne
 * passe pas pour un zéro.
 */
function contribution(m: StockMovement, item: Item): number {
  return canConvert(m.unit, item.unit) ? convert(m.quantity, m.unit, item.unit) : 0;
}

/** Un mouvement que le repli n'a pas pu compter, et de quoi le réparer. */
export interface UnitMismatch {
  movementId: UUID;
  itemId: UUID;
  itemName: string;
  /** L'unité dans laquelle le mouvement a été écrit. */
  movementUnit: Unit;
  /** Celle que porte l'article aujourd'hui. */
  itemUnit: Unit;
}

/**
 * Les mouvements écartés par la projection.
 *
 * Sert au diagnostic et à l'alerte : tant qu'un article figure ici, son stock
 * affiché est incomplet, et c'est l'unité de l'article ou celle du mouvement
 * qu'il faut corriger — pas le stock, qui ne se saisit pas (RULE-002).
 */
export function unitMismatches(
  movements: StockMovement[],
  items: Map<UUID, Item>,
): UnitMismatch[] {
  const out: UnitMismatch[] = [];
  for (const m of movements) {
    const item = items.get(m.itemId);
    if (!item || canConvert(m.unit, item.unit)) continue;
    out.push({
      movementId: m.id,
      itemId: item.id,
      itemName: item.name,
      movementUnit: m.unit,
      itemUnit: item.unit,
    });
  }
  return out;
}

/** Stock d'un article sur un emplacement, exprimé dans l'unité de l'article. */
export function stockAt(movements: StockMovement[], itemId: UUID, locationId: UUID, item: Item): number {
  return movements.reduce((total, m) => {
    if (m.itemId !== itemId || m.locationId !== locationId) return total;
    return total + contribution(m, item);
  }, 0);
}

/** Stock consolidé tous emplacements confondus. */
export function stockTotal(movements: StockMovement[], itemId: UUID, item: Item): number {
  return movements.reduce((total, m) => {
    if (m.itemId !== itemId) return total;
    return total + contribution(m, item);
  }, 0);
}

/** Projection complète : Map<`itemId@locationId`, quantité>. */
export function projectStock(movements: StockMovement[], items: Map<UUID, Item>): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of movements) {
    const item = items.get(m.itemId);
    if (!item) continue;
    const key = `${m.itemId}@${m.locationId}`;
    out.set(key, (out.get(key) ?? 0) + contribution(m, item));
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



/**
 * D'où sort réellement la marchandise.
 *
 * La vente déduisait toujours du comptoir et la production livrait au frigo :
 * produire ne rendait donc jamais un produit vendable, et vendre creusait un
 * emplacement vide pendant que la marchandise dormait deux mètres plus loin.
 * Le stock est une projection : on déduit de l'emplacement qui le détient, pas
 * de celui qu'on avait supposé.
 *
 * On préfère l'emplacement demandé s'il couvre le besoin — le comptoir sert au
 * comptoir. Sinon le premier qui couvre, dans l'ordre donné. Et si aucun ne
 * couvre, celui qui en a le plus : mieux vaut un écart sur l'emplacement où la
 * marchandise se trouvait vraiment qu'un négatif propre sur un emplacement vide.
 */
export function sourceLocation(
  availableAt: (locationId: UUID) => number,
  locations: readonly UUID[],
  quantity: number,
  preferred?: UUID,
): UUID {
  if (locations.length === 0) return preferred ?? '';
  if (preferred && availableAt(preferred) >= quantity) return preferred;

  const covering = locations.find((id) => availableAt(id) >= quantity);
  if (covering) return covering;

  return locations.reduce(
    (best, id) => (availableAt(id) > availableAt(best) ? id : best),
    preferred && locations.includes(preferred) ? preferred : locations[0],
  );
}
