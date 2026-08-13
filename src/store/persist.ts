/**
 * Persistance locale.
 *
 * La base locale (actuellement localStorage) est la source immédiate de
 * lecture/écriture, et rien ne dépend du réseau pour écrire.
 * Si la limite de stockage est atteinte (5Mo), la migration se fera vers IndexedDB.
 */

const KEY = 'buna.state.v1';

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
