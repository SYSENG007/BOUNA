import { describe, expect, it } from 'vitest';
import { buildArgs } from '../../backend/transport';
import type { DomainEvent, EventType } from '../types';

/**
 * Les arguments envoyés doivent correspondre aux fonctions qui les reçoivent.
 *
 * C'est le défaut que rien d'autre n'attrape. `buildArgs` construit un objet
 * libre : TypeScript ne sait pas qu'il finira en arguments nommés d'une
 * fonction PostgreSQL, donc une clé mal orthographiée compile, passe les
 * tests, et ne se voit qu'en production — soit en `42883` (aucune fonction de
 * cette signature), soit pire, en paramètre resté NULL qui casse une
 * contrainte NOT NULL. Dans les deux cas la vente ou la perte n'arrive jamais
 * en base, et l'écran affiche « synchronisé ».
 *
 * SIGNATURES RELEVÉES EN PRODUCTION le 15 août 2026, via
 * `pg_get_function_identity_arguments`. Ce ne sont pas des suppositions : si
 * elles changent en base, ce test doit être remis à jour dans le même
 * changement que la migration — c'est précisément ce qu'on veut rendre visible.
 */
const REQUIRED: Record<string, string[]> = {
  complete_sale: [
    'p_event_id', 'p_site_id', 'p_location_id', 'p_cash_session_id', 'p_payment_method',
    'p_amount_received', 'p_lines', 'p_created_at_local', 'p_device_id',
  ],
  void_sale: ['p_event_id', 'p_sale_id', 'p_reason'],
  receive_goods: [
    'p_event_id', 'p_site_id', 'p_location_id', 'p_supplier_id', 'p_lines',
    'p_transport_cost', 'p_payment_method',
  ],
  record_waste: [
    'p_event_id', 'p_waste_id', 'p_site_id', 'p_location_id', 'p_item_id',
    'p_quantity', 'p_unit', 'p_cost', 'p_reason',
  ],
  transfer_stock: [
    'p_event_id', 'p_transfer_id', 'p_site_id', 'p_item_id', 'p_from_location_id',
    'p_to_location_id', 'p_quantity', 'p_unit',
  ],
  apply_inventory_count: [
    'p_event_id', 'p_count_id', 'p_site_id', 'p_location_id', 'p_item_id', 'p_unit',
    'p_theoretical', 'p_counted', 'p_delta', 'p_reason',
  ],
  complete_batch: [
    'p_event_id', 'p_batch_id', 'p_site_id', 'p_code', 'p_item_id', 'p_recipe_version_id',
    'p_location_id', 'p_planned', 'p_produced', 'p_loss',
  ],
  record_expense: [
    'p_event_id', 'p_expense_id', 'p_site_id', 'p_amount', 'p_category', 'p_description',
  ],
  open_cash_session: [
    'p_event_id', 'p_cash_session_id', 'p_site_id', 'p_shift_number', 'p_opening_cash',
  ],
  close_cash_session: [
    'p_event_id', 'p_cash_session_id', 'p_site_id', 'p_shift_number', 'p_opening_cash',
    'p_expected', 'p_counted_cash', 'p_variance',
  ],
  resolve_variance: [
    'p_event_id', 'p_variance_id', 'p_site_id', 'p_source', 'p_reference_id', 'p_subject',
    'p_theoretical', 'p_declared', 'p_delta', 'p_amount', 'p_resolution',
  ],
  // Signature relevée en base le 15 août 2026 : ni `p_event_id` ni les autres
  // colonnes de traçabilité — l'idempotence de ces deux fonctions tient à leur
  // propre logique (accorder un droit déjà actif rend l'accord existant).
  grant_capability: ['p_user_id', 'p_capability'],
  revoke_capability: ['p_user_id', 'p_capability'],
};

/** Paramètres à valeur par défaut : facultatifs, mais pas inventables. */
const OPTIONAL: Record<string, string[]> = {
  complete_sale: [],
  void_sale: [],
  receive_goods: [],
  record_waste: ['p_created_at_local', 'p_device_id'],
  transfer_stock: ['p_created_at_local', 'p_device_id'],
  apply_inventory_count: ['p_variance_id', 'p_variance_amount', 'p_created_at_local', 'p_device_id'],
  complete_batch: ['p_consumption', 'p_variance_id', 'p_variance_amount', 'p_created_at_local', 'p_device_id'],
  record_expense: [
    'p_supplier_id', 'p_payment_method', 'p_created_at_local', 'p_device_id',
    'p_variance_id', 'p_variance_amount', 'p_variance_subject',
  ],
  open_cash_session: ['p_created_at_local', 'p_device_id'],
  close_cash_session: ['p_reason', 'p_variance_id', 'p_created_at_local', 'p_device_id'],
  resolve_variance: ['p_note', 'p_detected_at', 'p_created_at_local', 'p_device_id'],
  grant_capability: [],
  revoke_capability: [],
};

/** La fonction appelée pour chaque type d'événement (voir `RPC_BY_EVENT`). */
const RPC: Partial<Record<EventType, string>> = {
  SALE_COMPLETED: 'complete_sale',
  SALE_CANCELLED: 'void_sale',
  GOODS_RECEIVED: 'receive_goods',
  WASTE_RECORDED: 'record_waste',
  STOCK_TRANSFERRED: 'transfer_stock',
  STOCK_COUNTED: 'apply_inventory_count',
  BATCH_COMPLETED: 'complete_batch',
  EXPENSE_RECORDED: 'record_expense',
  CASH_SESSION_OPENED: 'open_cash_session',
  CASH_SESSION_CLOSED: 'close_cash_session',
  STOCK_VARIANCE_DETECTED: 'resolve_variance',
  CAPABILITY_GRANTED: 'grant_capability',
  CAPABILITY_REVOKED: 'revoke_capability',
};

const ID = '00000000-0000-0000-0000-0000000000aa';

/** Charges utiles telles que le store les émet réellement. */
const PAYLOADS: Partial<Record<EventType, Record<string, unknown>>> = {
  SALE_COMPLETED: {
    locationId: ID, cashSessionId: ID, paymentMethod: 'CASH', amountReceived: 1000,
    lines: [{ itemId: ID, name: 'Café · Grand', quantity: 1, unitPrice: 1000, unitCost: 0 }],
  },
  SALE_CANCELLED: { reason: 'erreur de saisie' },
  GOODS_RECEIVED: {
    locationId: ID, supplierId: ID, transportCost: 0, paymentMethod: 'CASH',
    lines: [{ itemId: ID, quantity: 2, unitPrice: 500, unit: 'unite' }],
  },
  WASTE_RECORDED: {
    itemId: ID, locationId: ID, quantity: 1, unit: 'unite', cost: 250, reason: 'CASSE',
  },
  STOCK_TRANSFERRED: { itemId: ID, from: ID, to: ID, quantity: 3, unit: 'unite' },
  STOCK_COUNTED: {
    countId: ID, itemId: ID, locationId: ID, unit: 'unite',
    theoretical: 10, counted: 8, delta: -2, reason: 'INCONNU',
  },
  BATCH_COMPLETED: {
    batchId: ID, code: 'B-001', itemId: ID, recipeVersionId: ID, locationId: ID,
    planned: 10, produced: 9, loss: 1, yieldPct: 90,
    consumption: [{ itemId: ID, quantity: -2, unit: 'kg' }],
  },
  EXPENSE_RECORDED: {
    expenseId: ID, amount: 5000, category: 'TRANSPORT', description: 'Taxi',
    paymentMethod: 'CASH',
  },
  CASH_SESSION_OPENED: { cashSessionId: ID, shiftNumber: 2, openingCash: 5000 },
  CASH_SESSION_CLOSED: {
    cashSessionId: ID, shiftNumber: 2, openingCash: 5000,
    expected: 12000, countedCash: 11500, variance: -500, reason: 'rendu de monnaie',
  },
  STOCK_VARIANCE_DETECTED: {
    siteId: ID, source: 'DEBT', referenceId: ID, subject: 'Emprunt — Bouna',
    theoretical: 0, declared: 3000, delta: 3000, amount: 3000,
    detectedAt: '2026-08-15T09:00:00.000Z', resolution: 'REMBOURSE', note: undefined,
  },
  CAPABILITY_GRANTED: { userId: ID, capability: 'RECORD_WASTE' },
  CAPABILITY_REVOKED: { userId: ID, capability: 'RECORD_WASTE' },
};

function eventOf(eventType: EventType): DomainEvent {
  return {
    id: ID,
    organizationId: ID,
    siteId: ID,
    eventType,
    entityType: 'Test',
    entityId: ID,
    actorUserId: ID,
    deviceId: 'device-test',
    payload: PAYLOADS[eventType] ?? {},
    createdAtLocal: '2026-08-15T09:00:00.000Z',
    createdAtServer: null,
    syncStatus: 'QUEUED',
    attempts: 0,
  };
}

describe('arguments RPC', () => {
  const types = Object.keys(RPC) as EventType[];

  it('couvre treize des dix-sept types d\'événements', () => {
    expect(types).toHaveLength(13);
  });

  it.each(types)('%s : aucun argument inconnu de la fonction', (eventType) => {
    const fn = RPC[eventType]!;
    const permis = new Set([...REQUIRED[fn], ...OPTIONAL[fn]]);
    const inconnus = Object.keys(buildArgs(eventOf(eventType))).filter((k) => !permis.has(k));

    // Un argument que la fonction ne connaît pas la rend introuvable (42883) :
    // l'événement part, échoue, et sort de la file en CONFLICT.
    expect(inconnus).toEqual([]);
  });

  it.each(types)('%s : tous les arguments obligatoires sont fournis', (eventType) => {
    const fn = RPC[eventType]!;
    const args = buildArgs(eventOf(eventType));
    const manquants = REQUIRED[fn].filter((p) => !(p in args));

    expect(manquants).toEqual([]);
  });

  it.each(types)('%s : aucun argument obligatoire laissé à undefined', (eventType) => {
    const fn = RPC[eventType]!;
    const args = buildArgs(eventOf(eventType));

    // `undefined` traverse JSON en clé absente : le paramètre reprend sa valeur
    // par défaut, et une colonne NOT NULL casse à l'insertion — c'est le mode
    // de panne qui a coûté la perte de `locationId` sur WASTE_RECORDED.
    const vides = REQUIRED[fn].filter((p) => args[p] === undefined);

    expect(vides).toEqual([]);
  });
});
