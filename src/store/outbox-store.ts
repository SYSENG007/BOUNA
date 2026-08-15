import type { DomainEvent } from '../domain/types';

/**
 * La file d'attente, rangée à part et pour de bon.
 *
 * Tout l'état tenait dans une seule clé `localStorage`, et `saveState` avalait
 * silencieusement le dépassement de quota. Le compromis était assumé pour le
 * CACHE — perdre des lignes déjà connues du serveur ne coûte rien, elles
 * reviennent à l'hydratation suivante. Mais la file des événements non envoyés
 * vivait dans le même bloc, et elle, personne ne peut la reconstruire : une
 * vente encaissée hors ligne n'existe QUE là. Quota atteint, rechargement,
 * vente perdue — sans un mot.
 *
 * D'où la séparation : le cache reste en `localStorage`, évinçable et sans
 * conséquence ; la file passe en IndexedDB, qui a une limite bien plus haute,
 * n'est pas balayée par le nettoyage du cache, et dit quand elle échoue.
 *
 * Ce magasin est un MIROIR, pas la source. L'état React reste la vérité de
 * l'instant ; on écrit ici après coup, et on relit au démarrage pour récupérer
 * ce que `localStorage` aurait perdu. Rien n'attend cette écriture — une vente
 * ne doit jamais attendre un disque (RULE-010).
 */

const DB_NAME = 'buna-v2';
const DB_VERSION = 1;
const STORE = 'outbox';

/**
 * Remise à zéro du parc, côté file d'attente.
 *
 * Le nom change, pas la version : `onupgradeneeded` ne crée le magasin que
 * s'il manque, donc un simple `DB_VERSION + 1` garderait tous les événements.
 * Il faut une autre base pour repartir vide.
 *
 * La suppression de l'ancienne base détruit ce qui n'était pas encore parti.
 * C'est voulu et ponctuel : au passage en production, une vente de test en
 * attente ne doit surtout pas s'écrire dans la base propre.
 */
const LEGACY_DB_NAMES = ['buna'];

if (typeof indexedDB !== 'undefined') {
  for (const name of LEGACY_DB_NAMES) indexedDB.deleteDatabase(name);
}

/** Statuts qui appellent encore un envoi — un événement SYNCED n'a plus à être gardé. */
const PENDING_STATUSES = new Set(['LOCAL_ONLY', 'QUEUED', 'SYNCING', 'FAILED']);

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB indisponible'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        // La clé est l'identifiant client, celui-là même qui porte
        // l'idempotence (RULE-004) : réécrire un événement ne le duplique pas.
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('ouverture refusée'));
  });
}

function tx(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function done(store: IDBObjectStore): Promise<void> {
  return new Promise((resolve, reject) => {
    store.transaction.oncomplete = () => resolve();
    store.transaction.onerror = () => reject(store.transaction.error ?? new Error('écriture refusée'));
    store.transaction.onabort = () => reject(store.transaction.error ?? new Error('écriture annulée'));
  });
}

/**
 * Met le miroir au niveau de l'état : les événements en attente sont écrits,
 * ceux qui sont partis sont retirés.
 *
 * Rejette si l'écriture échoue — c'est tout l'intérêt. Une file qui ne peut
 * plus persister est une alerte, pas un détail à avaler.
 */
export async function mirrorOutbox(events: readonly DomainEvent[]): Promise<void> {
  const db = await openDb();
  try {
    const pending = events.filter((e) => PENDING_STATUSES.has(e.syncStatus));
    const keep = new Set(pending.map((e) => e.id));
    const store = tx(db, 'readwrite');

    // On retire d'abord ce qui n'est plus en attente, sinon le magasin ne fait
    // que croître et finit par garder l'historique complet des ventes.
    const existing = await new Promise<string[]>((resolve, reject) => {
      const req = store.getAllKeys();
      req.onsuccess = () => resolve(req.result as string[]);
      req.onerror = () => reject(req.error);
    });

    for (const key of existing) {
      if (!keep.has(key)) store.delete(key);
    }
    for (const event of pending) {
      store.put(event);
    }

    await done(store);
  } finally {
    db.close();
  }
}

/**
 * Ce que le miroir a gardé.
 *
 * Renvoie une liste vide plutôt que de lever : au démarrage, une base locale
 * illisible ne doit pas empêcher l'application d'ouvrir. On préfère repartir
 * sur le cache que ne pas ouvrir du tout.
 */
export async function loadOutbox(): Promise<DomainEvent[]> {
  try {
    const db = await openDb();
    try {
      const store = tx(db, 'readonly');
      return await new Promise<DomainEvent[]>((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result as DomainEvent[]);
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

/**
 * Fusionne le miroir avec ce que le cache a rendu.
 *
 * L'état du cache gagne quand les deux connaissent un événement : il est plus
 * récent, il porte le bon `syncStatus`. Le miroir n'apporte que ce que le
 * cache a perdu — c'est exactement ce qu'on lui demande.
 */
export function mergeOutbox(
  cached: readonly DomainEvent[],
  mirrored: readonly DomainEvent[],
): DomainEvent[] {
  const known = new Set(cached.map((e) => e.id));
  const recovered = mirrored.filter((e) => !known.has(e.id));
  return recovered.length ? [...cached, ...recovered] : [...cached];
}
