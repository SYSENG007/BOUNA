/**
 * Persistance locale.
 *
 * La base locale (actuellement localStorage) est la source immédiate de
 * lecture/écriture, et rien ne dépend du réseau pour écrire.
 * Si la limite de stockage est atteinte (5Mo), la migration se fera vers IndexedDB.
 */

const KEY = 'buna.state.v2';

/**
 * Remise à zéro du parc.
 *
 * Vider PostgreSQL ne vide pas les appareils : ce cache est relu au premier
 * rendu et survit à tout ce qui arrive côté serveur — un fond de caisse ou une
 * perte d'avant le reset resteraient affichés indéfiniment. Changer la clé est
 * le seul reset qui atteint tous les téléphones sans les manipuler un par un :
 * le nouveau build ne trouve plus rien et repart d'un état vierge.
 *
 * L'ancienne clé est supprimée dans la foulée, sinon elle occupe le quota pour
 * rien jusqu'à la fin des temps.
 */
const LEGACY_KEYS = ['buna.state.v1'];

try {
  for (const key of LEGACY_KEYS) localStorage.removeItem(key);
} catch {
  // Stockage indisponible (navigation privée, quota) : rien à purger.
}

export function loadState<T>(): T | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    // Un état local corrompu ne doit jamais empêcher l'app de démarrer.
    return null;
  }
}

export function saveState<T>(state: T): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Quota dépassé : on préfère perdre le cache que bloquer une vente.
  }
}

export function clearState(): void {
  localStorage.removeItem(KEY);
}
