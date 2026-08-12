import type { DomainEvent } from '../domain/types';
import type { Transport } from '../store/outbox';
import { supabase } from './supabase';

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
  if (!supabase) return { acceptedIds: [], failedIds: events.map((e) => e.id) };

  const acceptedIds: string[] = [];
  const failedIds: string[] = [];

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
      acceptedIds.push(event.id);
    } catch {
      failedIds.push(event.id);
    }
  }

  return { acceptedIds, failedIds };
};

/** Traduit un événement local en arguments de sa fonction PostgreSQL. */
function buildArgs(event: DomainEvent): Record<string, unknown> {
  const payload = event.payload as Record<string, unknown>;

  switch (event.eventType) {
    case 'SALE_COMPLETED':
      return {
        p_event_id: event.id,
        p_site_id: event.siteId,
        p_location_id: payload.locationId,
        p_cash_session_id: payload.cashSessionId ?? null,
        p_payment_method: payload.paymentMethod,
        p_amount_received: payload.amountReceived ?? 0,
        p_lines: payload.lines,
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
        p_lines: payload.lines,
        p_transport_cost: payload.transportCost ?? 0,
        p_payment_method: payload.paymentMethod ?? 'CASH',
      };
    default:
      return {};
  }
}
