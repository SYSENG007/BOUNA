import { describe, expect, it } from 'vitest';
import { buildArgs, classify } from '../../backend/transport';
import { itemRow, mapItem } from '../../backend/mappers';
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
  set_operating_mode: ['p_event_id', 'p_site_id', 'p_mode'],
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
  set_operating_mode: ['p_created_at_local', 'p_device_id'],
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
  OPERATING_MODE_SET: 'set_operating_mode',
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
    consumption: [{ itemId: ID, quantity: -2, unit: 'kg', locationId: ID }],
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
  OPERATING_MODE_SET: { mode: 'PRECIS' },
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

  it("couvre les quatorze types d'événements qui ont une transaction dédiée", () => {
    /* Les autres — paiement, demandes d'achat, faits de clôture — sont
       journalisés tels quels dans `domain_events` : un fait sans projection à
       recalculer n'a pas besoin d'une fonction pour l'accueillir. */
    expect(types).toHaveLength(14);
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

/**
 * Le catalogue ne passe pas par une fonction transactionnelle : il écrit sa
 * ligne dans `items`, protégé par RLS (`items_update` exige MANAGE_CATALOG).
 * Ce qui compte ici, c'est que la fiche envoyée porte les colonnes de la
 * table — une clé en camelCase compilerait et serait refusée en production.
 */
describe('CATALOG_ITEM_SAVED — la fiche écrite en base', () => {
  /*
   * Les colonnes de `public.items`, relevées dans les migrations (0001 puis
   * 0008/0011). Une clé absente de cette liste est refusée par PostgREST en
   * 42703 — et cet envoi-là ne réussira jamais. C'est exactement ce qui est
   * arrivé à `image_url`, qui n'a jamais existé dans la table alors que le
   * domaine porte un `imageUrl` : la photo reste sur l'appareil.
   */
  const COLUMNS = [
    'id', 'organization_id', 'name', 'kind', 'unit', 'minimum_stock',
    'target_stock', 'reorder_point', 'lead_time_hours', 'preferred_supplier_id',
    'price', 'weighted_avg_cost', 'active', 'production_mode',
  ];

  const item = {
    id: 'it-1', name: 'Café Touba · Moyen', kind: 'FINISHED' as const, unit: 'unite' as const,
    price: 700, weightedAvgCost: 120, minimumStock: 5, targetStock: 20,
  };

  it("n'écrit que des colonnes de la table, en snake_case", () => {
    const row = itemRow(item, 'org-1');
    for (const key of Object.keys(row)) expect(COLUMNS).toContain(key);
    expect(row.id).toBe('it-1');
    expect(row.organization_id).toBe('org-1');
    expect(row.price).toBe(700);
  });

  /* `archived` côté domaine, `active` côté base : le même fait, deux mots. */
  it('traduit archivé en inactif', () => {
    expect(itemRow(item, 'o').active).toBe(true);
    expect(itemRow({ ...item, archived: true }, 'o').active).toBe(false);
  });

  /*
   * Le coût moyen pondéré est dérivé des réceptions et recalculé par le
   * serveur. S'il partait à chaque enregistrement, un manager corrigeant un
   * prix écraserait le coût recalculé par la dernière réception avec la
   * valeur qu'avait son appareil avant celle-ci.
   */
  it('ne renvoie jamais le coût moyen pondéré de lui-même', () => {
    expect(itemRow(item, 'o')).not.toHaveProperty('weighted_avg_cost');
  });

  /* La colonne n'existe pas : l'envoyer condamnait chaque enregistrement. */
  it("n'envoie pas la photo, que la table ne sait pas stocker", () => {
    expect(itemRow({ ...item, imageUrl: 'data:image/png;base64,xxx' }, 'o'))
      .not.toHaveProperty('image_url');
  });

  it('vide les seuils absents plutôt que de les omettre', () => {
    const row = itemRow({ ...item, minimumStock: undefined, targetStock: undefined }, 'o');
    expect(row.minimum_stock).toBeNull();
    expect(row.target_stock).toBeNull();
  });

  /*
   * Le mode décide si le comptoir accepte de vendre. Tant qu'il n'était ni lu
   * ni écrit, tout article venu du serveur arrivait sans mode — donc traité en
   * « préparé d'avance », donc en rupture permanente : la carte entière
   * devenait invendable, et le choix fait à l'écran ne survivait à aucun
   * rechargement.
   */
  it('écrit le mode de production, et le relit tel quel', () => {
    expect(itemRow({ ...item, productionMode: 'MADE_TO_ORDER' }, 'o').production_mode)
      .toBe('MADE_TO_ORDER');
    expect(mapItem({ id: 'i', name: 'Café', kind: 'FINISHED', unit: 'unite', production_mode: 'MADE_TO_ORDER' }).productionMode)
      .toBe('MADE_TO_ORDER');
  });

  it("retombe sur « préparé d'avance » quand la base ne dit rien, comme sa colonne", () => {
    expect(itemRow({ ...item, productionMode: undefined }, 'o').production_mode).toBe('BATCH');
    expect(mapItem({ id: 'i', name: 'Café', kind: 'FINISHED', unit: 'unite' }).productionMode).toBe('BATCH');
  });
});


/**
 * Une erreur de schéma ne se réessaie pas — et surtout, elle ne doit pas
 * bloquer le reste.
 *
 * Un événement qui échoue sans fin garde la file non vide, et une file non
 * vide empêche l'hydratation de tourner : c'est la garde qui protège une
 * vente hors ligne d'être écrasée par un instantané serveur. Une seule
 * colonne mal nommée gelait donc TOUTE la synchronisation de l'appareil, en
 * silence, jusqu'au prochain vidage de cache.
 */
describe('un événement impossible sort de la file au lieu de la geler', () => {
  const pg = (code: string) => ({ code, message: 'erreur postgres' });

  it('traite une colonne ou une table inexistante comme un refus définitif', () => {
    expect(classify(pg('42703'))).toBe('CONFLICT');
    expect(classify(pg('42P01'))).toBe('CONFLICT');
  });

  it('continue de réessayer ce qui peut encore marcher', () => {
    /* Panne réseau, serveur indisponible, cache PostgREST à rafraîchir. */
    expect(classify(pg('PGRST204'))).toBe('FAILED');
    expect(classify(new Error('network error'))).toBe('FAILED');
  });

  it('laisse les refus métier et RLS sortir de la file', () => {
    expect(classify(pg('P0001'))).toBe('CONFLICT');
    expect(classify(pg('42501'))).toBe('CONFLICT');
  });

  it("compte un doublon comme déjà appliqué — c'est la promesse de l'idempotence", () => {
    expect(classify(pg('23505'))).toBe('ACCEPTED');
  });
});


/**
 * La préparation, une fois débloquée côté écran, doit encore ARRIVER en base.
 *
 * Les deux défauts corrigés ici ont la même signature : un argument absent,
 * une colonne NOT NULL, une insertion refusée, un événement réessayé sans fin.
 * Et une file qui ne se vide jamais bloque l'hydratation — c'est-à-dire toute
 * la synchronisation de l'appareil, en silence.
 */
describe('une préparation qui arrive vraiment en base', () => {
  const batch = (payload: Record<string, unknown>): DomainEvent => ({
    id: ID, organizationId: ID, siteId: ID,
    eventType: 'BATCH_COMPLETED', entityType: 'ProductionBatch', entityId: ID,
    actorUserId: ID, deviceId: 'device-test',
    payload, createdAtLocal: '2026-08-15T09:00:00.000Z', createdAtServer: null,
    syncStatus: 'QUEUED', attempts: 0,
  });

  const CONSO = { itemId: ID, quantity: -2, unit: 'kg', locationId: ID };

  it("porte l'emplacement de chaque ligne consommée", () => {
    const args = buildArgs(batch({ itemId: ID, code: 'B', produced: 4, consumption: [CONSO] }));
    const lines = args.p_consumption as Record<string, unknown>[];
    expect(lines[0].location_id).toBe(ID);
    /* La sortie est signée côté client, le serveur applique son propre signe :
       renvoyer le négatif ferait RENTRER les ingrédients. */
    expect(lines[0].quantity).toBe(2);
  });

  it('envoie une recette absente comme absente, jamais comme chaîne vide', () => {
    /* `''::uuid` est une erreur de cast : l'événement resterait à échouer
       dans la file, exactement le blocage qu'on vient de lever. */
    const args = buildArgs(batch({ itemId: ID, code: 'B', produced: 4, recipeVersionId: null }));
    expect(args.p_recipe_version_id).toBeNull();

    const vide = buildArgs(batch({ itemId: ID, code: 'B', produced: 4, recipeVersionId: '' }));
    expect(vide.p_recipe_version_id).toBeNull();
  });

  it('accepte une préparation sans aucune consommation', () => {
    const args = buildArgs(batch({ itemId: ID, code: 'B', produced: 4, recipeVersionId: null }));
    expect(args.p_consumption).toEqual([]);
    expect(args.p_produced).toBe(4);
  });
});
