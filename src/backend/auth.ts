import type { Role, User } from '../domain/types';
import { supabase } from './supabase';

/**
 * Authentification Supabase.
 *
 * Le terrain passe avant le cloud : le profil est mis en cache localement dès
 * qu'il est connu, pour que l'application s'ouvre et reste utilisable après un
 * redémarrage sans réseau. Supabase conserve la session de son côté ; nous ne
 * conservons que ce qu'il faut pour afficher et autoriser hors ligne.
 */

const PROFILE_CACHE = 'buna.profile.v1';

export interface AuthResult {
  profile: User | null;
  /** Message prêt à afficher, dans la voix de l'interface. */
  error: string | null;
}

/** Traduit les erreurs Supabase en langage utilisable au comptoir. */
function humanError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return 'E-mail ou mot de passe incorrect.';
  if (m.includes('email not confirmed')) return "Ce compte n'est pas encore confirmé.";
  if (m.includes('failed to fetch') || m.includes('network')) {
    return 'Pas de réseau. La connexion initiale nécessite Internet, une seule fois.';
  }
  return message;
}

export function cachedProfile(): User | null {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

function cacheProfile(profile: User | null): void {
  if (profile) localStorage.setItem(PROFILE_CACHE, JSON.stringify(profile));
  else localStorage.removeItem(PROFILE_CACHE);
}

/** Charge le profil métier associé à la session courante. */
export async function loadProfile(): Promise<User | null> {
  if (!supabase) return null;

  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user?.id;
  if (!userId) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('id, organization_id, site_id, name, role, status')
    .eq('id', userId)
    .single();

  if (error || !data) {
    // Session valide mais profil absent : on garde le cache s'il existe,
    // plutôt que de déconnecter quelqu'un en plein service.
    return cachedProfile();
  }

  const profile: User = {
    id: data.id as string,
    organizationId: data.organization_id as string,
    siteId: data.site_id as string,
    name: data.name as string,
    role: data.role as Role,
    status: (data.status as User['status']) ?? 'ACTIVE',
  };
  cacheProfile(profile);
  return profile;
}

export async function signIn(email: string, password: string): Promise<AuthResult> {
  if (!supabase) return { profile: null, error: 'Backend non configuré.' };

  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) return { profile: null, error: humanError(error.message) };

  const profile = await loadProfile();
  if (!profile) {
    return {
      profile: null,
      error: "Compte reconnu, mais aucun profil ne lui est rattaché. Contactez un administrateur.",
    };
  }
  if (profile.status === 'DISABLED') {
    await supabase.auth.signOut();
    return { profile: null, error: 'Ce compte a été désactivé.' };
  }
  return { profile, error: null };
}

export async function signOut(): Promise<void> {
  cacheProfile(null);
  await supabase?.auth.signOut();
}

/** Restaure la session au démarrage, y compris hors ligne via le cache. */
export async function restoreSession(): Promise<User | null> {
  if (!supabase) return null;
  if (!navigator.onLine) return cachedProfile();
  return (await loadProfile()) ?? cachedProfile();
}
