import { supabase } from './supabase';
import { BACKEND_HINT } from './supabase';

/**
 * Entrer et sortir du bac à sable.
 *
 * Trois appels, et aucune logique : tout se décide dans PostgreSQL
 * (`supabase/migrations/0029_bac_a_sable.sql`). Ce n'est pas un choix
 * d'élégance — le client ne PEUT pas faire ce travail. Créer une organisation
 * et déplacer un profil sont deux écritures que RLS lui refuse, à juste titre.
 * Les fonctions sont donc `security definer`, et elles revérifient la capacité
 * `RUN_SIMULATION` de leur côté : ce que l'écran cache, le serveur le refuse.
 *
 * Aucune de ces fonctions n'écrit dans `auth.users`. C'est la propriété qui a
 * décidé du dispositif : la personne emmène SON compte dans le bac à sable
 * plutôt que d'en emprunter un d'essai, donc rien d'appelable depuis un
 * navigateur n'a besoin de créer un compte.
 */

/** Le message d'erreur tel qu'il doit s'afficher, sans jargon PostgREST. */
function reason(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const raw = String((error as { message: unknown }).message);
    /*
     * Nos fonctions lèvent déjà des messages écrits pour être lus
     * (« Vous n'avez pas le droit… »). On les laisse passer tels quels, et on
     * ne traduit que ce qui vient de plus bas.
     */
    if (raw.startsWith('Vous ') || raw.startsWith('Aucun') || raw.startsWith('REFUS')) return raw;
    if (raw.toLowerCase().includes('failed to fetch')) {
      return "Pas de réseau. Entrer ou sortir d'une simulation demande une connexion.";
    }
    return raw;
  }
  return 'Échec inconnu.';
}

/** `null` si tout va bien, sinon un message prêt à afficher. */
export type SimulationOutcome = string | null;

async function call(fn: 'enter_simulation' | 'leave_simulation' | 'purge_simulation'): Promise<SimulationOutcome> {
  if (!supabase) return BACKEND_HINT;
  const { error } = await supabase.rpc(fn);
  return error ? reason(error) : null;
}

/**
 * Déplace le profil de la personne dans le bac à sable, en le montant s'il
 * n'existe pas encore. Sans effet si elle y est déjà — et c'est important :
 * un second appel qui réenregistrerait la maison d'origine l'y enfermerait.
 */
export const enterSimulation = () => call('enter_simulation');

/** Ramène la personne dans sa maison. Jamais refusé, même sans la capacité. */
export const leaveSimulation = () => call('leave_simulation');

/**
 * Efface le bac à sable et tout ce qu'il contient.
 *
 * Ramène d'abord toute personne encore en simulation — y compris celle qui
 * appelle. Sans cet ordre, la cascade depuis `organizations` détruirait les
 * comptes restés dedans.
 */
export const purgeSimulation = () => call('purge_simulation');
