/**
 * BUNA Operations — noyau métier.
 *
 * L'unité fondamentale du système est un événement métier, pas une ligne Excel.
 * Le stock n'est jamais écrasé : il est reconstruit depuis les mouvements.
 */

export type UUID = string;

/* ---------------------------------------------------------------- Rôles */

export const ROLES = ['OWNER', 'MANAGER', 'PROCUREMENT', 'PREPARER', 'SELLER', 'FINANCE'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  OWNER: 'Owner',
  MANAGER: 'Manager',
  PROCUREMENT: 'Approvisionneur',
  PREPARER: 'Préparateur',
  SELLER: 'Vendeur',
  FINANCE: 'Finance',
};

export interface User {
  id: UUID;
  organizationId: UUID;
  name: string;
  role: Role;
  siteId: UUID;
  status: 'ACTIVE' | 'DISABLED';
}

/* ------------------------------------------------------- Sites & stocks */

export interface Site { id: UUID; organizationId: UUID; name: string }

export type LocationType = 'CENTRAL' | 'KITCHEN' | 'FRIDGE' | 'POS' | 'RESERVE';
export interface StockLocation { id: UUID; siteId: UUID; name: string; type: LocationType }

/* ------------------------------------------------------------ Catalogue */

export type ItemKind = 'RAW_MATERIAL' | 'PACKAGING' | 'INTERMEDIATE' | 'FINISHED';
export type Unit = 'kg' | 'g' | 'L' | 'mL' | 'unite' | 'sachet' | 'bouteille' | 'paquet' | 'carton';

/** Facteurs vers l'unité de base de la famille (g, mL, unité). */
export const UNIT_BASE: Record<Unit, { base: 'g' | 'mL' | 'unite'; factor: number }> = {
  kg: { base: 'g', factor: 1000 },
  g: { base: 'g', factor: 1 },
  L: { base: 'mL', factor: 1000 },
  mL: { base: 'mL', factor: 1 },
  unite: { base: 'unite', factor: 1 },
  sachet: { base: 'unite', factor: 1 },
  bouteille: { base: 'unite', factor: 1 },
  paquet: { base: 'unite', factor: 1 },
  carton: { base: 'unite', factor: 1 },
};

/** Libellés d'unité tels qu'on les écrit à l'écran. */
export const UNIT_LABEL: Record<Unit, string> = {
  kg: 'kg', g: 'g', L: 'L', mL: 'mL', unite: 'unité',
  sachet: 'sachet', bouteille: 'bouteille', paquet: 'paquet', carton: 'carton',
};

export interface Item {
  id: UUID;
  name: string;
  kind: ItemKind;
  unit: Unit;
  /** Seuils d'approvisionnement (§12). */
  minimumStock?: number;
  targetStock?: number;
  preferredSupplierId?: UUID;
  /** Prix de vente TTC pour les produits finis. */
  price?: number;
  /** Coût moyen pondéré courant (FCFA / unité). Recalculé à chaque réception. */
  weightedAvgCost?: number;
  /** Vignette carrée (data URL en local, chemin Supabase Storage en production). */
  imageUrl?: string;
  /** Retiré du catalogue sans être supprimé : l'historique doit rester lisible. */
  archived?: boolean;
}

/* -------------------------------------------------------------- Recettes */

export interface RecipeIngredient { itemId: UUID; quantity: number; unit: Unit }

export interface RecipeVersion {
  id: UUID;
  recipeId: UUID;
  version: number;
  /** RULE-005 : une recette utilisée dans un batch ne peut être réécrite. */
  frozen: boolean;
  ingredients: RecipeIngredient[];
}

export interface Recipe { id: UUID; itemId: UUID; name: string; currentVersionId: UUID }

/* ------------------------------------------------------ Moteur de stock */

export const MOVEMENT_TYPES = [
  'INITIAL',
  'PURCHASE_RECEIPT',
  'PRODUCTION_CONSUMPTION',
  'PRODUCTION_OUTPUT',
  'SALE',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'WASTE',
  'RETURN',
  'ADJUSTMENT',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export interface StockMovement {
  id: UUID;
  organizationId: UUID;
  siteId: UUID;
  locationId: UUID;
  itemId: UUID;
  /** Signée : positive en entrée, négative en sortie. Exprimée dans l'unité de l'article. */
  quantity: number;
  unit: Unit;
  movementType: MovementType;
  referenceType: string;
  referenceId: UUID;
  userId: UUID;
  deviceId: string;
  createdAt: string;
}

/* ------------------------------------------------------ Événements métier */

export const EVENT_TYPES = [
  'PURCHASE_REQUESTED',
  'PURCHASE_ORDER_APPROVED',
  'GOODS_RECEIVED',
  'BATCH_STARTED',
  'BATCH_COMPLETED',
  'STOCK_TRANSFERRED',
  'STOCK_COUNTED',
  'STOCK_VARIANCE_DETECTED',
  'SALE_COMPLETED',
  'SALE_CANCELLED',
  'PAYMENT_RECEIVED',
  'WASTE_RECORDED',
  'EXPENSE_RECORDED',
  'CASH_SESSION_OPENED',
  'CASH_SESSION_CLOSED',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** §53 — chaque mutation porte son état de synchronisation. */
export type SyncStatus = 'LOCAL_ONLY' | 'QUEUED' | 'SYNCING' | 'SYNCED' | 'FAILED' | 'CONFLICT';

export interface DomainEvent<P = unknown> {
  /** §56 — UUID généré localement AVANT toute connexion : clé d'idempotence. */
  id: UUID;
  organizationId: UUID;
  siteId: UUID;
  eventType: EventType;
  entityType: string;
  entityId: UUID;
  actorUserId: UUID;
  deviceId: string;
  payload: P;
  createdAtLocal: string;
  createdAtServer: string | null;
  syncStatus: SyncStatus;
  /** Nombre de tentatives d'envoi — sert au backoff de la file d'attente. */
  attempts: number;
}

/* ----------------------------------------------------------------- Vente */

export type PaymentMethod = 'CASH' | 'MOBILE_MONEY' | 'CARD' | 'OTHER';

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  CASH: 'Espèces',
  MOBILE_MONEY: 'Mobile Money',
  CARD: 'Carte',
  OTHER: 'Autre',
};

export interface SaleLine {
  itemId: UUID;
  name: string;
  quantity: number;
  unitPrice: number;
  /** COGS figé au moment de la vente : le coût d'aujourd'hui n'est pas celui de demain. */
  unitCost: number;
}

export type SaleStatus = 'COMPLETED' | 'VOIDED' | 'REFUNDED';

export interface Sale {
  id: UUID;
  number: number;
  siteId: UUID;
  locationId: UUID;
  cashSessionId: UUID | null;
  sellerId: UUID;
  lines: SaleLine[];
  total: number;
  cogs: number;
  paymentMethod: PaymentMethod;
  amountReceived: number;
  status: SaleStatus;
  /** RULE-001 : une vente finalisée n'est jamais supprimée — elle est annulée avec motif. */
  voidReason?: string;
  voidedBy?: UUID;
  createdAt: string;
}

/* ------------------------------------------------------------ Production */

export interface ProductionBatch {
  id: UUID;
  code: string;
  itemId: UUID;
  recipeVersionId: UUID;
  preparerId: UUID;
  locationId: UUID;
  plannedQuantity: number;
  producedQuantity: number;
  lossQuantity: number;
  startedAt: string;
  completedAt: string | null;
}

/* ------------------------------------------------------------- Caisse */

export interface CashSession {
  id: UUID;
  siteId: UUID;
  sellerId: UUID;
  shiftNumber: number;
  openingCash: number;
  countedCash: number | null;
  openedAt: string;
  closedAt: string | null;
  varianceReason?: string;
}

/* ------------------------------------------------------------ Achats */

export interface Supplier { id: UUID; name: string; phone?: string; contact?: string; notes?: string }

export interface PurchaseLine {
  itemId: UUID;
  quantity: number;
  unit: Unit;
  expectedUnitPrice?: number;
  actualUnitPrice: number;
}

export interface Purchase {
  id: UUID;
  supplierId: UUID;
  locationId: UUID;
  lines: PurchaseLine[];
  transportCost: number;
  total: number;
  paymentMethod: PaymentMethod;
  createdAt: string;
  receivedAt: string | null;
}

export interface PriceObservation {
  itemId: UUID;
  supplierId: UUID;
  unitPrice: number;
  observedAt: string;
}

/* ----------------------------------------------------------- Dépenses */

export type ExpenseCategory =
  | 'MATIERE' | 'EMBALLAGE' | 'TRANSPORT' | 'ENERGIE'
  | 'MARKETING' | 'SALAIRE' | 'REPARATION' | 'EQUIPEMENT' | 'AUTRE';

export const EXPENSE_LABEL: Record<ExpenseCategory, string> = {
  MATIERE: 'Matières', EMBALLAGE: 'Emballages', TRANSPORT: 'Transport', ENERGIE: 'Énergie',
  MARKETING: 'Marketing', SALAIRE: 'Salaires', REPARATION: 'Réparation',
  EQUIPEMENT: 'Équipement', AUTRE: 'Autres',
};

export interface Expense {
  id: UUID;
  amount: number;
  category: ExpenseCategory;
  description: string;
  supplierId?: UUID;
  paymentMethod: PaymentMethod;
  userId: UUID;
  createdAt: string;
}

/* --------------------------------------------------------- Gaspillage */

export type WasteReason = 'CASSE' | 'PERIME' | 'SURDOSAGE' | 'BATCH_RATE' | 'INVENDU' | 'INCONNU';

export const WASTE_LABEL: Record<WasteReason, string> = {
  CASSE: 'Casse', PERIME: 'Périmé', SURDOSAGE: 'Surdosage',
  BATCH_RATE: 'Batch raté', INVENDU: 'Invendu jeté', INCONNU: 'Inconnue',
};

export interface WasteEvent {
  id: UUID;
  itemId: UUID;
  locationId: UUID;
  quantity: number;
  unit: Unit;
  cost: number;
  reason: WasteReason;
  userId: UUID;
  createdAt: string;
}

/* --------------------------------------------------------- Inventaire */

export interface InventoryCountLine { itemId: UUID; theoretical: number; counted: number; reason?: WasteReason }

export interface InventoryCount {
  id: UUID;
  locationId: UUID;
  userId: UUID;
  lines: InventoryCountLine[];
  status: 'DRAFT' | 'VALIDATED';
  createdAt: string;
}

/* ------------------------------------------------------- Notifications */

export type Severity = 'INFO' | 'ATTENTION' | 'ACTION_REQUIRED' | 'CRITICAL';
export type NotificationStatus = 'UNREAD' | 'READ' | 'ACKNOWLEDGED' | 'RESOLVED';

export interface Notification {
  id: UUID;
  title: string;
  body: string;
  severity: Severity;
  status: NotificationStatus;
  /** §48 — une notification propose l'action, elle ne décrit pas seulement le problème. */
  actionLabel?: string;
  actionTarget?: string;
  recipientRoles: Role[];
  createdAt: string;
}

/* -------------------------------------------------------------- Audit */

export interface AuditEvent {
  id: UUID;
  userId: UUID;
  userName: string;
  role: Role;
  action: string;
  detail: string;
  reference?: string;
  createdAt: string;
}
