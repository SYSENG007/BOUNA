import {
  createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef,
  useState, type ReactNode,
} from 'react';
import type {
  AuditEvent, CashSession, DomainEvent, Expense, Item, Notification, PaymentMethod,
  ProductionBatch, Purchase, Sale, SaleLine, StockMovement, User, UUID,
  WasteEvent, WasteReason, Unit, EventType, StockLocation, Recipe, RecipeVersion,
} from '../domain/types';

import { deviceId, uuid, batchCode } from '../domain/ids';
import type { Capability, CapabilityGrant } from '../domain/capabilities';
import { CAPABILITY_LABEL, effectiveCapabilities } from '../domain/capabilities';
import type { Actor } from '../domain/actor';
import { makeActor } from '../domain/actor';
import type { Resolution, Variance } from '../domain/variance';
import { RESOLUTION_LABEL, VARIANCE_SOURCE_LABEL, resolve as resolveVarianceFact } from '../domain/variance';
import { convert } from '../domain/units';
import { projectStock, sourceLocation, weightedAverageCost } from '../domain/stock';
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
  ITEMS, SEED_AUDIT, SEED_CASH_SESSION, SEED_EXPENSES, SEED_GRANTS, SEED_MOVEMENTS,
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
  /** Le journal des délégations. Révoquer ajoute une date, n'efface pas la ligne. */
  grants: CapabilityGrant[];
  /** Écarts constatés, soldés ou non. Un écart ouvert remonte au tableau de bord. */
  variances: Variance[];
}

export const initialState: State = {
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
  grants: SEED_GRANTS,
  variances: [],
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
      variances?: Variance[];
    }
  | { type: 'SAVE_ITEM'; item: Item }
  | { type: 'SET_SYNC'; ids: UUID[]; status: DomainEvent['syncStatus'] }
  | { type: 'NOTIFICATION_STATUS'; id: UUID; status: Notification['status'] }
  | { type: 'RAISE'; notifications: Notification[]; cooldowns: Cooldowns }
  | { type: 'GRANT'; grants: CapabilityGrant[] }
  | { type: 'REVOKE'; userId: UUID; capabilities: Capability[]; by: Actor }
  | { type: 'RESOLVE_VARIANCE'; varianceId: UUID; resolution: Resolution; note?: string; by: Actor };

export function reducer(state: State, action: Action): State {
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
        variances: a.variances?.length ? [...a.variances, ...state.variances] : state.variances,
      };
    }

    case 'GRANT':
      return { ...state, grants: [...state.grants, ...action.grants] };

    case 'REVOKE': {
      /*
       * On ne retire pas la ligne : on la date. Le droit cesse, l'historique
       * reste — sinon « qui avait le droit le 12 août ? » devient insoluble.
       */
      const at = new Date().toISOString();
      return {
        ...state,
        grants: state.grants.map((g) =>
          g.userId === action.userId && !g.revokedAt && action.capabilities.includes(g.capability)
            ? { ...g, revokedAt: at, revokedBy: action.by.userId, revokedByName: action.by.userName }
            : g,
        ),
      };
    }

    case 'RESOLVE_VARIANCE':
      return {
        ...state,
        variances: state.variances.map((v) => {
          if (v.id !== action.varianceId) return v;
          // Un écart déjà soldé ne se resolde pas : le premier motif fait foi.
          return resolveVarianceFact(v, action.resolution, action.by, action.note) ?? v;
        }),
      };

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
  /** Ce que l'utilisateur courant a le droit de faire. Revalidé par RLS. */
  can: (capability: Capability) => boolean;
  /** Le journal des délégations — accords et révocations, datés et signés. */
  grants: CapabilityGrant[];
  /** Écarts constatés. Ouverts tant que personne ne les a soldés. */
  variances: Variance[];
  /** Accorde des capacités à quelqu'un. Réservé à MANAGE_TEAM. */
  grantCapabilities: (userId: UUID, capabilities: Capability[]) => boolean;
  /** Retire des capacités. La ligne reste, sa révocation est datée. */
  revokeCapabilities: (userId: UUID, capabilities: Capability[]) => boolean;
  /** Solde un écart avec un motif. Réservé à RESOLVE_VARIANCE. */
  resolveVariance: (varianceId: UUID, resolution: Resolution, note?: string) => boolean;
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
  recordExpense: (input: Omit<Expense, 'id' | 'userId' | 'createdAt' | 'actor'>) => void;
  /** Crée ou met à jour un article du catalogue. */
  saveItem: (item: Item) => void;
  saveLocation: (location: StockLocation) => void;
  saveRecipe: (recipe: Recipe, version: RecipeVersion) => void;
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
  const user = useMemo(() => {
    const base = remoteProfile ?? USERS.find((u) => u.id === state.currentUserId) ?? null;
    if (!base) return null;
    /*
     * Les accords font foi sur le jeu figé du profil : c'est eux que le manager
     * modifie à l'écran Équipe, et le changement doit se voir immédiatement,
     * sans attendre un aller-retour serveur.
     */
    const granted = effectiveCapabilities(state.grants, base.id);
    return granted.length ? { ...base, capabilities: granted } : base;
  }, [remoteProfile, state.currentUserId, state.grants]);
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

  /*
   * L'ordre de service. Le comptoir d'abord — c'est là qu'on vend — puis le
   * frigo, la cuisine, le stock principal.
   */
  const SERVE_ORDER = useMemo(() => [LOC.POS, LOC.FRIDGE, LOC.KITCHEN, LOC.CENTRAL], []);

  /** Où prendre `quantity` de `itemId`, en préférant `preferred` s'il suffit. */
  const sourceFor = useCallback(
    (itemId: UUID, quantity: number, preferred?: UUID) =>
      sourceLocation((loc) => stockOf(itemId, loc), SERVE_ORDER, quantity, preferred),
    [stockOf, SERVE_ORDER],
  );

  /* ------------------------------------------------------- Fabriques */

  /**
   * Autorise une opération et rend son tampon d'auteur.
   *
   * Les deux gestes sont volontairement inséparables : il ne doit pas être
   * possible d'écrire une transaction qui trace sans avoir vérifié, ni qui
   * vérifie sans tracer. `null` veut dire « pas le droit » — et la transaction
   * s'arrête là. Le serveur revérifie de toute façon : ceci évite d'afficher
   * un succès que PostgreSQL refusera.
   */
  const authorize = useCallback(
    (under: Capability): Actor | null => {
      if (!user || !user.capabilities.includes(under)) return null;
      return makeActor({
        userId: user.id,
        userName: user.name,
        post: user.post,
        under,
        deviceId: deviceId(),
      });
    },
    [user],
  );

  const can = useCallback(
    (capability: Capability) => !!user?.capabilities.includes(capability),
    [user],
  );

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
      actor: Actor,
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
      userId: actor.userId,
      deviceId: actor.deviceId,
      createdAt: actor.at,
      actor,
    }),
    [orgId, siteId],
  );

  const makeAudit = useCallback(
    (actor: Actor, action: string, detail: string, reference?: string): AuditEvent => ({
      id: uuid(),
      actor,
      action,
      detail,
      reference,
      createdAt: actor.at,
    }),
    [],
  );

  /* ---------------------------------------------------- Transactions */

  const completeSale = useCallback<Ctx['completeSale']>(
    (cartLines, paymentMethod, amountReceived) => {
      const actor = authorize('SELL');
      if (!cartLines.length || !user || !actor) return null;

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
        createdAt: actor.at,
        actor,
      };

      // Sale + SaleLines + Payment + StockMovements + COGS + Audit + DomainEvent,
      // ensemble ou pas du tout.
      dispatch({
        type: 'COMMIT',
        sale,
        bumpSale: true,
        /* On ne déduit plus d'un LOC.POS supposé : la production livre au
           frigo, et le comptoir plongeait en négatif pendant que la
           marchandise attendait à côté. */
        movements: lines.map((l) =>
          makeMovement(
            l.itemId, sourceFor(l.itemId, l.quantity, LOC.POS), -l.quantity,
            'unite', 'SALE', 'Sale', saleId, actor,
          ),
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
            actor,
            `Vente #${sale.number} — ${total} FCFA`,
            `${lines.map((l) => `${l.quantity} ${l.name}`).join(', ')} · ${paymentMethod}`,
            `sale:${sale.number}`,
          ),
        ],
      });

      return sale;
    },
    [user, siteId, state.saleCounter, state.cashSession.id, authorize, makeEvent, makeMovement, makeAudit, sourceFor],
  );

  const voidSale = useCallback<Ctx['voidSale']>(
    (saleId, reason) => {
      const actor = authorize('VOID_SALE');
      const sale = state.sales.find((s) => s.id === saleId);
      if (!sale || sale.status !== 'COMPLETED' || !actor) return;

      // RULE-001 : rien n'est supprimé. On compense par des mouvements inverses.
      dispatch({
        type: 'COMMIT',
        movements: sale.lines.map((l) =>
          makeMovement(l.itemId, LOC.POS, l.quantity, 'unite', 'RETURN', 'SaleVoid', saleId, actor),
        ),
        events: [makeEvent('SALE_CANCELLED', 'Sale', saleId, { reason })],
        audit: [makeAudit(actor, `Annulation vente #${sale.number}`, `motif : ${reason} · validée`, `sale:${sale.number}`)],
      });
    },
    [state.sales, authorize, makeEvent, makeMovement, makeAudit],
  );

  const completeBatch = useCallback<Ctx['completeBatch']>(
    ({ itemId: rawItemId, recipeVersionId, planned, produced, loss, locationId: rawLocationId }) => {
      const actor = authorize('PRODUCE');
      const version = RECIPE_VERSIONS.find((v) => v.id === recipeVersionId);
      if (!version || !user || !actor) return;

      // L'écran de production nomme encore le produit en dur : on le traduit.
      const itemId = resolveId(rawItemId);
      const locationId = resolveId(rawLocationId);
      const id = uuid();
      const code = batchCode(new Date(), state.batchCounter + 1);

      // Consommation déduite de la recette : l'utilisateur déclare 27 unités,
      // le système sait ce que ça a coûté en lait, café, gobelets.
      const consumption = version.ingredients.map((ing) =>
        makeMovement(
          /* La cuisine était codée en dur. Le lait est au frigo : la cuisine
             passait en négatif et le frigo restait plein.
             La quantité est convertie dans l'unité de l'ARTICLE avant d'être
             comparée au stock — 3960 mL face à 6,2 L, comparés bruts, ne
             désignent jamais le bon emplacement. */
          ing.itemId,
          sourceFor(
            ing.itemId,
            convert(ing.quantity * produced, ing.unit, itemsMap.get(ing.itemId)?.unit ?? ing.unit),
            LOC.KITCHEN,
          ),
          -(ing.quantity * produced), ing.unit,
          'PRODUCTION_CONSUMPTION', 'ProductionBatch', id, actor,
        ),
      );
      const output = makeMovement(
        itemId, locationId, produced, 'unite', 'PRODUCTION_OUTPUT', 'ProductionBatch', id, actor,
      );

      const batch: ProductionBatch = {
        id, code, itemId, recipeVersionId, preparerId: user.id, locationId,
        plannedQuantity: planned, producedQuantity: produced, lossQuantity: loss,
        startedAt: actor.at, completedAt: actor.at, actor,
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
        audit: [makeAudit(actor, `Batch ${code}`, `${produced}/${planned} unités · rendement ${yieldPct} %`, `batch:${code}`)],
        /*
         * Un rendement inférieur au plan est un écart, pas une fatalité : il
         * ouvre une question à laquelle quelqu'un devra répondre.
         */
        variances: loss > 0
          ? [{
              id: uuid(),
              source: 'YIELD' as const,
              reference: id,
              subject: `Batch ${code}`,
              theoretical: planned,
              declared: produced,
              delta: produced - planned,
              amount: Math.round(loss * (itemsMap.get(itemId)?.weightedAvgCost ?? 0)),
              actor,
              resolution: null,
              resolver: null,
              createdAt: actor.at,
            }]
          : undefined,
      });
    },
    [user, state.batchCounter, itemsMap, authorize, makeEvent, makeMovement, makeAudit, sourceFor],
  );

  const recordWaste = useCallback<Ctx['recordWaste']>(
    ({ itemId: rawItemId, locationId: rawLocationId, quantity, reason }) => {
      const actor = authorize('RECORD_WASTE');
      const item = itemsMap.get(rawItemId);
      if (!item || !actor) return;
      const itemId = resolveId(rawItemId);
      const locationId = resolveId(rawLocationId);
      const id = uuid();
      const cost = quantity * (item.weightedAvgCost ?? 0);

      dispatch({
        type: 'COMMIT',
        waste: {
          id, itemId, locationId, quantity, unit: item.unit, cost, reason,
          userId: actor.userId, createdAt: actor.at, actor,
        },
        movements: [makeMovement(itemId, locationId, -quantity, item.unit, 'WASTE', 'WasteEvent', id, actor)],
        events: [makeEvent('WASTE_RECORDED', 'WasteEvent', id, { itemId, quantity, cost, reason })],
        audit: [makeAudit(actor, `Perte déclarée — ${item.name}`, `${quantity} ${item.unit} · motif : ${reason} · ${Math.round(cost)} FCFA`)],
      });
    },
    [itemsMap, authorize, makeEvent, makeMovement, makeAudit],
  );

  const transferStock = useCallback<Ctx['transferStock']>(
    ({ itemId, from, to, quantity }) => {
      const actor = authorize('TRANSFER_STOCK');
      const item = itemsMap.get(itemId);
      if (!item || quantity <= 0 || !actor) return;
      // §30 — deux mouvements cohérents partageant le même transfer_id.
      const transferId = uuid();
      dispatch({
        type: 'COMMIT',
        movements: [
          makeMovement(itemId, from, -quantity, item.unit, 'TRANSFER_OUT', 'Transfer', transferId, actor),
          makeMovement(itemId, to, quantity, item.unit, 'TRANSFER_IN', 'Transfer', transferId, actor),
        ],
        events: [makeEvent('STOCK_TRANSFERRED', 'Transfer', transferId, { itemId, from, to, quantity })],
        audit: [makeAudit(actor, `Transfert — ${item.name}`, `${quantity} ${item.unit}`)],
      });
    },
    [itemsMap, authorize, makeEvent, makeMovement, makeAudit],
  );

  const recordExpense = useCallback<Ctx['recordExpense']>(
    (input) => {
      const actor = authorize('RECORD_EXPENSE');
      if (!actor) return;
      const id = uuid();
      dispatch({
        type: 'COMMIT',
        expense: { ...input, id, userId: actor.userId, createdAt: actor.at, actor },
        events: [makeEvent('EXPENSE_RECORDED', 'Expense', id, input)],
        audit: [makeAudit(actor, `Dépense — ${input.description}`, `${input.amount} FCFA · ${input.category}`)],
      });
    },
    [authorize, makeEvent, makeAudit],
  );

  const saveItem = useCallback<Ctx['saveItem']>(
    (item) => {
      const actor = authorize('MANAGE_CATALOG');
      if (!actor) return;
      const isNew = !itemsMap.has(item.id);
      dispatch({ type: 'SAVE_ITEM', item });
      dispatch({
        type: 'COMMIT',
        audit: [
          makeAudit(
            actor,
            isNew ? `Article créé — ${item.name}` : `Article modifié — ${item.name}`,
            `${item.kind} · ${item.unit}${item.price ? ` · ${item.price} FCFA` : ''}`,
            `item:${item.id.slice(0, 8)}`,
          ),
        ],
      });
    },
    [itemsMap, authorize, makeAudit],
  );

  const saveLocation = useCallback((location: StockLocation) => {
    const exists = LOCATIONS.some((l) => l.id === location.id);
    const updated = exists
      ? LOCATIONS.map((l) => (l.id === location.id ? location : l))
      : [...LOCATIONS, location];
    const next = applyReferentials({ site: null, locations: updated, suppliers: [], users: [], items: [] });
    setReferentials(next);
  }, []);

  const saveRecipe = useCallback((recipe: Recipe, version: RecipeVersion) => {
    const rExists = RECIPES.some((r) => r.id === recipe.id);
    const updatedRecipes = rExists
      ? RECIPES.map((r) => (r.id === recipe.id ? recipe : r))
      : [...RECIPES, recipe];

    const vExists = RECIPE_VERSIONS.some((v) => v.id === version.id);
    const updatedVersions = vExists
      ? RECIPE_VERSIONS.map((v) => (v.id === version.id ? version : v))
      : [...RECIPE_VERSIONS, version];

    const next = applyReferentials({
      site: null,
      locations: [],
      suppliers: [],
      users: [],
      items: [],
      recipes: updatedRecipes,
      recipeVersions: updatedVersions,
    });
    setReferentials(next);
  }, []);

  const archiveItem = useCallback<Ctx['archiveItem']>(
    (itemId) => {
      const actor = authorize('MANAGE_CATALOG');
      const item = itemsMap.get(itemId);
      if (!item || !actor) return;
      dispatch({ type: 'SAVE_ITEM', item: { ...item, archived: true } });
      dispatch({
        type: 'COMMIT',
        audit: [makeAudit(actor, `Article archivé — ${item.name}`, 'retiré du catalogue, historique conservé')],
      });
    },
    [itemsMap, authorize, makeAudit],
  );

  const adjustStock = useCallback<Ctx['adjustStock']>(
    ({ itemId, locationId, countedQuantity, reason }) => {
      const actor = authorize('COUNT_INVENTORY');
      const item = itemsMap.get(itemId);
      if (!item || !actor) return;

      const theoretical = stock.get(`${itemId}@${locationId}`) ?? 0;
      const delta = countedQuantity - theoretical;
      // Pas d'écart, pas de mouvement : un comptage conforme ne pollue pas le journal.
      if (Math.abs(delta) < 0.0001) return;

      const countId = uuid();
      dispatch({
        type: 'COMMIT',
        movements: [
          makeMovement(itemId, locationId, delta, item.unit, 'ADJUSTMENT', 'InventoryCount', countId, actor),
        ],
        events: [
          makeEvent('STOCK_COUNTED', 'InventoryCount', countId, {
            itemId, locationId, theoretical, counted: countedQuantity, delta, reason,
          }),
        ],
        audit: [
          makeAudit(
            actor,
            `Inventaire — ${item.name}`,
            `théorique ${theoretical.toFixed(2)} · compté ${countedQuantity} · écart ${delta > 0 ? '+' : ''}${delta.toFixed(2)} ${item.unit} · motif : ${reason}`,
          ),
        ],
        /*
         * L'écart d'inventaire ouvre une question chiffrée. Tant qu'il n'est pas
         * soldé, il remonte au tableau de bord — c'est la boucle qui manquait.
         */
        variances: [{
          id: uuid(),
          source: 'STOCK' as const,
          reference: countId,
          subject: item.name,
          theoretical,
          declared: countedQuantity,
          delta,
          amount: Math.abs(Math.round(delta * (item.weightedAvgCost ?? 0))),
          actor,
          resolution: null,
          resolver: null,
          createdAt: actor.at,
        }],
      });
    },
    [itemsMap, stock, authorize, makeEvent, makeMovement, makeAudit],
  );

  const receiveGoods = useCallback<Ctx['receiveGoods']>(
    ({ supplierId: rawSupplierId, locationId: rawLocationId, lines, transportCost, paymentMethod }) => {
      const actor = authorize('RECEIVE_GOODS');
      if (!lines.length || !actor) return;
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
            'PURCHASE_RECEIPT', 'GoodsReceipt', purchaseId, actor,
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
      const itemNames = Array.from(new Set(eventLines.map(l => itemsMap.get(l.itemId)?.name).filter(Boolean))).join(', ');

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
          createdAt: actor.at,
          receivedAt: actor.at,
          actor,
        },
        // §39 — la marchandise entre en stock, le transport est une charge directe.
        expense: {
          id: uuid(),
          amount: goods + transportCost,
          category: 'MATIERE',
          description: itemNames ? `Achat ${itemNames}` : `Achat — ${supplierName}`,
          supplierId,
          paymentMethod,
          userId: actor.userId,
          createdAt: actor.at,
          actor,
        },
        events: [
          makeEvent('GOODS_RECEIVED', 'GoodsReceipt', purchaseId, {
            supplierId, locationId, paymentMethod, transportCost, lines: eventLines,
          }),
        ],
        audit: [
          makeAudit(
            actor,
            `Réception — ${supplierName}`,
            `${lines.length} ligne(s) · ${goods + transportCost} FCFA`,
            `purchase:${purchaseId.slice(0, 8)}`,
          ),
        ],
      });
    },
    [itemsMap, stock, authorize, makeEvent, makeMovement, makeAudit],
  );

  const closeCashSession = useCallback<Ctx['closeCashSession']>(
    (countedCash, reason) => {
      const actor = authorize('MANAGE_CASH_SESSION');
      if (!actor) return;
      const session = { ...state.cashSession, countedCash, closedAt: actor.at, varianceReason: reason };
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
            actor,
            `Clôture shift #${session.shiftNumber} — écart ${variance >= 0 ? '+' : ''}${variance} FCFA`,
            reason ? `motif : ${reason} · en attente manager` : 'sans écart',
          ),
        ],
        /* Un tiroir qui ne tombe pas juste est une question, pas un constat. */
        variances: variance !== 0
          ? [{
              id: uuid(),
              source: 'CASH' as const,
              reference: session.id,
              subject: `Shift #${session.shiftNumber}`,
              theoretical: expected,
              declared: countedCash,
              delta: variance,
              amount: Math.abs(variance),
              actor,
              resolution: null,
              resolver: null,
              createdAt: actor.at,
            }]
          : undefined,
      });
    },
    [state.cashSession, state.sales, authorize, makeEvent, makeAudit],
  );

  const setNotificationStatus = useCallback<Ctx['setNotificationStatus']>((id, status) => {
    dispatch({ type: 'NOTIFICATION_STATUS', id, status });
  }, []);

  /* ------------------------------------------------------ Délégation */

  const grantCapabilities = useCallback<Ctx['grantCapabilities']>(
    (userId, capabilities) => {
      const actor = authorize('MANAGE_TEAM');
      if (!actor || !capabilities.length) return false;

      // Accorder deux fois la même capacité créerait deux accords actifs, donc
      // deux révocations à faire pour retirer un seul droit.
      const active = new Set(effectiveCapabilities(state.grants, userId));
      const fresh = capabilities.filter((c) => !active.has(c));
      if (!fresh.length) return false;

      const target = USERS.find((u) => u.id === userId);
      dispatch({
        type: 'GRANT',
        grants: fresh.map((capability) => ({
          id: uuid(),
          userId,
          capability,
          grantedBy: actor.userId,
          grantedByName: actor.userName,
          grantedAt: actor.at,
        })),
      });
      dispatch({
        type: 'COMMIT',
        audit: [makeAudit(
          actor,
          `Accès accordés — ${target?.name ?? 'membre'}`,
          fresh.map((c) => CAPABILITY_LABEL[c].toLowerCase()).join(', '),
          `team:${userId.slice(0, 8)}`,
        )],
      });
      return true;
    },
    [state.grants, authorize, makeAudit],
  );

  const revokeCapabilities = useCallback<Ctx['revokeCapabilities']>(
    (userId, capabilities) => {
      const actor = authorize('MANAGE_TEAM');
      if (!actor || !capabilities.length) return false;
      /*
       * Personne ne se retire MANAGE_TEAM à soi-même : l'organisation se
       * retrouverait sans personne pour redonner le droit.
       */
      const guarded = capabilities.filter(
        (c) => !(userId === actor.userId && c === 'MANAGE_TEAM'),
      );
      if (!guarded.length) return false;

      const target = USERS.find((u) => u.id === userId);
      dispatch({ type: 'REVOKE', userId, capabilities: guarded, by: actor });
      dispatch({
        type: 'COMMIT',
        audit: [makeAudit(
          actor,
          `Accès retirés — ${target?.name ?? 'membre'}`,
          guarded.map((c) => CAPABILITY_LABEL[c].toLowerCase()).join(', '),
          `team:${userId.slice(0, 8)}`,
        )],
      });
      return true;
    },
    [authorize, makeAudit],
  );

  /* --------------------------------------------------- Recouvrement */

  const resolveVariance = useCallback<Ctx['resolveVariance']>(
    (varianceId, resolution, note) => {
      const actor = authorize('RESOLVE_VARIANCE');
      const target = state.variances.find((v) => v.id === varianceId);
      if (!actor || !target || target.resolution !== null) return false;

      dispatch({ type: 'RESOLVE_VARIANCE', varianceId, resolution, note, by: actor });
      dispatch({
        type: 'COMMIT',
        events: [makeEvent('STOCK_VARIANCE_DETECTED', 'Variance', varianceId, {
          source: target.source, delta: target.delta, amount: target.amount, resolution, note,
        })],
        audit: [makeAudit(
          actor,
          `Écart soldé — ${target.subject}`,
          `${VARIANCE_SOURCE_LABEL[target.source].toLowerCase()} · ${target.amount} FCFA · ${RESOLUTION_LABEL[resolution].toLowerCase()}${note ? ` · ${note}` : ''}`,
        )],
      });
      return true;
    },
    [state.variances, authorize, makeEvent, makeAudit],
  );

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
    can, grants: state.grants, variances: state.variances,
    grantCapabilities, revokeCapabilities, resolveVariance,
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
    hydrating,
    hydratedAt,
    refresh,
    syncNow, completeSale, voidSale, completeBatch, recordWaste, transferStock,
    recordExpense, receiveGoods, closeCashSession, setNotificationStatus, stockOf,
    saveItem, archiveItem, adjustStock, saveLocation, saveRecipe,
  };

  return <BunaContext.Provider value={value}>{children}</BunaContext.Provider>;
}

export { LOC, LOCATIONS, RECIPES, RECIPE_VERSIONS, SUPPLIERS, SITE, ITEMS };
export { convert, weightedAverageCost };
