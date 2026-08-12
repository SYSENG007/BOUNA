import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useBuna } from '../store/BunaStore';
import type { Item, UUID } from '../domain/types';

/**
 * Panier — volontairement éphémère et hors du store persistant.
 * Une vente n'existe qu'une fois encaissée ; un panier abandonné ne doit
 * laisser aucune trace dans les événements métier.
 */
interface CartCtx {
  cart: Record<UUID, number>;
  lines: { item: Item; quantity: number }[];
  count: number;
  total: number;
  cogs: number;
  add: (id: UUID) => void;
  remove: (id: UUID) => void;
  setQty: (id: UUID, qty: number) => void;
  clear: () => void;
}

const Ctx = createContext<CartCtx | null>(null);

export function useCart(): CartCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useCart doit être utilisé dans <CartProvider>');
  return c;
}

export function CartProvider({ children }: { children: ReactNode }) {
  const { items } = useBuna();
  const [cart, setCart] = useState<Record<UUID, number>>({});

  const add = useCallback((id: UUID) => {
    setCart((c) => ({ ...c, [id]: (c[id] ?? 0) + 1 }));
  }, []);

  const remove = useCallback((id: UUID) => {
    setCart((c) => {
      const next = { ...c };
      const q = (next[id] ?? 0) - 1;
      if (q <= 0) delete next[id];
      else next[id] = q;
      return next;
    });
  }, []);

  const setQty = useCallback((id: UUID, qty: number) => {
    setCart((c) => {
      const next = { ...c };
      if (qty <= 0) delete next[id];
      else next[id] = qty;
      return next;
    });
  }, []);

  const clear = useCallback(() => setCart({}), []);

  const lines = useMemo(
    () =>
      Object.entries(cart)
        .map(([id, quantity]) => ({ item: items.get(id)!, quantity }))
        .filter((l) => l.item),
    [cart, items],
  );

  const count = lines.reduce((s, l) => s + l.quantity, 0);
  const total = lines.reduce((s, l) => s + l.quantity * (l.item.price ?? 0), 0);
  const cogs = lines.reduce((s, l) => s + l.quantity * (l.item.weightedAvgCost ?? 0), 0);

  return (
    <Ctx.Provider value={{ cart, lines, count, total, cogs, add, remove, setQty, clear }}>
      {children}
    </Ctx.Provider>
  );
}
