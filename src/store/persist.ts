/**
 * Persistance locale.
 *
 * Le PRD cible SQLite via PowerSync (§69). En attendant que le backend soit
 * provisionné, cette couche joue le même rôle contractuel : la base locale est
 * la source immédiate de lecture/écriture, et rien ne dépend du réseau pour
 * écrire. Le remplacement par PowerSync ne touche que ce fichier et outbox.ts.
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
