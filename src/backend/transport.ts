import type { DomainEvent, SaleLine, Unit, UUID } from '../domain/types';
import type { Transport, TransportOutcome } from '../store/outbox';
import { supabase } from './supabase';
import { asUuid } from './mappers';

/**
 * Transport de synchronisation vers Supabase.
 *
 * Il n'envoie JAMAIS de niveaux de stock — uniquement des faits datés et
 * identifiés. Le serveur reconstruit l'état (§57), ce qui autorise plusieurs
 * appareils hors ligne en parallèle.
 *
 * L'idempotence repose sur `event.id`, généré côté client avant toute
 * connexion : chaque fonction transactionnelle commence par vérifier si cet
 * identifiant a déjà produit une transaction, et renvoie l'existante le cas
 * échéant. Un retry réseau ne peut donc pas dupliquer une vente.
 */

/** Fonctions PostgreSQL correspondant à chaque type d'événement. */
const RPC_BY_EVENT: Partial<Record<DomainEvent['eventType'], string>> = {
  SALE_COMPLETED: 'complete_sale',
  SALE_CANCELLED: 'void_sale',
  GOODS_RECEIVED: 'receive_goods',
};

export const supabaseTransport: Transport = async (events) => {
  const outcome: TransportOutcome = { acceptedIds: [], failedIds: [], conflictIds: [] };
  if (!supabase) {
    // Sans client, rien n'est parti : ces événements restent réessayables.
    outcome.failedIds = events.map((e) => e.id);
    return outcome;
  }

  // Séquentiel et volontairement conservateur : l'ordre des faits compte, et
  // un échec ne doit pas emporter les événements suivants.
  for (const event of events) {
    const rpc = RPC_BY_EVENT[event.eventType];
    try {
      if (rpc) {
        const { error } = await supabase.rpc(rpc, buildArgs(event));
        if (error) throw error;
      } else {
        // Événements sans transaction dédiée : journalisés tels quels.
        // `ignoreDuplicates` porte ici l'idempotence — la clé primaire est
        // l'identifiant client, un renvoi ne produit donc pas de doublon.
        const { error } = await supabase.from('domain_events').upsert(
          {
            id: event.id,
            organization_id: event.organizationId,
            site_id: event.siteId,
            event_type: event.eventType,
            entity_type: event.entityType,
            entity_id: event.entityId,
            actor_user_id: event.actorUserId,
            device_id: event.deviceId,
            payload: event.payload,
            created_at_local: event.createdAtLocal,
          },
          { onConflict: 'id', ignoreDuplicates: true },
        );
        if (error) throw error;
      }
      outcome.acceptedIds.push(event.id);
    } catch (error) {
      route(classify(error), event.id, outcome);
    }
  }

  return outcome;
};

function route(verdict: Verdict, id: UUID, outcome: TransportOutcome): void {
  if (verdict === 'ACCEPTED') outcome.acceptedIds.push(id);
  else if (verdict === 'CONFLICT') outcome.conflictIds!.push(id);
  else outcome.failedIds.push(id);
}

/* --------------------------------------------------- Lecture des erreurs */

export type Verdict = 'ACCEPTED' | 'FAILED' | 'CONFLICT';

/**
 * Codes PostgreSQL qui expriment un REFUS, pas une panne. Les rejouer donnera
 * exactement le même refus : l'événement doit sortir de la file et devenir
 * visible, pas tourner en boucle.
 */
const PERMANENT = new Set([
  'P0001', // raise exception — règle métier (« Rôle % non autorisé », « Vente introuvable »)
  '42501', // droits insuffisants / RLS
  '42883', // fonction inexistante avec cette signature
  '22P02', // texte invalide pour le type — typiquement un identifiant qui n'est pas un UUID
  '22007', // date invalide
  '23502', // colonne NOT NULL restée vide
  '23503', // clé étrangère absente
  '23514', // contrainte CHECK violée
]);

/** L'événement était déjà là : c'est exactement ce que l'idempotence promet. */
const ALREADY_APPLIED = new Set(['23505']); // unique_violation (clé primaire = id client)

function codeOf(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return '';
}

function messageOf(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error ?? '');
}

/**
 * Verdict à partir de l'erreur renvoyée par Supabase.
 *
 * Le doute profite à la file : une erreur qu'on ne sait pas lire est classée
 * réessayable. Perdre un fait saisi au comptoir est bien pire que d'occuper
 * une ligne d'attente une minute de plus.
 */
export function classify(error: unknown): Verdict {
  const code = codeOf(error);
  if (ALREADY_APPLIED.has(code)) return 'ACCEPTED';
  if (PERMANENT.has(code)) return 'CONFLICT';

  // PGRSTxxx : PostgREST lui-même (cache de schéma périmé, requête malformée).
  // Le cache se rafraîchit tout seul : on laisse une chance au réessai.
  if (code.startsWith('PGRST')) return 'FAILED';

  const message = messageOf(error).toLowerCase();
  if (message.includes('violates row-level security')) return 'CONFLICT';
  if (message.includes('invalid input syntax')) return 'CONFLICT';

  return 'FAILED';
}

/* --------------------------------------------- Traduction des arguments */

/**
 * Les fonctions PostgreSQL lisent leurs lignes en `snake_case`
 * (`item_id`, `unit_price`, `unit_cost`) alors que le domaine les écrit en
 * `camelCase`. Sans cette traduction, `(ligne->>'unit_price')` vaut NULL,
 * le total devient NULL et l'insertion casse sur une contrainte NOT NULL —
 * c'est-à-dire une vente qui ne parvient jamais en base.
 */
function saleLinesForRpc(lines: SaleLine[]): Record<string, unknown>[] {
  return lines.map((line) => ({
    item_id: line.itemId,
    name: line.name,
    quantity: line.quantity,
    unit_price: line.unitPrice,
    unit_cost: line.unitCost,
  }));
}

interface ReceiptLine { itemId: UUID; quantity: number; unitPrice: number; unit?: Unit }

function receiptLinesForRpc(lines: ReceiptLine[]): Record<string, unknown>[] {
  return lines.map((line) => ({
    item_id: line.itemId,
    quantity: line.quantity,
    // `unit` alimente une colonne `unit_code` NOT NULL : jamais d'omission.
    unit: line.unit ?? 'unite',
    unit_price: line.unitPrice,
  }));
}

/** Traduit un événement local en arguments de sa fonction PostgreSQL. */
export function buildArgs(event: DomainEvent): Record<string, unknown> {
  const payload = (event.payload ?? {}) as Record<string, unknown>;

  switch (event.eventType) {
    case 'SALE_COMPLETED':
      return {
        p_event_id: event.id,
        p_site_id: event.siteId,
        p_location_id: payload.locationId,
        // Une caisse de démonstration n'existe pas côté serveur : mieux vaut
        // une vente sans session qu'une vente rejetée sur un cast d'UUID.
        p_cash_session_id: asUuid(payload.cashSessionId),
        p_payment_method: payload.paymentMethod ?? 'CASH',
        p_amount_received: payload.amountReceived ?? 0,
        p_lines: saleLinesForRpc((payload.lines ?? []) as SaleLine[]),
        p_created_at_local: event.createdAtLocal,
        p_device_id: event.deviceId,
      };
    case 'SALE_CANCELLED':
      return { p_event_id: event.id, p_sale_id: event.entityId, p_reason: payload.reason };
    case 'GOODS_RECEIVED':
      return {
        p_event_id: event.id,
        p_site_id: event.siteId,
        p_location_id: payload.locationId,
        p_supplier_id: payload.supplierId,
        p_lines: receiptLinesForRpc((payload.lines ?? []) as ReceiptLine[]),
        p_transport_cost: payload.transportCost ?? 0,
        p_payment_method: payload.paymentMethod ?? 'CASH',
      };
    default:
      return {};
  }
}
