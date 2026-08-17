/**
 * §56 — Idempotence.
 * Chaque événement reçoit un UUID généré localement, avant toute connexion serveur.
 * Le backend garantit qu'un event_id ne produit qu'une seule transaction métier :
 * c'est ce qui empêche la double vente après un retry réseau.
 */
export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const DEVICE_KEY = 'buna.device.id';

/** Identifiant stable de l'appareil — rattache chaque opération à un terminal (§4.5). */
export function deviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = uuid();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

/** Code lisible d'un batch : B-AAAAMMJJ-NN. */
export function batchCode(date: Date, sequence: number): string {
  const d = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  return `B-${d}-${String(sequence).padStart(2, '0')}`;
}

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * La base attend des `uuid`, pas des identifiants lisibles.
 *
 * Les recettes se donnaient des clés préfixées — `r-<uuid>`, `rv-<uuid>` —
 * lisibles au débogage mais refusées par PostgreSQL en `22P02` : tant que les
 * recettes ne quittaient pas l'appareil, personne ne s'en apercevait.
 */
export function isUuid(value: string): boolean {
  return UUID_SHAPE.test(value);
}
