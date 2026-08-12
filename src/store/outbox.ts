import type { DomainEvent, SyncStatus } from '../domain/types';

/**
 * §54 / §55 — file d'attente de synchronisation.
 *
 * Ce module ne synchronise pas de niveaux de stock : il envoie des événements
 * (« SALE −3 », « RECEIPT +10 »). Le serveur reconstruit l'état. C'est ce qui
 * permet à plusieurs appareils d'être hors ligne en même temps sans conflit (§57).
 */

export interface SyncResult { synced: number; failed: number }

export type Transport = (events: DomainEvent[]) => Promise<{ acceptedIds: string[]; failedIds: string[] }>;

export const PENDING: SyncStatus[] = ['LOCAL_ONLY', 'QUEUED', 'FAILED'];

export function pendingEvents(events: DomainEvent[]): DomainEvent[] {
  return events.filter((e) => PENDING.includes(e.syncStatus));
}

export function pendingCount(events: DomainEvent[]): number {
  return pendingEvents(events).length;
}

/**
 * Transport de développement : accepte tout après une latence simulée.
 * Sera remplacé par l'upload PowerSync / Edge Function. La signature est déjà
 * idempotente — le serveur dédoublonne sur `event.id` (§56).
 */
export const localTransport: Transport = async (events) => {
  await new Promise((r) => setTimeout(r, 400));
  return { acceptedIds: events.map((e) => e.id), failedIds: [] };
};

/** Backoff exponentiel plafonné : on réessaie sans marteler le réseau. */
export function retryDelayMs(attempts: number): number {
  return Math.min(30_000, 1000 * 2 ** attempts);
}
