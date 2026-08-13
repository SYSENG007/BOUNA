import {
  createContext, Fragment, useCallback, useContext, useEffect, useMemo, useReducer, useRef,
  useState, type ReactNode,
} from 'react';
import type {
  AuditEvent, CashSession, DomainEvent, Expense, Item, Notification, PaymentMethod,
  ProductionBatch, Purchase, Role, Sale, SaleLine, StockMovement, User, UUID,
  WasteEvent, WasteReason, Unit, EventType,
} from '../domain/types';
import { deviceId, uuid, batchCode } from '../domain/ids';
import { convert } from '../domain/units';
import { projectStock, weightedAverageCost } from '../domain/stock';
import { dueEvents, pendingEvents, selectTransport } from './outbox';
import { isBackendConfigured } from '../backend/supabase';
import { restoreSession, signIn as authSignIn, signOut as authSignOut } from '../backend/auth';
import { supabaseTransport } from '../backend/transport';
import { crossCheckStock, fetchSnapshot, type Snapshot } from '../backend/hydrate';
import { evaluateRules, type Cooldowns } from '../domain/rules';
import { loadState, saveState } from './persist';
import {
  applyReferentials, aliasEntries, resolveId, signature,
  LOC, LOCATIONS, RECIPES, RECIPE_VERSIONS, SITE, SUPPLIERS, USERS,
} from './referentials';
import {
  ITEMS, SEED_AUDIT, SEED_CASH_SESSION, SEED_EXPENSES, SEED_MOVEMENTS,
  SEED_NOTIFICATIONS, SEED_PURCHASES,
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
  /** §45 — dernier déclenchement par règle, pour ne pas répéter la même alerte. */
  cooldowns: Cooldowns;
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
  cooldowns: {},
};

type Action =
  | { type: 'LOGIN'; userId: UUID }
  | { type: 'LOGOUT' }
  | { type: 'HYDRATE'; state: State }
  /** Remplacement de l'état local par ce que PostgreSQL sait réellement. */
  | { type: 'HYDRATE_SNAPSHOT'; snapshot: Snapshot }
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
  | { type: 'NOTIFICATION_STATUS'; id: UUID; status: Notification['status'] }
  | { type: 'RAISE'; notifications: Notification[]; cooldowns: Cooldowns };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'HYDRATE':
      return action.state;

    case 'HYDRATE_SNAPSHOT': {
      const s = action.snapshot;

      // Les alertes ne sont pas des faits serveur : elles découlent de l'état et
      // de leur cooldown. Les écraser par une liste serveur vide effacerait des
      // alertes que le moteur ne relèverait pas — leur cooldown est consommé.
      const knownNotifications = new Set(s.notifications.map((n) => n.id));
      const notifications = [
        ...s.notifications,
        ...state.notifications.filter((n) => !knownNotifications.has(n.id)),
      ];

      // Le journal serveur fait foi, mais rien de ce qui n'est pas encore parti
      // ne doit disparaître : la file d'attente est la mémoire du comptoir.
      const knownEvents = new Set(s.events.map((e) => e.id));
      const events = [
        ...state.events.filter((e) => !knownEvents.has(e.id) && e.syncStatus !== 'SYNCED'),
        ...s.events,
      ];

      return {
        ...state,
        items: s.items,
        // RULE-002 : ce sont bien des mouvements qui arrivent, pas des niveaux.
        movements: s.movements,
        sales: s.sales,
        expenses: s.expenses,
        waste: s.waste,
        batches: s.batches,
        purchases: s.purchases,
        cashSession: s.cashSession ?? state.cashSession,
        notifications,
        // RLS ne montre l'audit qu'à l'encadrement : une liste vide côté serveur
        // veut souvent dire « pas le droit », pas « rien ne s'est passé ».
        audit: s.audit.length ? s.audit : state.audit,
        events,
        saleCounter: s.saleCounter,
        batchCounter: Math.max(state.batchCounter, s.batches.length),
      };
    }

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

    case 'RAISE':
      return {
        ...state,
        notifications: [...action.notifications, ...state.notifications],
        cooldowns: action.cooldowns,
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
  /** Connexion réelle. Disponible seulement quand le backend est configuré. */
  signIn: (email: string, password: string) => Promise<string | null>;
  /** Vrai tant que la session n'a pas été restaurée au démarrage. */
  authLoading: boolean;
  backendConfigured: boolean;
  /** Vrai pendant qu'un instantané PostgreSQL est en cours de chargement. */
  hydrating: boolean;
  /** Dernier instantané serveur appliqué. Null : l'app tourne sur son état local. */
  hydratedAt: string | null;
  syncNow: () => Promise<void>;
  /** Force un rechargement depuis PostgreSQL au prochain passage. */
  refresh: () => void;
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
    if (!saved) return base;
    /*
     * Un événement resté en SYNCING est un événement dont l'app est morte en
     * plein envoi. SYNCING ne fait pas partie des statuts réessayés : sans
     * cette remise à QUEUED il resterait invisible et jamais renvoyé.
     */
    const events = saved.events?.map((e) =>
      e.syncStatus === 'SYNCING' ? { ...e, syncStatus: 'QUEUED' as const } : e,
    );
    return { ...base, ...saved, ...(events ? { events } : {}) };
  });
  const [online, setOnline] = useState(navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  /* Profil issu de Supabase. Prend le pas sur les profils de démonstration. */
  const [remoteProfile, setRemoteProfile] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(isBackendConfigured);
  const [hydrating, setHydrating] = useState(false);
  const [hydratedAt, setHydratedAt] = useState<string | null>(null);
  /*
   * Signature des référentiels. Elle sert de clé de remontage : plusieurs
   * écrans figent un emplacement dans un `useState` au premier rendu, et ces
   * valeurs-là ne peuvent pas être corrigées par un simple nouveau rendu.
   */
  const [referentials, setReferentials] = useState(signature);
  const [refreshToken, setRefreshToken] = useState(0);
  /* Vrai tant qu'un instantané serveur reste à charger. */
  const stale = useRef(true);
  const hydratingRef = useRef(false);
  const syncingRef = useRef(false);
  /*
   * Dernière tentative d'envoi, par événement. Hors état React : c'est de la
   * mécanique de file, pas de l'information métier, et ce n'est volontairement
   * pas persisté — au redémarrage tout redevient immédiatement envoyable.
   */
  const lastAttemptAt = useRef(new Map<UUID, number>());
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

  /*
   * Le catalogue est indexé par son identifiant réel ET par l'identifiant de
   * démonstration correspondant : quelques écrans nomment encore un article en
   * dur (`items.get('it-vanilla')!`). L'article rendu est le vrai — seule la
   * clé de lecture est ancienne.
   */
  const itemsMap = useMemo(() => {
    const map = new Map<UUID, Item>(state.items.map((i) => [i.id, i]));
    for (const [legacy, real] of aliasEntries()) {
      const target = map.get(real);
      if (target && !map.has(legacy)) map.set(legacy, target);
    }
    return map;
  }, [state.items, referentials]);

  const stock = useMemo(() => projectStock(state.movements, itemsMap), [state.movements, itemsMap]);
  const user = useMemo(
    () => remoteProfile ?? USERS.find((u) => u.id === state.currentUserId) ?? null,
    [remoteProfile, state.currentUserId],
  );
  /* Organisation et site viennent du profil réel dès qu'il est connu (§73). */
  const orgId = user?.organizationId ?? SITE.organizationId;
  const siteId = user?.siteId ?? SITE.id;

  /* Reprise de session au démarrage — fonctionne aussi hors ligne, via le cache. */
  useEffect(() => {
    if (!isBackendConfigured) return;
    let cancelled = false;
    void restoreSession()
      .then((profile) => { if (!cancelled) setRemoteProfile(profile); })
      .finally(() => { if (!cancelled) setAuthLoading(false); });
    return () => { cancelled = true; };
  }, []);
  const pending = pendingEvents(state.events).length;

  const stockOf = useCallback(
    (rawItemId: UUID, rawLocationId?: UUID) => {
      const itemId = resolveId(rawItemId);
      const locationId = resolveId(rawLocationId);
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
      organizationId: orgId,
      siteId: siteId,
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
    [user, orgId, siteId],
  );

  const makeMovement = useCallback(
    (
      rawItemId: UUID, rawLocationId: UUID, quantity: number, unit: Unit,
      movementType: StockMovement['movementType'], referenceType: string, referenceId: UUID,
    ): StockMovement => ({
      id: uuid(),
      organizationId: orgId,
      siteId: siteId,
      // Un mouvement n'entre jamais en base avec un identifiant de démonstration.
      locationId: resolveId(rawLocationId),
      itemId: resolveId(rawItemId),
      quantity,
      unit,
      movementType,
      referenceType,
      referenceId,
      userId: user?.id ?? 'unknown',
      deviceId: deviceId(),
      createdAt: new Date().toISOString(),
    }),
    [user, orgId, siteId],
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
        itemId: resolveId(item.id),
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
        siteId: siteId,
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
          /*
           * Le payload porte TOUT ce dont `complete_sale` a besoin. Il ne
           * décrit pas seulement ce qui a été vendu : il décrit où, à quelle
           * caisse et comment c'est payé. Un payload incomplet ne se voit pas
           * localement — il ne se voit qu'en base, sous forme de vente absente.
           */
          makeEvent('SALE_COMPLETED', 'Sale', saleId, {
            number: sale.number,
            locationId: LOC.POS,
            cashSessionId: state.cashSession.id,
            paymentMethod,
            amountReceived,
            total,
            cogs,
            lines,
          }),
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
    [user, siteId, state.saleCounter, state.cashSession.id, makeEvent, makeMovement, makeAudit],
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
    ({ itemId: rawItemId, recipeVersionId, planned, produced, loss, locationId: rawLocationId }) => {
      const version = RECIPE_VERSIONS.find((v) => v.id === recipeVersionId);
      if (!version || !user) return;

      // L'écran de production nomme encore le produit en dur : on le traduit.
      const itemId = resolveId(rawItemId);
      const locationId = resolveId(rawLocationId);
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
    ({ itemId: rawItemId, locationId: rawLocationId, quantity, reason }) => {
      const item = itemsMap.get(rawItemId);
      if (!item) return;
      const itemId = resolveId(rawItemId);
      const locationId = resolveId(rawLocationId);
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
    ({ supplierId: rawSupplierId, locationId: rawLocationId, lines, transportCost, paymentMethod }) => {
      if (!lines.length) return;
      const supplierId = resolveId(rawSupplierId);
      const locationId = resolveId(rawLocationId);
      const purchaseId = uuid();
      const goods = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);

      const movements: StockMovement[] = [];
      const itemCosts: { itemId: UUID; cost: number }[] = [];
      /* Lignes telles qu'elles partiront au serveur : identifiants réels, unité incluse. */
      const eventLines: { itemId: UUID; quantity: number; unit: Unit; unitPrice: number }[] = [];

      for (const line of lines) {
        const item = itemsMap.get(line.itemId);
        if (!item || line.quantity <= 0) continue;
        const itemId = resolveId(line.itemId);

        movements.push(
          makeMovement(
            itemId, locationId, line.quantity, item.unit,
            'PURCHASE_RECEIPT', 'GoodsReceipt', purchaseId,
          ),
        );

        eventLines.push({ itemId, quantity: line.quantity, unit: item.unit, unitPrice: line.unitPrice });

        // §40 — le nouveau coût moyen se calcule sur le stock AVANT réception.
        const currentQty = stock.get(`${itemId}@${locationId}`) ?? 0;
        itemCosts.push({
          itemId,
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
          lines: eventLines.map((l) => ({
            itemId: l.itemId,
            quantity: l.quantity,
            unit: l.unit,
            actualUnitPrice: l.unitPrice,
            expectedUnitPrice: itemsMap.get(l.itemId)?.weightedAvgCost,
          })),
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
        events: [
          makeEvent('GOODS_RECEIVED', 'GoodsReceipt', purchaseId, {
            supplierId, locationId, paymentMethod, transportCost, lines: eventLines,
          }),
        ],
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

  /* ------------------------------------------------------- Alertes */

  /**
   * Les alertes ne sont pas écrites à la main : elles découlent de l'état.
   * On réévalue après chaque mouvement, vente ou perte ; le moteur applique
   * lui-même le cooldown et refuse de répéter ce qui a déjà été dit.
   */
  useEffect(() => {
    const soldToday = new Map<UUID, number>();
    for (const sale of state.sales) {
      if (sale.status !== 'COMPLETED') continue;
      for (const line of sale.lines) {
        soldToday.set(line.itemId, (soldToday.get(line.itemId) ?? 0) + line.quantity);
      }
    }

    const cashSales = state.sales
      .filter((s) => s.status === 'COMPLETED' && s.paymentMethod === 'CASH')
      .reduce((sum, s) => sum + s.total, 0);
    const cashVariance =
      state.cashSession.countedCash === null
        ? null
        : state.cashSession.countedCash - (state.cashSession.openingCash + cashSales);

    const { notifications, cooldowns } = evaluateRules(
      {
        items: state.items,
        stockOf: (itemId) => {
          let total = 0;
          for (const [key, value] of stock) if (key.startsWith(`${itemId}@`)) total += value;
          return total;
        },
        soldToday,
        cashVariance,
        wasteCostToday: state.waste.reduce((sum, w) => sum + w.cost, 0),
      },
      state.cooldowns,
    );

    if (notifications.length) dispatch({ type: 'RAISE', notifications, cooldowns });
  }, [state.items, state.sales, state.waste, state.cashSession, state.cooldowns, stock]);

  /* ----------------------------------------------------------- Sync */

  const syncNow = useCallback(async () => {
    // Le verrou est un ref, pas un état : deux déclencheurs (retour de réseau et
    // timer) peuvent tomber dans le même tour de rendu, avant que `syncing` ne
    // soit repeint — et enverraient alors la même vente deux fois.
    if (syncingRef.current || !navigator.onLine) return;
    const queue = dueEvents(state.events, lastAttemptAt.current);
    if (!queue.length) return;

    syncingRef.current = true;
    setSyncing(true);
    const startedAt = Date.now();
    for (const event of queue) lastAttemptAt.current.set(event.id, startedAt);
    dispatch({ type: 'SET_SYNC', ids: queue.map((e) => e.id), status: 'SYNCING' });

    try {
      const transport = selectTransport(isBackendConfigured, supabaseTransport);
      const { acceptedIds, failedIds, conflictIds = [] } = await transport(queue);

      if (acceptedIds.length) {
        dispatch({ type: 'SET_SYNC', ids: acceptedIds, status: 'SYNCED' });
        for (const id of acceptedIds) lastAttemptAt.current.delete(id);
        // Ce que le serveur vient d'accepter, il l'a peut-être enrichi
        // (numéro de vente, coût moyen recalculé) : on redemandera l'état.
        stale.current = true;
      }
      // Réessayable : réseau coupé, serveur indisponible.
      if (failedIds.length) dispatch({ type: 'SET_SYNC', ids: failedIds, status: 'FAILED' });
      // Refusé pour une raison métier : rejouer donnerait le même refus.
      if (conflictIds.length) dispatch({ type: 'SET_SYNC', ids: conflictIds, status: 'CONFLICT' });

      setLastSyncAt(new Date().toISOString());
    } catch {
      dispatch({ type: 'SET_SYNC', ids: queue.map((e) => e.id), status: 'FAILED' });
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [state.events]);

  /* ---------------------------------------------------- Hydratation */

  /**
   * Chargement de l'état réel depuis PostgreSQL.
   *
   * Deux règles gouvernent ce bloc.
   *
   * D'abord, on n'attend jamais le réseau pour afficher : l'état local est déjà
   * à l'écran quand cette fonction démarre, et il le reste si elle échoue.
   *
   * Ensuite, on ne remplace l'état local que lorsque la file d'attente est
   * vide. Sinon, une vente saisie hors ligne et pas encore partie serait
   * effacée par un instantané serveur qui ne la connaît pas encore.
   */
  useEffect(() => {
    if (!isBackendConfigured || !remoteProfile || !online) return;
    if (!stale.current || hydratingRef.current) return;
    if (pending > 0) return;

    hydratingRef.current = true;
    setHydrating(true);
    let cancelled = false;

    void fetchSnapshot(remoteProfile)
      .then((snapshot) => {
        if (cancelled || !snapshot) return;

        // Les référentiels d'abord : les écrans lisent LOC/LOCATIONS/SUPPLIERS
        // comme des constantes de module, il faut qu'ils soient à jour avant
        // que le nouvel état ne s'affiche.
        const next = applyReferentials({
          site: snapshot.site,
          locations: snapshot.locations,
          suppliers: snapshot.suppliers,
          users: snapshot.users,
          items: snapshot.items,
        });

        dispatch({ type: 'HYDRATE_SNAPSHOT', snapshot });
        stale.current = false;
        setHydratedAt(new Date().toISOString());
        setReferentials(next);

        // Contrôle croisé : la vue `stock_levels` est un second témoin, jamais
        // une source (RULE-002). Un désaccord signale une troncature des
        // mouvements ou une conversion d'unité qui diverge entre SQL et TS.
        const byId = new Map(snapshot.items.map((i) => [i.id, i]));
        const gaps = crossCheckStock(projectStock(snapshot.movements, byId), snapshot.stockLevels);
        if (gaps.length || snapshot.problems.length) {
          console.warn('[BUNA] hydratation incomplète', { gaps, problems: snapshot.problems });
        }
      })
      .finally(() => {
        hydratingRef.current = false;
        if (!cancelled) setHydrating(false);
      });

    return () => { cancelled = true; };
  }, [remoteProfile, online, pending]);

  const refresh = useCallback(() => { stale.current = true; }, []);

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
    logout: () => {
      setRemoteProfile(null);
      void authSignOut();
      dispatch({ type: 'LOGOUT' });
    },
    signIn: async (email, password) => {
      const { profile, error } = await authSignIn(email, password);
      if (profile) setRemoteProfile(profile);
      return error;
    },
    authLoading,
    backendConfigured: isBackendConfigured,
    syncNow, completeSale, voidSale, completeBatch, recordWaste, transferStock,
    recordExpense, receiveGoods, closeCashSession, setNotificationStatus, stockOf,
    saveItem, archiveItem, adjustStock,
  };

  return <BunaContext.Provider value={value}>{children}</BunaContext.Provider>;
}

export { LOC, LOCATIONS, RECIPES, RECIPE_VERSIONS, SUPPLIERS, SITE, ITEMS };
export { convert, weightedAverageCost };
