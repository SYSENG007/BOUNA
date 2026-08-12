import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Client Supabase.
 *
 * L'application doit démarrer et fonctionner SANS backend : le terrain passe
 * avant le cloud (RULE-010). Tant que les variables ne sont pas renseignées,
 * `supabase` vaut null et l'app reste sur son état local. Rien ne casse.
 *
 * Seule la clé anon est exposée au client — c'est son rôle. Toute règle
 * sensible est appliquée par RLS et par les fonctions transactionnelles.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isBackendConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isBackendConfigured
  ? createClient(url!, anonKey!, {
      auth: { persistSession: true, autoRefreshToken: true },
      // Le terrain travaille hors ligne : on ne veut pas de reconnexion agressive.
      realtime: { params: { eventsPerSecond: 2 } },
    })
  : null;

/** Message unique, pour ne pas disperser le diagnostic dans l'interface. */
export const BACKEND_HINT =
  "Backend non configuré. Copiez .env.example vers .env.local et renseignez VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY.";
