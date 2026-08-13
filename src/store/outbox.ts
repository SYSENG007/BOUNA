import type { DomainEvent, SyncStatus, UUID } from '../domain/types';

/**
 * §54 / §55 — file d'attente de synchronisation.
 *
 * Ce module ne synchronise pas de niveaux de stock : il envoie des événements
 * (« SALE −3 », « RECEIPT +10 »). Le serveur reconstruit l'état. C'est ce qui
 * permet à plusieurs appareils d'être hors ligne en même temps sans conflit (§57).
 *
 * Trois issues possibles pour un événement envoyé, et une seule est réessayable :
 *
 * - accepté  → SYNCED. Le serveur l'a traité, ou l'avait déjà traité (§56).
 * - échec    → FAILED. Réseau coupé, serveur indisponible : on réessaiera,
 *              avec un délai croissant.
 * - conflit  → CONFLICT. Le serveur a REFUSÉ pour une raison métier (rôle
 *              insuffisant, vente déjà annulée, identifiant invalide).
 *              Réessayer ne changerait rien : l'événement quitte la file et
 *              devient visible tel quel dans « Mon activité ».
 */

export interface SyncResult { synced: number; failed: number }

export interface TransportOutcome {
  acceptedIds: UUID[];
  failedIds: UUID[];
  /** Rejets définitifs : ne jamais les remettre dans la file. */
  conflictIds?: UUID[];
}

export type Transport = (events: DomainEvent[]) => Promise<TransportOutcome>;

/** Statuts qui appellent un nouvel envoi. CONFLICT et SYNCED n'en font pas partie. */
export const PENDING: SyncStatus[] = ['LOCAL_ONLY', 'QUEUED', 'FAILED'];

export function pendingEvents(events: DomainEvent[]): DomainEvent[] {
  return events.filter((e) => PENDING.includes(e.syncStatus));
}

export function pendingCount(events: DomainEvent[]): number {
  return pendingEvents(events).length;
}

/**
 * Transport de développement : accepte tout après une latence simulée.
 * Utilisé quand aucun backend n'est configuré (RULE-010) — l'app doit rester
 * pleinement utilisable sans `.env.local`.
 */
export const localTransport: Transport = async (events) => {
  await new Promise((r) => setTimeout(r, 400));
  return { acceptedIds: events.map((e) => e.id), failedIds: [] };
};

/** Backend branché → RPC transactionnelles ; sinon, file locale. */
export function selectTransport(backendConfigured: boolean, remote: Transport): Transport {
  return backendConfigured ? remote : localTransport;
}

/** Backoff exponentiel plafonné : on réessaie sans marteler le réseau. */
export function retryDelayMs(attempts: number): number {
  return Math.min(30_000, 1000 * 2 ** attempts);
}

/**
 * Événements à envoyer maintenant.
 *
 * Un événement jamais tenté part tout de suite : au comptoir, une vente ne doit
 * pas attendre. Un événement déjà refusé attend son délai de backoff — sinon la
 * boucle de synchronisation (toutes les 60 s, plus chaque retour de réseau)
 * rejouerait en continu un événement qui échoue.
 */
export function dueEvents(
  events: DomainEvent[],
  lastAttemptAt: ReadonlyMap<UUID, number>,
  now: number = Date.now(),
): DomainEvent[] {
  return pendingEvents(events).filter((event) => {
    const last = lastAttemptAt.get(event.id);
    if (last === undefined) return true;
    return now - last >= retryDelayMs(event.attempts);
  });
}
