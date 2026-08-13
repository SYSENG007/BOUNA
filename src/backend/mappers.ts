import {
  MOVEMENT_TYPES, ROLES, UNIT_BASE,
  type AuditEvent, type CashSession, type DomainEvent, type EventType, type Expense,
  type Item, type ItemKind, type LocationType, type MovementType, type Notification,
  type PaymentMethod, type ProductionBatch, type Purchase, type PurchaseLine, type Role,
  type Sale, type SaleLine, type SaleStatus, type Severity, type Site, type StockLocation,
  type StockMovement, type Supplier, type Unit, type User, type UUID, type WasteEvent,
  type WasteReason,
} from '../domain/types';

/**
 * Traduction PostgreSQL → domaine.
 *
 * Module volontairement pur : aucun accès réseau, aucun React. C'est la seule
 * couche qui connaît la forme des lignes de la base, et c'est donc la seule
 * qu'il faut relire quand une migration change une colonne.
 *
 * Deux pièges du transport PostgREST justifient les convertisseurs ci-dessous :
 * un `numeric` arrive en CHAÎNE (« 17.1000 »), et un `timestamptz` arrive dans
 * un format que `new Date()` accepte mais que le reste de l'app n'écrit pas.
 * Laisser passer une chaîne là où l'app attend un nombre donne des additions
 * silencieusement fausses — « 6.2 » + « 18 » = « 6.218 ».
 */

export type Row = Record<string, unknown>;

/* ------------------------------------------------------- Convertisseurs */

export function num(value: unknown, fallback = 0): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

/** Distingue « absent » de « zéro » : un seuil non renseigné n'est pas un seuil à 0. */
export function optNum(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = num(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function str(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return fallback;
  return String(value);
}

export function optStr(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Normalise en ISO. Une date illisible ne doit pas faire tomber l'hydratation. */
export function iso(value: unknown, fallback: string = new Date(0).toISOString()): string {
  if (typeof value !== 'string' || value === '') return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

export function optIso(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Un identifiant serveur est toujours un UUID. Les identifiants de démonstration
 * (« loc-pos », « cs-shift-2 ») n'en sont pas : les envoyer à une fonction
 * PostgreSQL provoque une erreur de cast, pas un rejet métier lisible.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is UUID {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** Renvoie l'identifiant s'il est un UUID serveur, sinon null. */
export function asUuid(value: unknown): UUID | null {
  return isUuid(value) ? value : null;
}

/* --------------------------------------------------------- Énumérations */

const UNITS = new Set(Object.keys(UNIT_BASE));
const KINDS = new Set<string>(['RAW_MATERIAL', 'PACKAGING', 'INTERMEDIATE', 'FINISHED']);
const LOCATION_TYPES = new Set<string>(['CENTRAL', 'KITCHEN', 'FRIDGE', 'POS', 'RESERVE']);
const MOVEMENTS = new Set<string>(MOVEMENT_TYPES);
const ROLE_SET = new Set<string>(ROLES);
const SEVERITIES = new Set<string>(['INFO', 'ATTENTION', 'ACTION_REQUIRED', 'CRITICAL']);
const PAYMENTS = new Set<string>(['CASH', 'MOBILE_MONEY', 'CARD', 'OTHER']);
const WASTE_REASONS = new Set<string>(['CASSE', 'PERIME', 'SURDOSAGE', 'BATCH_RATE', 'INVENDU', 'INCONNU']);

export function unit(value: unknown, fallback: Unit = 'unite'): Unit {
  return UNITS.has(str(value)) ? (value as Unit) : fallback;
}

export function itemKind(value: unknown): ItemKind {
  return KINDS.has(str(value)) ? (value as ItemKind) : 'RAW_MATERIAL';
}

export function locationType(value: unknown): LocationType {
  return LOCATION_TYPES.has(str(value)) ? (value as LocationType) : 'RESERVE';
}

export function movementType(value: unknown): MovementType {
  return MOVEMENTS.has(str(value)) ? (value as MovementType) : 'ADJUSTMENT';
}

export function role(value: unknown): Role {
  return ROLE_SET.has(str(value)) ? (value as Role) : 'SELLER';
}

export function severity(value: unknown): Severity {
  return SEVERITIES.has(str(value)) ? (value as Severity) : 'INFO';
}

export function paymentMethod(value: unknown): PaymentMethod {
  return PAYMENTS.has(str(value)) ? (value as PaymentMethod) : 'CASH';
}

export function wasteReason(value: unknown): WasteReason {
  return WASTE_REASONS.has(str(value)) ? (value as WasteReason) : 'INCONNU';
}

/* ------------------------------------------------------------ Référentiels */

export function mapSite(row: Row): Site {
  return {
    id: str(row.id),
    organizationId: str(row.organization_id),
    name: str(row.name, 'Site'),
  };
}

export function mapLocation(row: Row): StockLocation {
  return {
    id: str(row.id),
    siteId: str(row.site_id),
    name: str(row.name, 'Emplacement'),
    type: locationType(row.type),
  };
}

export function mapSupplier(row: Row): Supplier {
  return {
    id: str(row.id),
    name: str(row.name, 'Fournisseur'),
    phone: optStr(row.phone),
    contact: optStr(row.contact),
    notes: optStr(row.notes),
  };
}

export function mapProfile(row: Row): User {
  return {
    id: str(row.id),
    organizationId: str(row.organization_id),
    name: str(row.name, '—'),
    roles: [role(row.role)],
    siteId: str(row.site_id),
    status: str(row.status) === 'DISABLED' ? 'DISABLED' : 'ACTIVE',
  };
}

/**
 * `active` en base, `archived` dans le domaine : la base dit ce qui sert,
 * l'interface dit ce qui a été retiré. Même fait, deux vocabulaires.
 */
export function mapItem(row: Row): Item {
  return {
    id: str(row.id),
    name: str(row.name, 'Article'),
    kind: itemKind(row.kind),
    unit: unit(row.unit),
    minimumStock: optNum(row.minimum_stock),
    targetStock: optNum(row.target_stock),
    preferredSupplierId: optStr(row.preferred_supplier_id),
    price: optNum(row.price),
    weightedAvgCost: num(row.weighted_avg_cost),
    imageUrl: optStr(row.image_url),
    archived: row.active === false,
  };
}

/* --------------------------------------------------------------- Stock */

/**
 * RULE-002 : on charge des MOUVEMENTS, jamais un niveau. La quantité reste
 * signée telle qu'elle a été écrite — le repli est fait par `projectStock()`.
 */
export function mapMovement(row: Row): StockMovement {
  return {
    id: str(row.id),
    organizationId: str(row.organization_id),
    siteId: str(row.site_id),
    locationId: str(row.location_id),
    itemId: str(row.item_id),
    quantity: num(row.quantity),
    unit: unit(row.unit),
    movementType: movementType(row.movement_type),
    referenceType: str(row.reference_type, 'Unknown'),
    referenceId: str(row.reference_id),
    userId: str(row.user_id),
    deviceId: str(row.device_id, 'serveur'),
    createdAt: iso(row.created_at),
  };
}

/** Ligne de la vue `stock_levels` — vérification croisée uniquement (jamais une source). */
export interface StockLevelRow { itemId: UUID; locationId: UUID; quantity: number }

export function mapStockLevel(row: Row): StockLevelRow {
  return {
    itemId: str(row.item_id),
    locationId: str(row.location_id),
    quantity: num(row.quantity),
  };
}

/* --------------------------------------------------------------- Ventes */

export function mapSaleLine(row: Row): SaleLine {
  return {
    itemId: str(row.item_id),
    name: str(row.name, 'Article'),
    quantity: num(row.quantity),
    unitPrice: num(row.unit_price),
    unitCost: num(row.unit_cost),
  };
}

export function mapSale(row: Row): Sale {
  const rawLines = Array.isArray(row.sale_lines) ? (row.sale_lines as Row[]) : [];
  const status = str(row.status, 'COMPLETED');
  return {
    id: str(row.id),
    number: num(row.number),
    siteId: str(row.site_id),
    locationId: str(row.location_id),
    cashSessionId: optStr(row.cash_session_id) ?? null,
    sellerId: str(row.seller_id),
    lines: rawLines.map(mapSaleLine),
    total: num(row.total),
    cogs: num(row.cogs),
    paymentMethod: paymentMethod(row.payment_method),
    amountReceived: num(row.amount_received),
    status: (['COMPLETED', 'VOIDED', 'REFUNDED'].includes(status) ? status : 'COMPLETED') as SaleStatus,
    voidReason: optStr(row.void_reason),
    voidedBy: optStr(row.voided_by),
    createdAt: iso(row.created_at),
  };
}

export function mapCashSession(row: Row): CashSession {
  return {
    id: str(row.id),
    siteId: str(row.site_id),
    sellerId: str(row.seller_id),
    shiftNumber: num(row.shift_number, 1),
    openingCash: num(row.opening_cash),
    countedCash: optNum(row.counted_cash) ?? null,
    openedAt: iso(row.opened_at),
    closedAt: optIso(row.closed_at),
    varianceReason: optStr(row.variance_reason),
  };
}

/* -------------------------------------------------- Achats & production */

export function mapPurchaseLine(row: Row): PurchaseLine {
  return {
    itemId: str(row.item_id),
    quantity: num(row.quantity),
    unit: unit(row.unit),
    expectedUnitPrice: optNum(row.expected_unit_price),
    actualUnitPrice: num(row.actual_unit_price),
  };
}

export function mapPurchase(row: Row): Purchase {
  const rawLines = Array.isArray(row.purchase_lines) ? (row.purchase_lines as Row[]) : [];
  return {
    id: str(row.id),
    supplierId: str(row.supplier_id),
    locationId: str(row.location_id),
    lines: rawLines.map(mapPurchaseLine),
    transportCost: num(row.transport_cost),
    total: num(row.total),
    paymentMethod: paymentMethod(row.payment_method),
    createdAt: iso(row.created_at),
    receivedAt: optIso(row.received_at),
  };
}

export function mapBatch(row: Row): ProductionBatch {
  return {
    id: str(row.id),
    code: str(row.code, '—'),
    itemId: str(row.item_id),
    recipeVersionId: str(row.recipe_version_id),
    preparerId: str(row.preparer_id),
    locationId: str(row.location_id),
    plannedQuantity: num(row.planned_quantity),
    producedQuantity: num(row.produced_quantity),
    lossQuantity: num(row.loss_quantity),
    startedAt: iso(row.started_at),
    completedAt: optIso(row.completed_at),
  };
}

/* ------------------------------------------------------------- Finance */

export function mapExpense(row: Row): Expense {
  return {
    id: str(row.id),
    amount: num(row.amount),
    category: str(row.category, 'AUTRE') as Expense['category'],
    description: str(row.description, '—'),
    supplierId: optStr(row.supplier_id),
    paymentMethod: paymentMethod(row.payment_method),
    userId: str(row.user_id),
    createdAt: iso(row.created_at),
  };
}

export function mapWaste(row: Row): WasteEvent {
  return {
    id: str(row.id),
    itemId: str(row.item_id),
    locationId: str(row.location_id),
    quantity: num(row.quantity),
    unit: unit(row.unit),
    cost: num(row.cost),
    reason: wasteReason(row.reason),
    userId: str(row.user_id),
    createdAt: iso(row.created_at),
  };
}

/* ------------------------------------------ Journal, audit, alertes */

/**
 * Un événement lu depuis `domain_events` est par définition arrivé : il est
 * SYNCED, et il ne repartira jamais dans la file. `attempts` retombe à 0.
 */
export function mapDomainEvent(row: Row): DomainEvent {
  return {
    id: str(row.id),
    organizationId: str(row.organization_id),
    siteId: str(row.site_id),
    eventType: str(row.event_type) as EventType,
    entityType: str(row.entity_type, 'Unknown'),
    entityId: str(row.entity_id),
    actorUserId: str(row.actor_user_id),
    deviceId: str(row.device_id, 'serveur'),
    payload: (row.payload ?? {}) as unknown,
    createdAtLocal: iso(row.created_at_local),
    createdAtServer: optIso(row.created_at_server),
    syncStatus: 'SYNCED',
    attempts: 0,
  };
}

export function mapAudit(row: Row): AuditEvent {
  return {
    id: str(row.id),
    userId: str(row.user_id),
    userName: str(row.user_name, '—'),
    role: role(row.role),
    action: str(row.action, '—'),
    detail: str(row.detail),
    reference: optStr(row.reference),
    createdAt: iso(row.created_at),
  };
}

/**
 * La base adresse une notification à une PERSONNE (`recipient_user_id`) ; le
 * domaine l'adresse à des RÔLES. On rattache donc la ligne au rôle de celui
 * qui la lit — c'est bien à lui qu'elle est destinée, puisque RLS ne lui a
 * montré que les siennes.
 *
 * Le statut n'est pas stocké : il se déduit des horodatages, du plus engageant
 * au moins engageant.
 */
export function mapNotification(row: Row, viewerRole: Role): Notification {
  const status: Notification['status'] = row.resolved_at
    ? 'RESOLVED'
    : row.acknowledged_at
      ? 'ACKNOWLEDGED'
      : row.read_at
        ? 'READ'
        : 'UNREAD';

  return {
    id: str(row.id),
    title: str(row.title, 'Alerte'),
    body: str(row.body),
    severity: severity(row.severity),
    status,
    actionLabel: optStr(row.action_type),
    actionTarget: optStr(row.action_target),
    recipientRoles: [viewerRole],
    createdAt: iso(row.created_at),
  };
}
