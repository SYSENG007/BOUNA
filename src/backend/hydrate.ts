import type {
  AuditEvent, CashSession, DomainEvent, Expense, Item, Notification, ProductionBatch,
  Purchase, Role, Sale, Site, StockLocation, StockMovement, Supplier, User, UUID,
  WasteEvent,
} from '../domain/types';
import { supabase } from './supabase';
import {
  mapAudit, mapBatch, mapCashSession, mapDomainEvent, mapExpense, mapItem, mapLocation,
  mapMovement, mapNotification, mapProfile, mapPurchase, mapSale, mapSite, mapStockLevel,
  mapSupplier, mapWaste, type Row, type StockLevelRow,
} from './mappers';

/**
 * Chargement de l'état réel depuis PostgreSQL.
 *
 * Le principe tient en une phrase : on charge des FAITS, pas des états. Les
 * mouvements de stock arrivent ligne à ligne et le niveau est reprojeté côté
 * client (RULE-002). La vue `stock_levels` est lue, mais uniquement pour
 * vérifier que la projection locale et le serveur racontent la même histoire —
 * jamais pour alimenter un écran.
 *
 * Rien ici ne bloque le rendu : l'appelant affiche l'état local immédiatement
 * et remplace quand l'instantané arrive (RULE-010).
 */

/** Au-delà, on soupçonne une troncature et le stock projeté ne serait plus fiable. */
const MOVEMENT_LIMIT = 10_000;
/** L'historique visible n'a pas besoin d'être exhaustif — il tient en mémoire et en localStorage. */
const HISTORY_LIMIT = 200;

export interface Snapshot {
  organizationId: UUID;
  site: Site | null;
  locations: StockLocation[];
  suppliers: Supplier[];
  users: User[];
  items: Item[];
  movements: StockMovement[];
  sales: Sale[];
  expenses: Expense[];
  waste: WasteEvent[];
  batches: ProductionBatch[];
  purchases: Purchase[];
  cashSession: CashSession | null;
  notifications: Notification[];
  audit: AuditEvent[];
  events: DomainEvent[];
  /** Numéro de vente le plus élevé connu du serveur : la numérotation continue. */
  saleCounter: number;
  /** Ce que le serveur pense du stock. Sert au contrôle, pas à l'affichage. */
  stockLevels: StockLevelRow[];
  /** Tables qui n'ont pas répondu. Non vide ≠ échec : RLS filtre légitimement. */
  problems: string[];
}

interface Fetched { rows: Row[]; error: string | null }

/** Le constructeur de requête Supabase est « thenable » : c'est tout ce qu'on exige. */
type Queryable = PromiseLike<{ data: unknown; error: unknown }>;

function reason(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message);
  return 'échec inconnu';
}

/** Une requête qui échoue ne doit pas emporter les autres : on isole chaque table. */
async function fetchRows(table: string, run: () => Queryable): Promise<Fetched> {
  try {
    const { data, error } = await run();
    if (error) return { rows: [], error: `${table} : ${reason(error)}` };
    return { rows: Array.isArray(data) ? (data as Row[]) : [], error: null };
  } catch (cause) {
    return { rows: [], error: `${table} : ${reason(cause)}` };
  }
}

/**
 * Instantané complet de l'organisation.
 *
 * Renvoie `null` quand le socle (articles, emplacements) n'a pas pu être lu :
 * mieux vaut garder l'état local que le remplacer par un état vide. Une
 * hydratation partielle qui vide le catalogue est pire qu'une hydratation
 * qui n'a pas eu lieu.
 */
export async function fetchSnapshot(profile: User): Promise<Snapshot | null> {
  if (!supabase) return null;

  const db = supabase;
  const orgId = profile.organizationId;
  const siteId = profile.siteId;
  const recent = { ascending: false } as const;

  const [
    sites, locations, suppliers, profiles, items, movements, sales, expenses,
    waste, batches, purchases, cashSessions, notifications, audit, events, levels,
  ] = await Promise.all([
    fetchRows('sites', () => db.from('sites').select('*').eq('organization_id', orgId)),
    fetchRows('stock_locations', () => db.from('stock_locations').select('*').eq('site_id', siteId)),
    fetchRows('suppliers', () => db.from('suppliers').select('*').eq('organization_id', orgId).order('name')),
    fetchRows('profiles', () => db.from('profiles').select('*').eq('organization_id', orgId).order('name')),
    fetchRows('items', () => db.from('items').select('*').eq('organization_id', orgId).order('name')),
    // Ordre chronologique : un mouvement est un fait daté, la projection les replie dans l'ordre.
    fetchRows('stock_movements', () => db.from('stock_movements').select('*')
      .eq('organization_id', orgId).order('created_at', { ascending: true }).limit(MOVEMENT_LIMIT)),
    fetchRows('sales', () => db.from('sales').select('*, sale_lines(*)')
      .eq('organization_id', orgId).order('created_at', recent).limit(HISTORY_LIMIT)),
    fetchRows('expenses', () => db.from('expenses').select('*')
      .eq('organization_id', orgId).order('created_at', recent).limit(HISTORY_LIMIT)),
    fetchRows('waste_events', () => db.from('waste_events').select('*')
      .eq('organization_id', orgId).order('created_at', recent).limit(HISTORY_LIMIT)),
    fetchRows('production_batches', () => db.from('production_batches').select('*')
      .eq('organization_id', orgId).order('started_at', recent).limit(HISTORY_LIMIT)),
    fetchRows('purchases', () => db.from('purchases').select('*, purchase_lines(*)')
      .eq('organization_id', orgId).order('created_at', recent).limit(HISTORY_LIMIT)),
    // La caisse ouverte du site, s'il y en a une : c'est celle qu'on rattache aux ventes.
    fetchRows('cash_sessions', () => db.from('cash_sessions').select('*')
      .eq('site_id', siteId).is('closed_at', null).order('opened_at', recent).limit(1)),
    // RLS n'expose déjà que les notifications de l'utilisateur : pas de filtre à ajouter.
    fetchRows('notifications', () => db.from('notifications').select('*')
      .order('created_at', recent).limit(HISTORY_LIMIT)),
    fetchRows('audit_events', () => db.from('audit_events').select('*')
      .eq('organization_id', orgId).order('created_at', recent).limit(HISTORY_LIMIT)),
    fetchRows('domain_events', () => db.from('domain_events').select('*')
      .eq('organization_id', orgId).order('created_at_server', recent).limit(HISTORY_LIMIT)),
    fetchRows('stock_levels', () => db.from('stock_levels').select('*').eq('organization_id', orgId)),
  ]);

  // Sans catalogue ni emplacements, il n'y a pas d'application : on renonce.
  if (items.error || locations.error || !items.rows.length) return null;

  const problems = [
    sites, locations, suppliers, profiles, items, movements, sales, expenses,
    waste, batches, purchases, cashSessions, notifications, audit, events, levels,
  ]
    .map((f) => f.error)
    .filter((e): e is string => e !== null);

  if (movements.rows.length >= MOVEMENT_LIMIT) {
    problems.push(
      `stock_movements : ${MOVEMENT_LIMIT} lignes atteintes, le stock projeté peut être incomplet`,
    );
  }

  const mappedSales = sales.rows.map(mapSale);
  const viewerRole: Role = profile.role;

  return {
    organizationId: orgId,
    site: sites.rows.map(mapSite).find((s) => s.id === siteId) ?? sites.rows.map(mapSite)[0] ?? null,
    locations: locations.rows.map(mapLocation),
    suppliers: suppliers.rows.map(mapSupplier),
    users: profiles.rows.map(mapProfile),
    items: items.rows.map(mapItem),
    movements: movements.rows.map(mapMovement),
    sales: mappedSales,
    expenses: expenses.rows.map(mapExpense),
    waste: waste.rows.map(mapWaste),
    batches: batches.rows.map(mapBatch),
    purchases: purchases.rows.map(mapPurchase),
    cashSession: cashSessions.rows.length ? mapCashSession(cashSessions.rows[0]) : null,
    notifications: notifications.rows.map((r) => mapNotification(r, viewerRole)),
    audit: audit.rows.map(mapAudit),
    events: events.rows.map(mapDomainEvent),
    saleCounter: mappedSales.reduce((max, s) => Math.max(max, s.number), 0),
    stockLevels: levels.rows.map(mapStockLevel),
    problems,
  };
}

/* --------------------------------------------------- Vérification croisée */

export interface StockDiscrepancy {
  itemId: UUID;
  locationId: UUID;
  projected: number;
  server: number;
}

/**
 * Compare la projection locale à la vue `stock_levels`.
 *
 * La vue n'est PAS la source : elle est un second témoin. Un désaccord signale
 * une troncature de la liste des mouvements ou une conversion d'unité qui
 * diverge entre SQL et TypeScript — deux pannes qu'on ne verrait jamais en
 * regardant un seul des deux côtés.
 */
export function crossCheckStock(
  projected: Map<string, number>,
  levels: StockLevelRow[],
  tolerance = 0.01,
): StockDiscrepancy[] {
  const out: StockDiscrepancy[] = [];
  const seen = new Set<string>();

  for (const level of levels) {
    const key = `${level.itemId}@${level.locationId}`;
    seen.add(key);
    const local = projected.get(key) ?? 0;
    if (Math.abs(local - level.quantity) > tolerance) {
      out.push({
        itemId: level.itemId,
        locationId: level.locationId,
        projected: local,
        server: level.quantity,
      });
    }
  }

  // Une clé projetée localement mais absente de la vue compte aussi comme un écart.
  for (const [key, local] of projected) {
    if (seen.has(key) || Math.abs(local) <= tolerance) continue;
    const [itemId, locationId] = key.split('@');
    out.push({ itemId, locationId, projected: local, server: 0 });
  }

  return out;
}
