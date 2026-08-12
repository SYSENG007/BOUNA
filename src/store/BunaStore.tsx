import {
  createContext, useCallback, useContext, useEffect, useMemo, useReducer, useState,
  type ReactNode,
} from 'react';
import type {
  AuditEvent, CashSession, DomainEvent, Expense, Item, Notification, PaymentMethod,
  ProductionBatch, Purchase, Role, Sale, SaleLine, StockMovement, User, UUID,
  WasteEvent, WasteReason, Unit, EventType,
} from '../domain/types';
import { deviceId, uuid, batchCode } from '../domain/ids';
import { convert } from '../domain/units';
import { projectStock, weightedAverageCost } from '../domain/stock';
import { pendingEvents, localTransport } from './outbox';
import { loadState, saveState } from './persist';
import {
  ITEMS, LOC, LOCATIONS, ORG_ID, RECIPES, RECIPE_VERSIONS, SEED_AUDIT, SEED_CASH_SESSION,
  SEED_EXPENSES, SEED_MOVEMENTS, SEED_NOTIFICATIONS, SEED_PURCHASES, SITE, SUPPLIERS, USERS,
} from '../domain/seed';

/* ------------------------------------------------------------------ État */

interface State {
  currentUserId: UUID | null;
  items: Item[];
  movements: StockMovement[];
  events: DomainEvent[];
  sales: Sale[];
  batches: ProductionBatch[];
  waste: WasteEvent[];
  expenses: Expense[];
  purchases: Purchase[];
  cashSession: CashSession;
  notifications: Notification[];
  audit: AuditEvent[];
  saleCounter: number;
  batchCounter: number;
}

const initialState: State = {
  currentUserId: null,
  items: ITEMS,
  movements: SEED_MOVEMENTS,
  events: [],
  sales: [],
  batches: [],
  waste: [],
  expenses: SEED_EXPENSES,
  purchases: SEED_PURCHASES,
  cashSession: SEED_CASH_SESSION,
  notifications: SEED_NOTIFICATIONS,
  audit: SEED_AUDIT,
  saleCounter: 453,
  batchCounter: 4,
};

type Action =
  | { type: 'LOGIN'; userId: UUID }
  | { type: 'LOGOUT' }
  | { type: 'HYDRATE'; state: State }
  /** Transaction métier atomique (§81) : tout ou rien, en une seule réduction. */
  | {
      type: 'COMMIT';
      movements?: StockMovement[];
      events?: DomainEvent[];
      audit?: AuditEvent[];
      sale?: Sale;
      batch?: ProductionBatch;
      waste?: WasteEvent;
      expense?: Expense;
      purchase?: Purchase;
      itemCosts?: { itemId: UUID; cost: number }[];
      cashSession?: CashSession;
      notifications?: Notification[];
      bumpSale?: boolean;
      bumpBatch?: boolean;
    }
  | { type: 'SAVE_ITEM'; item: Item }
  | { type: 'SET_SYNC'; ids: UUID[]; status: DomainEvent['syncStatus'] }
  | { type: 'NOTIFICATION_STATUS'; id: UUID; status: Notification['status'] };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'HYDRATE':
      return action.state;
    case 'LOGIN':
      return { ...state, currentUserId: action.userId };
    case 'LOGOUT':
      return { ...state, currentUserId: null };

    case 'COMMIT': {
      const a = action;
      // Le coût moyen pondéré est le seul champ « écrasé » — et il est dérivé,
      // pas saisi. Le stock, lui, ne bouge que par mouvements.
      const items = a.itemCosts?.length
        ? state.items.map((it) => {
            const patch = a.itemCosts!.find((c) => c.itemId === it.id);
            return patch ? { ...it, weightedAvgCost: patch.cost } : it;
          })
        : state.items;

      return {
        ...state,
        items,
        movements: a.movements?.length ? [...state.movements, ...a.movements] : state.movements,
        events: a.events?.length ? [...state.events, ...a.events] : state.events,
        audit: a.audit?.length ? [...a.audit, ...state.audit] : state.audit,
        sales: a.sale ? [a.sale, ...state.sales] : state.sales,
        batches: a.batch ? [a.batch, ...state.batches] : state.batches,
        waste: a.waste ? [a.waste, ...state.waste] : state.waste,
        expenses: a.expense ? [a.expense, ...state.expenses] : state.expenses,
        purchases: a.purchase ? [a.purchase, ...state.purchases] : state.purchases,
        cashSession: a.cashSession ?? state.cashSession,
        notifications: a.notifications?.length
          ? [...a.notifications, ...state.notifications]
          : state.notifications,
        saleCounter: a.bumpSale ? state.saleCounter + 1 : state.saleCounter,
        batchCounter: a.bumpBatch ? state.batchCounter + 1 : state.batchCounter,
      };
    }

    case 'SAVE_ITEM': {
      const exists = state.items.some((i) => i.id === action.item.id);
      return {
        ...state,
        items: exists
          ? state.items.map((i) => (i.id === action.item.id ? action.item : i))
          : [...state.items, action.item],
      };
    }

    case 'SET_SYNC':
      return {
        ...state,
        events: state.events.map((e) =>
          action.ids.includes(e.id)
            ? {
                ...e,
                syncStatus: action.status,
                createdAtServer: action.status === 'SYNCED' ? new Date().toISOString() : e.createdAtServer,
                attempts: action.status === 'FAILED' ? e.attempts + 1 : e.attempts,
              }
            : e,
        ),
      };

    case 'NOTIFICATION_STATUS':
      return {
        ...state,
        notifications: state.notifications.map((n) =>
          n.id === action.id ? { ...n, status: action.status } : n,
        ),
      };
  }
}

/* --------------------------------------------------------------- Contexte */

interface Ctx {
  state: State;
  user: User | null;
  users: User[];
  items: Map<UUID, Item>;
  stock: Map<string, number>;
  online: boolean;
  pending: number;
  syncing: boolean;
  lastSyncAt: string | null;
  login: (userId: UUID) => void;
  logout: () => void;
  syncNow: () => Promise<void>;
  /** Enregistre une vente et tout ce qu'elle implique, en une transaction. */
  completeSale: (
    lines: { item: Item; quantity: number }[],
    paymentMethod: PaymentMethod,
    amountReceived: number,
  ) => Sale | null;
  voidSale: (saleId: UUID, reason: string) => void;
  completeBatch: (input: {
    itemId: UUID; recipeVersionId: UUID; planned: number; produced: number;
    loss: number; locationId: UUID;
  }) => void;
  recordWaste: (input: { itemId: UUID; locationId: UUID; quantity: number; reason: WasteReason }) => void;
  transferStock: (input: { itemId: UUID; from: UUID; to: UUID; quantity: number }) => void;
  recordExpense: (input: Omit<Expense, 'id' | 'userId' | 'createdAt'>) => void;
  /** Crée ou met à jour un article du catalogue. */
  saveItem: (item: Item) => void;
  /** Archive un article : jamais de suppression, l'historique doit rester lisible. */
  archiveItem: (itemId: UUID) => void;
  /**
   * Comptage d'inventaire : produit un mouvement d'ajustement motivé (RULE-003/008).
   * On ne écrit jamais le stock ; on écrit l'écart constaté.
   */
  adjustStock: (input: {
    itemId: UUID; locationId: UUID; countedQuantity: number; reason: string;
  }) => void;
  /** Réception : mouvements + coût moyen pondéré + dépense, en une transaction. */
  receiveGoods: (input: {
    supplierId: UUID;
    locationId: UUID;
    lines: { itemId: UUID; quantity: number; unitPrice: number }[];
    transportCost: number;
    paymentMethod: PaymentMethod;
  }) => void;
  closeCashSession: (countedCash: number, reason?: string) => void;
  setNotificationStatus: (id: UUID, status: Notification['status']) => void;
  stockOf: (itemId: UUID, locationId?: UUID) => number;
}

const BunaContext = createContext<Ctx | null>(null);

export function useBuna(): Ctx {
  const ctx = useContext(BunaContext);
  if (!ctx) throw new Error('useBuna doit être utilisé dans <BunaProvider>');
  return ctx;
}

/* -------------------------------------------------------------- Provider */

export function BunaProvider({ children }: { children: ReactNode }) {
  /**
   * L'état local est relu de façon SYNCHRONE au premier rendu.
   * Le faire dans un effet créait une course : l'effet de sauvegarde
   * s'exécutait avant l'application de l'état restauré et l'écrasait
   * (visible en StrictMode, qui monte deux fois).
   */
  const [state, dispatch] = useReducer(reducer, initialState, (base) => {
    const saved = loadState<Partial<State>>();
    return saved ? { ...base, ...saved } : base;
  });
  const [online, setOnline] = useState(navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  /* Toute évolution d'état est persistée : l'app doit rouvrir sans réseau (§99). */
  useEffect(() => {
    saveState(state);
  }, [state]);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  const itemsMap = useMemo(() => new Map(state.items.map((i) => [i.id, i])), [state.items]);
  const stock = useMemo(() => projectStock(state.movements, itemsMap), [state.movements, itemsMap]);
  const user = useMemo(
    () => USERS.find((u) => u.id === state.currentUserId) ?? null,
    [state.currentUserId],
  );
  const pending = pendingEvents(state.events).length;

  const stockOf = useCallback(
    (itemId: UUID, locationId?: UUID) => {
      if (locationId) return stock.get(`${itemId}@${locationId}`) ?? 0;
      let total = 0;
      for (const [key, value] of stock) if (key.startsWith(`${itemId}@`)) total += value;
      return total;
    },
    [stock],
  );

  /* ------------------------------------------------------- Fabriques */

  const makeEvent = useCallback(
    <P,>(eventType: EventType, entityType: string, entityId: UUID, payload: P): DomainEvent<P> => ({
      id: uuid(), // §56 — clé d'idempotence générée AVANT tout contact serveur
      organizationId: ORG_ID,
      siteId: SITE.id,
      eventType,
      entityType,
      entityId,
      actorUserId: user?.id ?? 'unknown',
      deviceId: deviceId(),
      payload,
      createdAtLocal: new Date().toISOString(),
      createdAtServer: null,
      syncStatus: navigator.onLine ? 'QUEUED' : 'LOCAL_ONLY',
      attempts: 0,
    }),
    [user],
  );

  const makeMovement = useCallback(
    (
      itemId: UUID, locationId: UUID, quantity: number, unit: Unit,
      movementType: StockMovement['movementType'], referenceType: string, referenceId: UUID,
    ): StockMovement => ({
      id: uuid(),
      organizationId: ORG_ID,
      siteId: SITE.id,
      locationId,
      itemId,
      quantity,
      unit,
      movementType,
      referenceType,
      referenceId,
      userId: user?.id ?? 'unknown',
      deviceId: deviceId(),
      createdAt: new Date().toISOString(),
    }),
    [user],
  );

  const makeAudit = useCallback(
    (action: string, detail: string, reference?: string): AuditEvent => ({
      id: uuid(),
      userId: user?.id ?? 'unknown',
      userName: user?.name.split(' ')[0] ?? '—',
      role: (user?.role ?? 'SELLER') as Role,
      action,
      detail,
      reference,
      createdAt: new Date().toISOString(),
    }),
    [user],
  );

  /* ---------------------------------------------------- Transactions */

  const completeSale = useCallback<Ctx['completeSale']>(
    (cartLines, paymentMethod, amountReceived) => {
      if (!cartLines.length || !user) return null;

      const lines: SaleLine[] = cartLines.map(({ item, quantity }) => ({
        itemId: item.id,
        name: item.name,
        quantity,
        unitPrice: item.price ?? 0,
        unitCost: item.weightedAvgCost ?? 0, // COGS figé à l'instant de la vente
      }));

      const total = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
      const cogs = lines.reduce((s, l) => s + l.quantity * l.unitCost, 0);
      const saleId = uuid();

      const sale: Sale = {
        id: saleId,
        number: state.saleCounter + 1,
        siteId: SITE.id,
        locationId: LOC.POS,
        cashSessionId: state.cashSession.id,
        sellerId: user.id,
        lines,
        total,
        cogs,
        paymentMethod,
        amountReceived,
        status: 'COMPLETED',
        createdAt: new Date().toISOString(),
      };

      // Sale + SaleLines + Payment + StockMovements + COGS + Audit + DomainEvent,
      // ensemble ou pas du tout.
      dispatch({
        type: 'COMMIT',
        sale,
        bumpSale: true,
        movements: lines.map((l) =>
          makeMovement(l.itemId, LOC.POS, -l.quantity, 'unite', 'SALE', 'Sale', saleId),
        ),
        events: [
          makeEvent('SALE_COMPLETED', 'Sale', saleId, { total, cogs, lines }),
          makeEvent('PAYMENT_RECEIVED', 'Sale', saleId, { paymentMethod, amount: total }),
        ],
        audit: [
          makeAudit(
            `Vente #${sale.number} — ${total} FCFA`,
            `${lines.map((l) => `${l.quantity} ${l.name}`).join(', ')} · ${paymentMethod}`,
            `sale:${sale.number}`,
          ),
        ],
      });

      return sale;
    },
    [user, state.saleCounter, state.cashSession.id, makeEvent, makeMovement, makeAudit],
  );

  const voidSale = useCallback<Ctx['voidSale']>(
    (saleId, reason) => {
      const sale = state.sales.find((s) => s.id === saleId);
      if (!sale || sale.status !== 'COMPLETED') return;

      // RULE-001 : rien n'est supprimé. On compense par des mouvements inverses.
      dispatch({
        type: 'COMMIT',
        movements: sale.lines.map((l) =>
          makeMovement(l.itemId, LOC.POS, l.quantity, 'unite', 'RETURN', 'SaleVoid', saleId),
        ),
        events: [makeEvent('SALE_CANCELLED', 'Sale', saleId, { reason })],
        audit: [makeAudit(`Annulation vente #${sale.number}`, `motif : ${reason} · validée`, `sale:${sale.number}`)],
      });
    },
    [state.sales, makeEvent, makeMovement, makeAudit],
  );

  const completeBatch = useCallback<Ctx['completeBatch']>(
    ({ itemId, recipeVersionId, planned, produced, loss, locationId }) => {
      const version = RECIPE_VERSIONS.find((v) => v.id === recipeVersionId);
      if (!version || !user) return;

      const id = uuid();
      const code = batchCode(new Date(), state.batchCounter + 1);

      // Consommation déduite de la recette : l'utilisateur déclare 27 unités,
      // le système sait ce que ça a coûté en lait, café, gobelets.
      const consumption = version.ingredients.map((ing) =>
        makeMovement(
          ing.itemId, LOC.KITCHEN, -(ing.quantity * produced), ing.unit,
          'PRODUCTION_CONSUMPTION', 'ProductionBatch', id,
        ),
      );
      const output = makeMovement(
        itemId, locationId, produced, 'unite', 'PRODUCTION_OUTPUT', 'ProductionBatch', id,
      );

      const batch: ProductionBatch = {
        id, code, itemId, recipeVersionId, preparerId: user.id, locationId,
        plannedQuantity: planned, producedQuantity: produced, lossQuantity: loss,
        startedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
      };

      const yieldPct = planned > 0 ? Math.round((produced / planned) * 100) : 100;

      dispatch({
        type: 'COMMIT',
        batch,
        bumpBatch: true,
        movements: [...consumption, output],
        events: [
          makeEvent('BATCH_COMPLETED', 'ProductionBatch', id, { planned, produced, loss, yieldPct }),
        ],
        audit: [makeAudit(`Batch ${code}`, `${produced}/${planned} unités · rendement ${yieldPct} %`, `batch:${code}`)],
      });
    },
    [user, state.batchCounter, makeEvent, makeMovement, makeAudit],
  );

  const recordWaste = useCallback<Ctx['recordWaste']>(
    ({ itemId, locationId, quantity, reason }) => {
      const item = itemsMap.get(itemId);
      if (!item) return;
      const id = uuid();
      const cost = quantity * (item.weightedAvgCost ?? 0);

      dispatch({
        type: 'COMMIT',
        waste: {
          id, itemId, locationId, quantity, unit: item.unit, cost, reason,
          userId: user?.id ?? 'unknown', createdAt: new Date().toISOString(),
        },
        movements: [makeMovement(itemId, locationId, -quantity, item.unit, 'WASTE', 'WasteEvent', id)],
        events: [makeEvent('WASTE_RECORDED', 'WasteEvent', id, { itemId, quantity, cost, reason })],
        audit: [makeAudit(`Perte déclarée — ${item.name}`, `${quantity} ${item.unit} · motif : ${reason} · ${cost} FCFA`)],
      });
    },
    [itemsMap, user, makeEvent, makeMovement, makeAudit],
  );

  const transferStock = useCallback<Ctx['transferStock']>(
    ({ itemId, from, to, quantity }) => {
      const item = itemsMap.get(itemId);
      if (!item || quantity <= 0) return;
      // §30 — deux mouvements cohérents partageant le même transfer_id.
      const transferId = uuid();
      dispatch({
        type: 'COMMIT',
        movements: [
          makeMovement(itemId, from, -quantity, item.unit, 'TRANSFER_OUT', 'Transfer', transferId),
          makeMovement(itemId, to, quantity, item.unit, 'TRANSFER_IN', 'Transfer', transferId),
        ],
        events: [makeEvent('STOCK_TRANSFERRED', 'Transfer', transferId, { itemId, from, to, quantity })],
        audit: [makeAudit(`Transfert — ${item.name}`, `${quantity} ${item.unit}`)],
      });
    },
    [itemsMap, makeEvent, makeMovement, makeAudit],
  );

  const recordExpense = useCallback<Ctx['recordExpense']>(
    (input) => {
      const id = uuid();
      dispatch({
        type: 'COMMIT',
        expense: { ...input, id, userId: user?.id ?? 'unknown', createdAt: new Date().toISOString() },
        events: [makeEvent('EXPENSE_RECORDED', 'Expense', id, input)],
        audit: [makeAudit(`Dépense — ${input.description}`, `${input.amount} FCFA · ${input.category}`)],
      });
    },
    [user, makeEvent, makeAudit],
  );

  const saveItem = useCallback<Ctx['saveItem']>(
    (item) => {
      const isNew = !itemsMap.has(item.id);
      dispatch({ type: 'SAVE_ITEM', item });
      dispatch({
        type: 'COMMIT',
        audit: [
          makeAudit(
            isNew ? `Article créé — ${item.name}` : `Article modifié — ${item.name}`,
            `${item.kind} · ${item.unit}${item.price ? ` · ${item.price} FCFA` : ''}`,
            `item:${item.id.slice(0, 8)}`,
          ),
        ],
      });
    },
    [itemsMap, makeAudit],
  );

  const archiveItem = useCallback<Ctx['archiveItem']>(
    (itemId) => {
      const item = itemsMap.get(itemId);
      if (!item) return;
      dispatch({ type: 'SAVE_ITEM', item: { ...item, archived: true } });
      dispatch({
        type: 'COMMIT',
        audit: [makeAudit(`Article archivé — ${item.name}`, 'retiré du catalogue, historique conservé')],
      });
    },
    [itemsMap, makeAudit],
  );

  const adjustStock = useCallback<Ctx['adjustStock']>(
    ({ itemId, locationId, countedQuantity, reason }) => {
      const item = itemsMap.get(itemId);
      if (!item) return;

      const theoretical = stock.get(`${itemId}@${locationId}`) ?? 0;
      const delta = countedQuantity - theoretical;
      // Pas d'écart, pas de mouvement : un comptage conforme ne pollue pas le journal.
      if (Math.abs(delta) < 0.0001) return;

      const countId = uuid();
      dispatch({
        type: 'COMMIT',
        movements: [
          makeMovement(itemId, locationId, delta, item.unit, 'ADJUSTMENT', 'InventoryCount', countId),
        ],
        events: [
          makeEvent('STOCK_COUNTED', 'InventoryCount', countId, {
            itemId, locationId, theoretical, counted: countedQuantity, delta, reason,
          }),
        ],
        audit: [
          makeAudit(
            `Inventaire — ${item.name}`,
            `théorique ${theoretical.toFixed(2)} · compté ${countedQuantity} · écart ${delta > 0 ? '+' : ''}${delta.toFixed(2)} ${item.unit} · motif : ${reason}`,
          ),
        ],
      });
    },
    [itemsMap, stock, makeEvent, makeMovement, makeAudit],
  );

  const receiveGoods = useCallback<Ctx['receiveGoods']>(
    ({ supplierId, locationId, lines, transportCost, paymentMethod }) => {
      if (!lines.length) return;
      const purchaseId = uuid();
      const goods = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);

      const movements: StockMovement[] = [];
      const itemCosts: { itemId: UUID; cost: number }[] = [];

      for (const line of lines) {
        const item = itemsMap.get(line.itemId);
        if (!item || line.quantity <= 0) continue;

        movements.push(
          makeMovement(
            line.itemId, locationId, line.quantity, item.unit,
            'PURCHASE_RECEIPT', 'GoodsReceipt', purchaseId,
          ),
        );

        // §40 — le nouveau coût moyen se calcule sur le stock AVANT réception.
        const currentQty = stock.get(`${line.itemId}@${locationId}`) ?? 0;
        itemCosts.push({
          itemId: line.itemId,
          cost: Math.round(
            weightedAverageCost(currentQty, item.weightedAvgCost ?? 0, line.quantity, line.unitPrice),
          ),
        });
      }

      const supplierName = SUPPLIERS.find((s) => s.id === supplierId)?.name ?? 'Fournisseur';

      dispatch({
        type: 'COMMIT',
        movements,
        itemCosts,
        purchase: {
          id: purchaseId, supplierId, locationId,
          lines: lines.map((l) => {
            const item = itemsMap.get(l.itemId);
            return {
              itemId: l.itemId,
              quantity: l.quantity,
              unit: (item?.unit ?? 'unite') as Unit,
              actualUnitPrice: l.unitPrice,
              expectedUnitPrice: item?.weightedAvgCost,
            };
          }),
          transportCost,
          total: goods + transportCost,
          paymentMethod,
          createdAt: new Date().toISOString(),
          receivedAt: new Date().toISOString(),
        },
        // §39 — la marchandise entre en stock, le transport est une charge directe.
        expense: {
          id: uuid(),
          amount: goods + transportCost,
          category: 'MATIERE',
          description: `Achat — ${supplierName}`,
          supplierId,
          paymentMethod,
          userId: user?.id ?? 'unknown',
          createdAt: new Date().toISOString(),
        },
        events: [makeEvent('GOODS_RECEIVED', 'GoodsReceipt', purchaseId, { supplierId, lines, transportCost })],
        audit: [
          makeAudit(
            `Réception — ${supplierName}`,
            `${lines.length} ligne(s) · ${goods + transportCost} FCFA`,
            `purchase:${purchaseId.slice(0, 8)}`,
          ),
        ],
      });
    },
    [itemsMap, stock, user, makeEvent, makeMovement, makeAudit],
  );

  const closeCashSession = useCallback<Ctx['closeCashSession']>(
    (countedCash, reason) => {
      const session = { ...state.cashSession, countedCash, closedAt: new Date().toISOString(), varianceReason: reason };
      const expected =
        state.cashSession.openingCash +
        state.sales.filter((s) => s.paymentMethod === 'CASH' && s.status === 'COMPLETED')
          .reduce((sum, s) => sum + s.total, 0);
      const variance = countedCash - expected;

      dispatch({
        type: 'COMMIT',
        cashSession: session,
        events: [
          makeEvent('CASH_SESSION_CLOSED', 'CashSession', session.id, { expected, countedCash, variance, reason }),
        ],
        audit: [
          makeAudit(
            `Clôture shift #${session.shiftNumber} — écart ${variance >= 0 ? '+' : ''}${variance} FCFA`,
            reason ? `motif : ${reason} · en attente manager` : 'sans écart',
          ),
        ],
      });
    },
    [state.cashSession, state.sales, makeEvent, makeAudit],
  );

  const setNotificationStatus = useCallback<Ctx['setNotificationStatus']>((id, status) => {
    dispatch({ type: 'NOTIFICATION_STATUS', id, status });
  }, []);

  /* ----------------------------------------------------------- Sync */

  const syncNow = useCallback(async () => {
    const queue = pendingEvents(state.events);
    if (!queue.length || syncing || !navigator.onLine) return;
    setSyncing(true);
    dispatch({ type: 'SET_SYNC', ids: queue.map((e) => e.id), status: 'SYNCING' });
    try {
      const { acceptedIds, failedIds } = await localTransport(queue);
      if (acceptedIds.length) dispatch({ type: 'SET_SYNC', ids: acceptedIds, status: 'SYNCED' });
      if (failedIds.length) dispatch({ type: 'SET_SYNC', ids: failedIds, status: 'FAILED' });
      setLastSyncAt(new Date().toISOString());
    } catch {
      dispatch({ type: 'SET_SYNC', ids: queue.map((e) => e.id), status: 'FAILED' });
    } finally {
      setSyncing(false);
    }
  }, [state.events, syncing]);

  /* §55 — déclencheurs : retour de connexion, app au premier plan, timer. */
  useEffect(() => {
    if (online && pending > 0) void syncNow();
  }, [online, pending, syncNow]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') void syncNow(); };
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(() => { void syncNow(); }, 60_000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, [syncNow]);

  const value: Ctx = {
    state, user, users: USERS, items: itemsMap, stock, online, pending, syncing, lastSyncAt,
    login: (userId) => dispatch({ type: 'LOGIN', userId }),
    logout: () => dispatch({ type: 'LOGOUT' }),
    syncNow, completeSale, voidSale, completeBatch, recordWaste, transferStock,
    recordExpense, receiveGoods, closeCashSession, setNotificationStatus, stockOf,
    saveItem, archiveItem, adjustStock,
  };

  return <BunaContext.Provider value={value}>{children}</BunaContext.Provider>;
}

export { LOC, LOCATIONS, RECIPES, RECIPE_VERSIONS, SUPPLIERS, SITE, ITEMS };
export { convert, weightedAverageCost };
