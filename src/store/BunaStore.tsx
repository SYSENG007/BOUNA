import {
  createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef,
  useState, type ReactNode,
} from 'react';
import type {
  AuditEvent, CashSession, DomainEvent, Expense, Item, Notification, PaymentMethod,
  ProductionBatch, Purchase, Sale, SaleLine, StockMovement, User, UUID,
  WasteEvent, WasteReason, Unit, EventType, StockLocation, Recipe, RecipeVersion,
} from '../domain/types';

import { isMadeToOrder } from '../domain/types';
import { deviceId, uuid, batchCode } from '../domain/ids';
import type { Capability, CapabilityGrant } from '../domain/capabilities';
import { CAPABILITY_LABEL, backfillGrants, effectiveCapabilities } from '../domain/capabilities';
import type { Actor } from '../domain/actor';
import { makeActor } from '../domain/actor';
import type { Resolution, Variance } from '../domain/variance';
import { RESOLUTION_LABEL, VARIANCE_SOURCE_LABEL, resolve as resolveVarianceFact } from '../domain/variance';
import { convert, canConvert } from '../domain/units';
import { projectStock, sourceLocation, unitMismatches, weightedAverageCost } from '../domain/stock';
import { consumedBy } from '../domain/production';

/**
 * Vrai si l'article a une unité connue, de la même famille que la ligne.
 *
 * Sans ce garde-fou, une recette exprimée en mL pour un article repassé en
 * kilos faisait lever `convert()` en plein rendu — donc bien au-dessus des
 * limites d'écran, là où plus aucune reprise n'est possible.
 */
function convertible(from: Unit, to: Unit | undefined): to is Unit {
  return to !== undefined && canConvert(from, to);
}
import { awaitingAnotherOrg, dueEvents, ofOrg, pendingEvents, selectTransport } from './outbox';
import { isBackendConfigured } from '../backend/supabase';
import { loadProfile, restoreSession, signIn as authSignIn, signOut as authSignOut } from '../backend/auth';
import {
  enterSimulation as rpcEnter, leaveSimulation as rpcLeave, purgeSimulation as rpcPurge,
  type SimulationOutcome,
} from '../backend/simulation';
import { isSimulation } from '../domain/simulation';
import { supabaseTransport } from '../backend/transport';
import { crossCheckStock, fetchSnapshot, type Snapshot } from '../backend/hydrate';
import { itemRow, recipeRows } from '../backend/mappers';
import { evaluateRules, type Cooldowns } from '../domain/rules';
import {
  DEFAULT_OPERATING_MODE, OPERATING_MODE_LABEL, policyOf,
  type OperatingMode, type OperatingPolicy,
} from '../domain/operating-mode';
import {
  businessDateOf, closingContext, completeStep, revertStep, startClosing,
  type ClosingContext, type ClosingDeclaration, type ClosingSession, type DayClosure,
} from '../domain/closing';
import { loadState, saveState } from './persist';
import { loadOutbox, mergeOutbox, mirrorOutbox } from './outbox-store';
import {
  applyReferentials, aliasEntries, resolveId, signature,
  LOC, LOCATIONS, RECIPES, RECIPE_VERSIONS, SITE, SUPPLIERS, USERS,
} from './referentials';
import {
  ITEMS, SEED_AUDIT, SEED_CASH_SESSION, SEED_EXPENSES, SEED_GRANTS, SEED_MOVEMENTS,
  SEED_NOTIFICATIONS, SEED_PURCHASES,
} from '../domain/seed';

/** Les listes calculées dont on peut écarter une ligne pour la journée. */
export type DismissList = 'APPRO' | 'PRODUCTION';

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
  /**
   * Lignes écartées d'une liste calculée, par jour ouvré.
   *
   * Clé « LISTE:articleId », valeur : la date ouvrée du geste. La liste de
   * courses et le besoin de production sont des PROJECTIONS (RULE-002) : il n'y
   * a rien à y supprimer. On peut seulement dire « pas aujourd'hui », et la
   * portée au jour est ce qui empêche de faire taire définitivement une
   * rupture de stock — demain, la question revient d'elle-même.
   */
  dismissals: Record<string, string>;
  /**
   * Comment la maison suit ses coûts — voir `domain/operating-mode.ts`.
   *
   * Il vit dans l'état parce qu'il doit être lisible hors ligne, au premier
   * rendu, par des écrans qui n'attendent pas le réseau (RULE-010). Le serveur
   * le confirme à l'hydratation ; il ne le dicte pas au démarrage.
   */
  operatingMode: OperatingMode;
  /**
   * La clôture en cours, s'il y en a une. Elle vit dans l'état parce qu'elle
   * s'étale sur plusieurs écrans et doit survivre à un rechargement : on ne
   * recompte pas une caisse parce que le téléphone s'est verrouillé.
   */
  closing: ClosingSession | null;
  /** Les journées signées. RULE-009 s'y appuie pour refuser une saisie datée. */
  closures: DayClosure[];
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
  saleCounter: 0,
  batchCounter: 0,
  cooldowns: {},
  grants: SEED_GRANTS,
  variances: [],
  dismissals: {},
  operatingMode: DEFAULT_OPERATING_MODE,
  closing: null,
  closures: [],
};

export type Action =
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
      operatingMode?: OperatingMode;
      closing?: ClosingSession | null;
      closure?: DayClosure;
    }
  | { type: 'SAVE_ITEM'; item: Item }
  | { type: 'SET_SYNC'; ids: UUID[]; status: DomainEvent['syncStatus'] }
  | { type: 'NOTIFICATION_STATUS'; id: UUID; status: Notification['status'] }
  | { type: 'RAISE'; notifications: Notification[]; cooldowns: Cooldowns }
  | { type: 'GRANT'; grants: CapabilityGrant[] }
  | { type: 'REVOKE'; userId: UUID; capabilities: Capability[]; by: Actor }
  | { type: 'RESOLVE_VARIANCE'; varianceId: UUID; resolution: Resolution; note?: string; by: Actor }
  | { type: 'DISMISS'; key: string; day: string }
  | { type: 'RESTORE_LIST'; prefix: string }
  | { type: 'RECOVER_OUTBOX'; events: DomainEvent[] }
  /** Changement de maison — entrée ou sortie du bac à sable de simulation. */
  | { type: 'SWITCH_ORG' };

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'HYDRATE':
      return action.state;

    /*
     * On a changé de maison : le cache ne parle plus de celle-ci.
     *
     * Sans cette remise à zéro, la personne verrait le stock, les ventes et la
     * trésorerie de la maison réelle sous un bandeau « Mode simulation »,
     * jusqu'à ce que l'hydratation arrive. Le pire des deux mondes : des
     * chiffres vrais présentés comme faux, ou l'inverse.
     *
     * La FILE est conservée. Un fait daté appartient à son organisation et
     * attend sa session (voir `ofOrg`) : le jeter ici, ce serait perdre une
     * vente encaissée hors ligne parce que quelqu'un a ouvert une simulation.
     */
    case 'SWITCH_ORG':
      return { ...initialState, currentUserId: state.currentUserId, events: state.events };

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
        /*
         * Les accords sont maintenant une projection du serveur, au même titre
         * que le stock (§0.2) : `user_capabilities` fait foi, `SEED_GRANTS` ne
         * sert plus qu'avant la première hydratation. RLS limite qui voit quoi
         * (soi-même, ou tout le monde avec MANAGE_TEAM) — jamais un tableau
         * vide par accident, donc pas besoin du garde-fou de `audit` ci-dessus.
         */
        grants: s.grants,
        saleCounter: s.saleCounter,
        batchCounter: Math.max(state.batchCounter, s.batches.length),
        /*
         * Le régime du site, quand le serveur en connaît un. Une base qui n'a
         * pas encore reçu la migration ne renvoie rien : on garde alors celui
         * de l'appareil plutôt que de retomber en silence sur le défaut, ce
         * qui rebasculerait la maison à chaque hydratation.
         */
        operatingMode: s.operatingMode ?? state.operatingMode,
      };
    }

    case 'RECOVER_OUTBOX': {
      // Le cache fait foi sur ce qu'il connaît : il porte le `syncStatus` le
      // plus récent. Le miroir n'ajoute que ce qui avait disparu.
      const events = mergeOutbox(state.events, action.events);
      return events.length === state.events.length ? state : { ...state, events };
    }

    case 'DISMISS':
      return { ...state, dismissals: { ...state.dismissals, [action.key]: action.day } };

    case 'RESTORE_LIST': {
      const kept = Object.fromEntries(
        Object.entries(state.dismissals).filter(([k]) => !k.startsWith(action.prefix)),
      );
      return { ...state, dismissals: kept };
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
        operatingMode: a.operatingMode ?? state.operatingMode,
        closing: a.closing !== undefined ? a.closing : state.closing,
        closures: a.closure
          ? [a.closure, ...state.closures.filter((c) => c.id !== a.closure!.id)]
          : state.closures,
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
  /**
   * Ce qui attend une AUTRE organisation que celle ouverte — typiquement des
   * opérations de simulation quand on est revenu sur la maison réelle, ou
   * l'inverse. Ces événements ne partiront pas tant qu'on n'aura pas rouvert
   * la session sous laquelle ils ont été saisis. Compté à part et affiché,
   * parce qu'une file qui ne bouge plus sans le dire est un piège.
   */
  awaitingElsewhere: number;
  syncing: boolean;
  lastSyncAt: string | null;
  /** Ce que l'utilisateur courant a le droit de faire. Revalidé par RLS. */
  can: (capability: Capability) => boolean;
  /** Le journal des délégations — accords et révocations, datés et signés. */
  grants: CapabilityGrant[];
  /** Écarts constatés. Ouverts tant que personne ne les a soldés. */
  variances: Variance[];
  /** Comment la maison suit ses coûts. Les écrans lisent `policy`, pas ceci. */
  operatingMode: OperatingMode;
  /**
   * Ce que le régime décide, écran par écran.
   *
   * Les écrans lisent la politique et jamais l'enum : c'est ce qui évite un
   * `if (mode === ...)` semé dans quinze fichiers qu'on oublie de tester, et
   * ce qui permettra d'ajouter un troisième régime sans toucher un écran.
   */
  policy: OperatingPolicy;
  /** Bascule le régime. Fait daté, audité, synchronisé. Réservé à MANAGE_SETTINGS. */
  setOperatingMode: (mode: OperatingMode) => boolean;
  /** La clôture en cours, ou `null` tant que personne ne l'a ouverte. */
  closing: ClosingSession | null;
  /** Le contexte que les vues du domaine attendent — recalculé à la demande. */
  closingCtx: () => ClosingContext;
  /** Ouvre la clôture du jour, ou rend celle qui est déjà en cours. */
  openClosing: () => ClosingSession;
  /** Franchit une étape. Rend le message d'erreur, ou `null` si c'est passé. */
  submitClosingStep: (declaration: ClosingDeclaration) => string | null;
  /** Revient sur une étape franchie. Les suivantes tombent avec elle. */
  revertClosingStep: (step: ClosingDeclaration['step']) => string | null;
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
  /** Vrai quand la personne travaille dans le bac à sable de simulation. */
  simulating: boolean;
  /**
   * Entre dans le bac à sable, en le montant s'il n'existe pas encore. Réservé
   * à RUN_SIMULATION, et revérifié par le serveur. Rend `null` si tout va bien,
   * sinon un message prêt à afficher.
   */
  enterSimulation: () => Promise<SimulationOutcome>;
  /** Ramène la personne dans sa maison. Jamais refusé. */
  leaveSimulation: () => Promise<SimulationOutcome>;
  /** Efface le bac à sable et ramène tout le monde. Réservé à RUN_SIMULATION. */
  purgeSimulation: () => Promise<SimulationOutcome>;
  /** Vrai pendant l'aller-retour serveur d'une entrée, sortie ou purge. */
  simulationBusy: boolean;
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
  /**
   * Déclare une préparation faite.
   *
   * `recipeVersionId` est facultatif : un établissement qui ouvre n'a pas
   * encore de recettes justes, et lui refuser de déclarer ce qu'il a préparé
   * revient à lui refuser de vendre. `consumption` dit ce qui est réellement
   * sorti pour ce lot — en TOTAL, pas par unité — et l'emporte sur la recette
   * quand les deux existent : c'est le constat qui fait foi, pas la prévision.
   */
  completeBatch: (input: {
    itemId: UUID; recipeVersionId?: UUID | null; planned: number; produced: number;
    loss: number; locationId: UUID;
    consumption?: { itemId: UUID; quantity: number; unit: Unit }[];
  }) => void;
  recordWaste: (input: { itemId: UUID; locationId: UUID; quantity: number; reason: WasteReason }) => void;
  transferStock: (input: { itemId: UUID; from: UUID; to: UUID; quantity: number }) => void;
  /**
   * `debt` n'existe que si la dépense dépasse la caisse disponible et que la
   * personne a désigné un prêteur : elle ouvre alors un écart de source
   * `DEBT`, qui reste affiché sur le tableau de bord jusqu'à être marqué
   * remboursé depuis Écarts — exactement comme un écart de caisse ou de stock.
   */
  recordExpense: (
    input: Omit<Expense, 'id' | 'userId' | 'createdAt' | 'actor'>,
    debt?: { lender: string; amount: number },
  ) => void;
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
  /** Écarte une ligne d'une liste calculée, pour la journée en cours. */
  dismissFromList: (list: DismissList, itemId: UUID) => void;
  /** Les articles écartés aujourd'hui de cette liste. */
  dismissedIn: (list: DismissList) => Set<UUID>;
  /** Ramène tout ce qui a été écarté de cette liste. */
  restoreList: (list: DismissList) => void;
  /** Faux quand la file ne peut plus être persistée durablement sur cet appareil. */
  outboxDurable: boolean;
  /** Ouvre un shift avec le fond de caisse compté. Sans lui, rien à clôturer. */
  openCashSession: (openingCash: number) => void;
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
    const restored = { ...base, ...saved, ...(events ? { events } : {}) };

    /*
     * Une capacité née après ce cache n'a été offerte à personne : l'écran
     * qu'elle garde serait inaccessible à tout le monde, propriétaire compris,
     * et personne ne pourrait se l'accorder faute de la détenir. On rattrape
     * depuis le poste, exactement comme à la création d'un compte — jamais une
     * capacité déjà révoquée, qui reste un fait daté.
     */
    const missing = backfillGrants(restored.grants, USERS, new Date().toISOString());
    return missing.length ? { ...restored, grants: [...restored.grants, ...missing] } : restored;
  });
  const [online, setOnline] = useState(navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  /* Profil issu de Supabase. Prend le pas sur les profils de démonstration. */
  const [remoteProfile, setRemoteProfile] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(isBackendConfigured);
  const [hydrating, setHydrating] = useState(false);
  const [hydratedAt, setHydratedAt] = useState<string | null>(null);
  /* Faux quand le miroir de la file a refusé d'écrire : à signaler, pas à taire. */
  const [outboxDurable, setOutboxDurable] = useState(true);
  /* Vrai pendant qu'on entre, sort ou efface une simulation. */
  const [simulationBusy, setSimulationBusy] = useState(false);
  /* Vrai une fois le miroir relu : rien ne s'écrit avant, sous peine de l'effacer. */
  const [recovered, setRecovered] = useState(false);
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

  /*
   * La file, en plus, dans un magasin qui ne s'évince pas.
   *
   * `saveState` peut échouer sur le quota et l'avale volontairement : perdre
   * du cache est sans conséquence, il revient à l'hydratation. Mais une vente
   * encaissée hors ligne n'existe QUE dans la file — personne ne peut la
   * reconstruire. Elle est donc écrite une seconde fois en IndexedDB, dont la
   * limite est bien plus haute et que le nettoyage du cache ne balaie pas.
   *
   * L'écriture ne bloque rien : la vente est déjà dans l'état React et à
   * l'écran quand elle part (RULE-010).
   */
  useEffect(() => {
    /*
     * Rien n'est écrit tant que la récupération n'a pas eu lieu.
     *
     * Sans cette garde, le premier rendu suivant un cache vidé miroitait un
     * `state.events` vide, ce qui EFFAÇAIT le magasin — juste avant que la
     * lecture asynchrone ne vienne y chercher les ventes à récupérer. Le
     * miroir se détruisait lui-même dans le seul cas où il servait à quelque
     * chose.
     */
    if (!recovered) return;
    void mirrorOutbox(state.events).catch((cause) => {
      console.warn('[BUNA] file non persistée sur cet appareil', cause);
      setOutboxDurable(false);
    });
  }, [state.events, recovered]);

  /*
   * Récupération au démarrage : ce que le cache a perdu, le miroir le rend.
   *
   * Le cas visé est précis — quota atteint, `localStorage` vidé par le
   * navigateur, ou onglet fermé avant l'écriture du cache. Sans ça, la file
   * repartait vide et les ventes hors ligne disparaissaient au rechargement.
   */
  useEffect(() => {
    let cancelled = false;
    void loadOutbox()
      .then((mirrored) => {
        if (cancelled) return;
        if (mirrored.length) dispatch({ type: 'RECOVER_OUTBOX', events: mirrored });
      })
      .finally(() => {
        // Même en cas d'échec : sans ce déverrouillage, plus rien ne serait
        // jamais persisté, ce qui est pire que le problème d'origine.
        if (!cancelled) setRecovered(true);
      });
    return () => { cancelled = true; };
  }, []);

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

  /*
   * Ce que la projection a dû écarter.
   *
   * Un mouvement écrit en kg sur un article repassé en unités ne peut pas être
   * replié : il est ignoré pour que le comptoir continue de tourner, mais le
   * stock affiché de cet article est alors incomplet. On ne le laisse pas
   * passer pour un zéro — le journal garde de quoi corriger l'unité à froid.
   */
  const mismatches = useMemo(() => unitMismatches(state.movements, itemsMap), [state.movements, itemsMap]);
  useEffect(() => {
    if (!mismatches.length) return;
    console.warn('[BUNA] stock incomplet — unités incompatibles', mismatches);
  }, [mismatches]);
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
  /*
   * La file, réduite à l'organisation ouverte.
   *
   * `pending` commande deux choses : l'envoi, et le blocage de l'hydratation
   * (on ne remplace pas l'état local tant qu'il reste des faits non partis).
   * Compter les événements d'une AUTRE organisation dans ce chiffre bloquerait
   * l'hydratation pour toujours — ils ne peuvent pas partir sous cette
   * session, donc le compteur ne redescendrait jamais.
   */
  const mine = useMemo(() => ofOrg(state.events, orgId), [state.events, orgId]);
  const pending = pendingEvents(mine).length;
  const awaitingElsewhere = useMemo(
    () => awaitingAnotherOrg(state.events, orgId),
    [state.events, orgId],
  );

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
        /* Seuls les produits préparés d'avance sortent du stock. Un produit
           monté à la commande n'a pas de stock de produit fini à débiter — le
           débiter ferait plonger un compteur qui n'a jamais rien compté. Ce
           sont ses ingrédients qui devront sortir, quand les recettes seront
           définies. */
        movements: lines
          .filter((l) => !isMadeToOrder(itemsMap.get(l.itemId) ?? {}))
          .map((l) =>
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
    ({
      itemId: rawItemId, recipeVersionId, planned, produced, loss,
      locationId: rawLocationId, consumption: declared,
    }) => {
      const actor = authorize('PRODUCE');
      /* Une préparation produit une quantité positive — `complete_batch` le
         refuse aussi. Laisser passer un zéro fabriquerait un événement que la
         file réessaierait sans fin, sans que rien ne l'explique à l'écran. */
      if (!user || !actor || produced <= 0) return;

      /*
       * La recette, s'il y en a une. Elle n'est plus un préalable.
       *
       * Sans elle, l'écran refusait de s'ouvrir et cette fonction sortait en
       * silence : pas de recette, pas de production ; pas de production, pas
       * de produit fini ; pas de produit fini, pas de vente. Un établissement
       * qui ouvre n'a pas encore de recettes exactes — l'application ne doit
       * pas lui demander de les inventer pour avoir le droit de travailler.
       */
      const version = recipeVersionId
        ? RECIPE_VERSIONS.find((v) => v.id === recipeVersionId)
        : undefined;

      // L'écran de production nomme encore le produit en dur : on le traduit.
      const itemId = resolveId(rawItemId);
      const locationId = resolveId(rawLocationId);
      const id = uuid();
      const code = batchCode(new Date(), state.batchCounter + 1);

      /* Le constat d'abord, la recette ensuite — la règle et son pourquoi sont
         dans `consumedBy`, avec les tests qui la tiennent. */
      const lines = consumedBy(
        produced,
        declared?.map((line) => ({ ...line, itemId: resolveId(line.itemId) })),
        version?.ingredients,
      );

      const consumption = lines.map((line) =>
        makeMovement(
          /* La cuisine était codée en dur. Le lait est au frigo : la cuisine
             passait en négatif et le frigo restait plein.
             La quantité est convertie dans l'unité de l'ARTICLE avant d'être
             comparée au stock — 3960 mL face à 6,2 L, comparés bruts, ne
             désignent jamais le bon emplacement. */
          line.itemId,
          sourceFor(
            line.itemId,
            /* Faute d'unité comparable, on interroge le stock dans l'unité du
               mouvement : l'emplacement choisi peut être imparfait, mais une
               conversion impossible ne doit pas faire échouer une production
               déjà faite en cuisine. */
            convertible(line.unit, itemsMap.get(line.itemId)?.unit)
              ? convert(line.quantity, line.unit, itemsMap.get(line.itemId)!.unit)
              : line.quantity,
            LOC.KITCHEN,
          ),
          -line.quantity, line.unit,
          'PRODUCTION_CONSUMPTION', 'ProductionBatch', id, actor,
        ),
      );
      const output = makeMovement(
        itemId, locationId, produced, 'unite', 'PRODUCTION_OUTPUT', 'ProductionBatch', id, actor,
      );

      const batch: ProductionBatch = {
        id, code, itemId, recipeVersionId: version?.id ?? null, preparerId: user.id, locationId,
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
          /* Le lot ne se reconstruit pas côté serveur à partir d'un rendement :
             il lui faut sa recette, son emplacement et ce qu'il a consommé,
             sinon `complete_batch` ne peut ni écrire le lot ni sortir les
             ingrédients. */
          makeEvent('BATCH_COMPLETED', 'ProductionBatch', id, {
            batchId: id, code, itemId, recipeVersionId: version?.id ?? null, locationId,
            planned, produced, loss, yieldPct,
            /* `locationId` part avec la ligne : la colonne est NOT NULL côté
               serveur, et une consommation sans emplacement fait échouer
               l'insertion — donc perd le lot, en boucle. */
            consumption: consumption.map((m) => ({
              itemId: m.itemId, quantity: m.quantity, unit: m.unit, locationId: m.locationId,
            })),
          }),
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
        /* `locationId` et `unit` voyagent avec le fait : les deux colonnes sont
           NOT NULL côté serveur, et un payload qui les omet fait échouer
           l'insertion — donc perd la perte. */
        events: [makeEvent('WASTE_RECORDED', 'WasteEvent', id, {
          itemId, locationId, quantity, unit: item.unit, cost, reason,
        })],
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
        /* `unit` est NOT NULL sur `stock_movements` : sans elle, les deux
           mouvements du transfert n'arrivent jamais en base. */
        events: [makeEvent('STOCK_TRANSFERRED', 'Transfer', transferId, {
          itemId, from, to, quantity, unit: item.unit,
        })],
        audit: [makeAudit(actor, `Transfert — ${item.name}`, `${quantity} ${item.unit}`)],
      });
    },
    [itemsMap, authorize, makeEvent, makeMovement, makeAudit],
  );

  const recordExpense = useCallback<Ctx['recordExpense']>(
    (input, debt) => {
      const actor = authorize('RECORD_EXPENSE');
      if (!actor) return;
      const id = uuid();

      /*
       * Un emprunt pour couvrir une dépense n'est pas la dépense elle-même —
       * c'est une dette distincte, qui doit rester visible jusqu'à son
       * remboursement. On la modélise comme un écart (`Variance`), le seul
       * concept du domaine déjà bâti pour « ouvert jusqu'à ce que quelqu'un
       * tranche » : même tableau de bord, même écran de recouvrement, même
       * discipline d'auteur et de motif que les écarts de caisse ou de stock.
       */
      const varianceId = debt ? uuid() : undefined;
      const variance = debt && varianceId
        ? {
            id: varianceId,
            source: 'DEBT' as const,
            reference: id,
            subject: `Emprunt — ${debt.lender}`,
            theoretical: 0,
            declared: debt.amount,
            delta: debt.amount,
            amount: debt.amount,
            actor,
            resolution: null,
            resolver: null,
            createdAt: actor.at,
          }
        : undefined;

      dispatch({
        type: 'COMMIT',
        expense: { ...input, id, userId: actor.userId, createdAt: actor.at, actor },
        events: [makeEvent('EXPENSE_RECORDED', 'Expense', id, {
          ...input, expenseId: id,
          ...(variance && { varianceId: variance.id, varianceAmount: variance.amount, varianceSubject: variance.subject }),
        })],
        audit: [
          makeAudit(actor, `Dépense — ${input.description}`, `${input.amount} FCFA · ${input.category}`),
          ...(debt
            ? [makeAudit(
                actor,
                `Emprunt — ${debt.lender}`,
                `${debt.amount} FCFA pour couvrir une dépense · reste dû jusqu'au remboursement`,
              )]
            : []),
        ],
        variances: variance ? [variance] : undefined,
      });
    },
    [authorize, makeEvent, makeAudit],
  );

  const saveItem = useCallback<Ctx['saveItem']>(
    (item) => {
      const actor = authorize('MANAGE_CATALOG');
      if (!actor) return;
      const previous = itemsMap.get(item.id);
      const isNew = !previous;

      /*
       * La modification part dans la file, elle ne reste plus sur l'appareil.
       *
       * `items` n'était qu'en lecture : un prix changé vivait dans l'état
       * local, ne partait jamais, et la première hydratation le remplaçait par
       * la valeur du serveur. Le prix revenait à l'ancien tout seul, sans rien
       * dire, et l'écran suivant montrait l'ancien tarif au comptoir.
       *
       * Passer par la file règle les deux moitiés du problème : la fiche part
       * dès que le réseau revient, et tant qu'elle attend, `pending > 0`
       * empêche l'hydratation d'écraser ce qui n'est pas encore parti.
       */
      const row = itemRow(item, orgId);
      /*
       * Le coût moyen pondéré n'accompagne la fiche que si quelqu'un l'a
       * vraiment saisi. C'est une valeur DÉRIVÉE des réceptions : la renvoyer
       * à chaque enregistrement écraserait un calcul serveur à jour par l'état
       * qu'avait l'appareil avant la dernière réception.
       */
      if (isNew || item.weightedAvgCost !== previous?.weightedAvgCost) {
        row.weighted_avg_cost = item.weightedAvgCost ?? 0;
      }

      dispatch({ type: 'SAVE_ITEM', item });
      dispatch({
        type: 'COMMIT',
        events: [makeEvent('CATALOG_ITEM_SAVED', 'Item', item.id, { row })],
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
    [itemsMap, authorize, makeAudit, makeEvent, orgId],
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
    const actor = authorize('EDIT_RECIPE');
    if (!actor) return;
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

    /*
     * La recette part au serveur.
     *
     * Elle ne vivait que dans le cache du navigateur : invisible depuis un
     * autre appareil, et perdue avec le cache. Le carnet de recettes d'une
     * boutique ne peut pas dépendre de ce que le navigateur décide de garder.
     */
    const rows = recipeRows(recipe, version, orgId);
    dispatch({
      type: 'COMMIT',
      events: [makeEvent('RECIPE_SAVED', 'Recipe', recipe.id, rows)],
      audit: [makeAudit(
        actor,
        rExists ? `Recette modifiée — ${recipe.name}` : `Recette créée — ${recipe.name}`,
        `version ${version.version} · ${version.ingredients.length} ingrédient(s)`,
      )],
    });
  }, [authorize, makeEvent, makeAudit, orgId]);

  const archiveItem = useCallback<Ctx['archiveItem']>(
    (itemId) => {
      const actor = authorize('MANAGE_CATALOG');
      const item = itemsMap.get(itemId);
      if (!item || !actor) return;
      const archived = { ...item, archived: true };
      /* Archiver est une modification de fiche comme une autre : sans
         événement, l'article réapparaissait à l'hydratation suivante. */
      dispatch({ type: 'SAVE_ITEM', item: archived });
      dispatch({
        type: 'COMMIT',
        events: [makeEvent('CATALOG_ITEM_SAVED', 'Item', item.id, { row: itemRow(archived, orgId) })],
        audit: [makeAudit(actor, `Article archivé — ${item.name}`, 'retiré du catalogue, historique conservé')],
      });
    },
    [itemsMap, authorize, makeAudit, makeEvent, orgId],
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
            countId, itemId, locationId, unit: item.unit,
            theoretical, counted: countedQuantity, delta, reason,
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

  /*
   * Écarter, pas supprimer.
   *
   * Ces listes sont recalculées à chaque rendu : rien à y effacer. Écarter dit
   * « pas aujourd'hui », et la clé porte la date ouvrée — demain la ligne
   * revient. C'est délibéré : une rupture de stock qu'on peut faire taire pour
   * toujours finit par coûter un service.
   */
  const dismissFromList = useCallback<Ctx['dismissFromList']>(
    (list, itemId) => {
      dispatch({
        type: 'DISMISS',
        key: `${list}:${itemId}`,
        day: businessDateOf(new Date().toISOString()),
      });
    },
    [],
  );

  const dismissedIn = useCallback<Ctx['dismissedIn']>(
    (list) => {
      const today = businessDateOf(new Date().toISOString());
      const prefix = `${list}:`;
      const out = new Set<UUID>();
      for (const [key, day] of Object.entries(state.dismissals)) {
        if (day === today && key.startsWith(prefix)) out.add(key.slice(prefix.length));
      }
      return out;
    },
    [state.dismissals],
  );

  const restoreList = useCallback<Ctx['restoreList']>(
    (list) => dispatch({ type: 'RESTORE_LIST', prefix: `${list}:` }),
    [],
  );

  /**
   * Ouverture de shift.
   *
   * Le fond de caisse est DÉCLARÉ, pas repris de la clôture précédente : entre
   * deux shifts, l'argent dort ailleurs et quelqu'un en remet dans le tiroir.
   * Reconduire l'ancien solde ferait porter au vendeur du matin un écart créé
   * la veille, ce qui est exactement ce qu'on cherche à éviter.
   */
  const openCashSession = useCallback<Ctx['openCashSession']>(
    (openingCash) => {
      const actor = authorize('MANAGE_CASH_SESSION');
      if (!actor) return;
      // Une caisse déjà ouverte ne se rouvre pas : on clôture d'abord.
      if (!state.cashSession.closedAt) return;

      const id = uuid();
      const shiftNumber = state.cashSession.shiftNumber + 1;
      const session: CashSession = {
        id,
        siteId,
        sellerId: actor.userId,
        shiftNumber,
        openingCash,
        countedCash: null,
        openedAt: actor.at,
        closedAt: null,
      };

      dispatch({
        type: 'COMMIT',
        cashSession: session,
        events: [
          makeEvent('CASH_SESSION_OPENED', 'CashSession', id, {
            cashSessionId: id, shiftNumber, openingCash,
          }),
        ],
        audit: [
          makeAudit(
            actor,
            `Ouverture shift #${shiftNumber}`,
            `fond de caisse ${Math.round(openingCash)} FCFA`,
          ),
        ],
      });
    },
    [state.cashSession, siteId, authorize, makeEvent, makeAudit],
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
          makeEvent('CASH_SESSION_CLOSED', 'CashSession', session.id, {
            cashSessionId: session.id, shiftNumber: session.shiftNumber,
            openingCash: session.openingCash, expected, countedCash, variance, reason,
          }),
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
      const grants = fresh.map((capability) => ({
        id: uuid(),
        userId,
        capability,
        grantedBy: actor.userId,
        grantedByName: actor.userName,
        grantedAt: actor.at,
      }));
      dispatch({ type: 'GRANT', grants });
      dispatch({
        type: 'COMMIT',
        // Un accord par capacité : `grant_capability` n'en prend qu'une à la
        // fois côté serveur (§0.2 — sans ceci, l'accord ne vit qu'en mémoire
        // et disparaît au premier rechargement).
        events: grants.map((g) => makeEvent('CAPABILITY_GRANTED', 'CapabilityGrant', g.id, {
          userId, capability: g.capability,
        })),
        audit: [makeAudit(
          actor,
          `Accès accordés — ${target?.name ?? 'membre'}`,
          fresh.map((c) => CAPABILITY_LABEL[c].toLowerCase()).join(', '),
          `team:${userId.slice(0, 8)}`,
        )],
      });
      return true;
    },
    [state.grants, authorize, makeAudit, makeEvent],
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
        events: guarded.map((capability) => makeEvent('CAPABILITY_REVOKED', 'CapabilityGrant', uuid(), {
          userId, capability,
        })),
        audit: [makeAudit(
          actor,
          `Accès retirés — ${target?.name ?? 'membre'}`,
          guarded.map((c) => CAPABILITY_LABEL[c].toLowerCase()).join(', '),
          `team:${userId.slice(0, 8)}`,
        )],
      });
      return true;
    },
    [authorize, makeAudit, makeEvent],
  );

  /* --------------------------------------------------- Recouvrement */

  /*
   * Le régime d'exploitation se change comme tout le reste se déclare : par un
   * fait daté, signé, qui part dans la file. Pas par un booléen écrit quelque
   * part.
   *
   * Cela a une conséquence utile : une analyse de période peut dire par quelle
   * méthode elle a été calculée, et signaler que la méthode a changé en cours
   * de route — l'événement porte sa date.
   */
  const setOperatingMode = useCallback<Ctx['setOperatingMode']>(
    (mode) => {
      const actor = authorize('MANAGE_SETTINGS');
      if (!actor) return false;
      /* Rebasculer sur le régime courant n'est pas un fait : ne rien écrire
         évite un journal plein de changements qui ne changent rien. */
      if (mode === state.operatingMode) return true;

      dispatch({
        type: 'COMMIT',
        operatingMode: mode,
        events: [makeEvent('OPERATING_MODE_SET', 'Site', siteId, { mode })],
        audit: [makeAudit(
          actor,
          `Suivi des coûts — ${OPERATING_MODE_LABEL[mode].toLowerCase()}`,
          `depuis « ${OPERATING_MODE_LABEL[state.operatingMode].toLowerCase()} » · s'applique à toute l'équipe`,
        )],
      });
      return true;
    },
    [state.operatingMode, siteId, authorize, makeEvent, makeAudit],
  );

  /* --------------------------------------------------------- Clôture */

  /*
   * Le périmètre du comptage du soir.
   *
   * En suivi simple, ce sont les produits finis qui ferment l'équation
   * « préparé − vendu − restant ». Sans ce comptage, le régime ne mesure
   * rien : il ne fait que ne plus bloquer, et le stock négatif que la journée
   * a laissé reste un mystère permanent.
   *
   * On compte là où la marchandise a une existence : chaque emplacement où
   * l'article a un stock non nul, et à défaut celui où l'on vend — un produit
   * vendu au-delà du déclaré affiche un négatif, et c'est justement celui-là
   * qu'il faut compter.
   */
  const countScope = useMemo(() => {
    if (!policyOf(state.operatingMode).countFinishedGoodsAtClosing) return [];
    const scope: { itemId: UUID; locationId: UUID }[] = [];
    for (const item of state.items) {
      if (item.kind !== 'FINISHED' || item.archived || isMadeToOrder(item)) continue;
      const places = LOCATIONS
        .map((l) => l.id)
        .filter((locationId) => Math.abs(stock.get(`${item.id}@${locationId}`) ?? 0) > 0.0001);
      for (const locationId of places.length ? places : [LOC.POS]) {
        scope.push({ itemId: item.id, locationId });
      }
    }
    return scope;
  }, [state.items, state.operatingMode, stock]);

  const closingCtx = useCallback((): ClosingContext => closingContext({
    siteId,
    businessDate: businessDateOf(new Date().toISOString()),
    actor: {
      id: user?.id ?? '',
      post: user?.post ?? 'SELLER',
      capabilities: user?.capabilities ?? [],
    },
    items: state.items,
    sales: state.sales,
    expenses: state.expenses,
    movements: state.movements,
    cashSessions: [state.cashSession],
    closures: state.closures,
    pendingEventCount: pendingEvents(state.events).length,
    countScope,
  }), [siteId, user, state.items, state.sales, state.expenses, state.movements,
       state.cashSession, state.closures, state.events, countScope]);

  const openClosing = useCallback<Ctx['openClosing']>(() => {
    if (state.closing) return state.closing;
    const session = startClosing(siteId, businessDateOf(new Date().toISOString()));
    dispatch({ type: 'COMMIT', closing: session });
    return session;
  }, [state.closing, siteId]);

  /*
   * Franchir une étape.
   *
   * Le domaine décide et rend les faits à écrire ; le store les commit en une
   * seule transaction, comme une vente. Un franchissement à moitié écrit —
   * l'ajustement de stock posé mais la caisse non fermée — serait pire qu'un
   * refus, parce que rien ne dirait où il s'est arrêté.
   */
  const submitClosingStep = useCallback<Ctx['submitClosingStep']>(
    (declaration) => {
      const actor = authorize(declaration.step === 'FINAL_VALIDATION' ? 'CLOSE_DAY' : 'MANAGE_CASH_SESSION');
      if (!actor) return "Vous n'avez pas l'autorisation de clôturer.";

      const session = state.closing ?? startClosing(siteId, businessDateOf(new Date().toISOString()));
      const outcome = completeStep(session, closingCtx(), declaration);
      if (!outcome.ok) return outcome.message;

      /*
       * Traduction des faits du domaine vers le vocabulaire que la
       * synchronisation sait envoyer.
       *
       * Le domaine décrit une étape ; le transport, lui, parle à des fonctions
       * PostgreSQL déjà écrites, qui attendent une forme précise. Deux
       * traductions sont nécessaires, et aucune n'est cosmétique — sans elles
       * l'événement échoue en base et se réessaie sans fin, ce qui garde la
       * file non vide et bloque toute hydratation.
       */
      const events: DomainEvent[] = [];
      const variances: Variance[] = [];

      for (const draft of outcome.events) {
        if (draft.eventType === 'CASH_SESSION_CLOSED') {
          /* Le domaine ignore l'identité du tiroir — c'est le store qui la
             tient. `close_cash_session` veut le numéro de shift et le fond
             d'ouverture ; sans eux, la clôture n'arrive jamais en base. */
          const p = draft.payload as { expected: number; countedCash: number; variance: number; reason?: string };
          events.push(makeEvent('CASH_SESSION_CLOSED', 'CashSession', state.cashSession.id, {
            cashSessionId: state.cashSession.id,
            shiftNumber: state.cashSession.shiftNumber,
            openingCash: state.cashSession.openingCash,
            expected: p.expected, countedCash: p.countedCash, variance: p.variance, reason: p.reason,
          }));
          if (p.variance !== 0) {
            variances.push({
              id: uuid(), source: 'CASH', reference: state.cashSession.id,
              subject: `Shift #${state.cashSession.shiftNumber}`,
              theoretical: p.expected, declared: p.countedCash, delta: p.variance,
              amount: Math.abs(p.variance), actor, resolution: null, resolver: null,
              createdAt: actor.at,
            });
          }
          continue;
        }

        if (draft.eventType === 'STOCK_COUNTED') {
          /* `apply_inventory_count` traite UN article : le comptage du soir en
             porte autant qu'il y a de lignes. On les déplie, dans la forme
             exacte que l'inventaire utilise déjà. */
          const lines = (draft.payload as { lines?: {
            itemId: UUID; locationId: UUID; theoretical: number; counted: number;
            delta: number; reason?: WasteReason;
          }[] }).lines ?? [];
          for (const line of lines) {
            if (Math.abs(line.delta) < 0.0001) continue;
            const item = itemsMap.get(line.itemId);
            const countId = uuid();
            events.push(makeEvent('STOCK_COUNTED', 'InventoryCount', countId, {
              countId, itemId: line.itemId, locationId: line.locationId,
              unit: item?.unit ?? 'unite',
              theoretical: line.theoretical, counted: line.counted, delta: line.delta,
              reason: line.reason ?? 'INCONNU',
            }));
            variances.push({
              id: uuid(), source: 'STOCK', reference: countId,
              subject: item?.name ?? 'Article',
              theoretical: line.theoretical, declared: line.counted, delta: line.delta,
              amount: Math.abs(Math.round(line.delta * (item?.weightedAvgCost ?? 0))),
              actor, resolution: null, resolver: null, createdAt: actor.at,
            });
          }
          continue;
        }

        /* La détection d'écart n'a pas d'événement à elle : `resolve_variance`
           attend une RÉSOLUTION, et personne n'a encore donné de motif. L'écart
           vit localement jusqu'à ce que quelqu'un le solde, et c'est ce
           geste-là qui l'enverra. */
        if (draft.eventType === 'STOCK_VARIANCE_DETECTED') continue;

        events.push(makeEvent(draft.eventType, draft.entityType, draft.entityId, draft.payload));
      }

      dispatch({
        type: 'COMMIT',
        closing: outcome.session,
        closure: outcome.closure ?? undefined,
        movements: outcome.movements.map((m) =>
          makeMovement(m.itemId, m.locationId, m.quantity, m.unit, m.movementType,
            m.referenceType, m.referenceId, actor),
        ),
        events,
        variances: variances.length ? variances : undefined,
        audit: outcome.audit.map((a) => makeAudit(actor, a.action, a.detail, a.reference)),
        /* La caisse se ferme avec l'étape qui la compte, pas séparément. */
        cashSession: declaration.step === 'CASH_COUNT'
          ? {
              ...state.cashSession,
              countedCash: declaration.countedCash,
              closedAt: actor.at,
              varianceReason: declaration.reason,
            }
          : undefined,
      });
      return null;
    },
    [state.closing, state.cashSession, siteId, itemsMap, authorize, closingCtx, makeMovement, makeEvent, makeAudit],
  );

  const revertClosingStep = useCallback<Ctx['revertClosingStep']>(
    (step) => {
      const actor = authorize('MANAGE_CASH_SESSION');
      if (!actor || !state.closing) return "Aucune clôture en cours.";
      const outcome = revertStep(state.closing, step);
      if (!outcome.ok) return outcome.message;
      dispatch({
        type: 'COMMIT',
        closing: outcome.session,
        audit: outcome.audit.map((a) => makeAudit(actor, a.action, a.detail, a.reference)),
      });
      return null;
    },
    [state.closing, authorize, makeAudit],
  );

  const resolveVariance = useCallback<Ctx['resolveVariance']>(
    (varianceId, resolution, note) => {
      const actor = authorize('RESOLVE_VARIANCE');
      const target = state.variances.find((v) => v.id === varianceId);
      if (!actor || !target || target.resolution !== null) return false;

      dispatch({ type: 'RESOLVE_VARIANCE', varianceId, resolution, note, by: actor });
      dispatch({
        type: 'COMMIT',
        /*
         * `resolve_variance` côté serveur peut insérer l'écart lui-même s'il
         * n'existait pas encore là-bas (idempotent, `on conflict do nothing`) —
         * d'où un payload complet et pas seulement la résolution : c'est le
         * filet qui rattrape un écart détecté hors ligne et jamais autrement
         * synchronisé.
         */
        events: [makeEvent('STOCK_VARIANCE_DETECTED', 'Variance', varianceId, {
          siteId, source: target.source, referenceId: target.reference, subject: target.subject,
          theoretical: target.theoretical, declared: target.declared,
          delta: target.delta, amount: target.amount,
          detectedAt: target.createdAt, resolution, note,
        })],
        audit: [makeAudit(
          actor,
          `Écart soldé — ${target.subject}`,
          `${VARIANCE_SOURCE_LABEL[target.source].toLowerCase()} · ${target.amount} FCFA · ${RESOLUTION_LABEL[resolution].toLowerCase()}${note ? ` · ${note}` : ''}`,
        )],
      });
      return true;
    },
    [state.variances, siteId, authorize, makeEvent, makeAudit],
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
        finishedGoodsAlerts: policyOf(state.operatingMode).finishedGoodsAlerts,
      },
      state.cooldowns,
    );

    if (notifications.length) dispatch({ type: 'RAISE', notifications, cooldowns });
  }, [state.items, state.sales, state.waste, state.cashSession, state.cooldowns, state.operatingMode, stock]);

  /* ----------------------------------------------------------- Sync */

  const syncNow = useCallback(async () => {
    // Le verrou est un ref, pas un état : deux déclencheurs (retour de réseau et
    // timer) peuvent tomber dans le même tour de rendu, avant que `syncing` ne
    // soit repeint — et enverraient alors la même vente deux fois.
    if (syncingRef.current || !navigator.onLine) return;
    const queue = dueEvents(ofOrg(state.events, orgId), lastAttemptAt.current);
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
  }, [state.events, orgId]);

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
          /* Les recettes du serveur font autorité dès qu'il en a. Une liste
             vide ne remplace jamais la liste locale — c'est la règle de
             `applyReferentials` — donc une boutique qui n'a encore rien
             envoyé garde les siennes. */
          recipes: snapshot.recipes,
          recipeVersions: snapshot.recipeVersions,
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

  /* ------------------------------------------------- Bac à sable */

  /**
   * Un aller-retour de simulation, quel qu'il soit.
   *
   * Le serveur déplace le profil ; il reste à faire trois choses ici, et
   * l'ordre compte. D'abord relire le profil : c'est lui qui porte
   * l'organisation, donc `orgId`, donc la destination de tout ce qui sera
   * écrit ensuite. Ensuite vider le cache : les projections en mémoire
   * décrivent la maison qu'on vient de quitter. Enfin redemander un
   * instantané.
   *
   * Si l'appel échoue, on ne touche à RIEN. Un profil resté sur place avec un
   * cache vidé afficherait une maison vide en prétendant que c'est la vraie.
   */
  const simulationStep = useCallback(
    async (rpc: () => Promise<SimulationOutcome>): Promise<SimulationOutcome> => {
      if (simulationBusy) return null;
      setSimulationBusy(true);
      try {
        const failure = await rpc();
        if (failure) return failure;

        const profile = await loadProfile();
        if (profile) setRemoteProfile(profile);
        dispatch({ type: 'SWITCH_ORG' });
        stale.current = true;
        return null;
      } finally {
        setSimulationBusy(false);
      }
    },
    [simulationBusy],
  );

  const enterSimulation = useCallback(() => simulationStep(rpcEnter), [simulationStep]);
  const leaveSimulation = useCallback(() => simulationStep(rpcLeave), [simulationStep]);
  /* Effacer ramène tout le monde, celui qui appelle compris : c'est donc aussi
     une sortie, et le même enchaînement s'applique. */
  const purgeSimulation = useCallback(() => simulationStep(rpcPurge), [simulationStep]);

  const value: Ctx = {
    state, user, users: USERS, items: itemsMap, stock, online, pending, awaitingElsewhere, syncing, lastSyncAt,
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
    simulating: isSimulation(user?.organizationId),
    enterSimulation, leaveSimulation, purgeSimulation, simulationBusy,
    backendConfigured: isBackendConfigured,
    hydrating,
    hydratedAt,
    refresh,
    syncNow, completeSale, voidSale, completeBatch, recordWaste, transferStock,
    recordExpense, receiveGoods, openCashSession, closeCashSession, setNotificationStatus, stockOf,
    dismissFromList, dismissedIn, restoreList, outboxDurable,
    saveItem, archiveItem, adjustStock, saveLocation, saveRecipe,
    operatingMode: state.operatingMode,
    policy: policyOf(state.operatingMode),
    setOperatingMode,
    closing: state.closing,
    closingCtx, openClosing, submitClosingStep, revertClosingStep,
  };

  return <BunaContext.Provider value={value}>{children}</BunaContext.Provider>;
}

export { LOC, LOCATIONS, RECIPES, RECIPE_VERSIONS, SUPPLIERS, SITE, ITEMS };
export { convert, weightedAverageCost };
