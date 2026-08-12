import { useBuna } from '../store/BunaStore';
import { ROLE_LABEL } from '../domain/types';
import { BunaLogo } from '../design-system/components/BunaLogo';

/**
 * Connexion.
 * Registre « brand » : fond café, Playfair généreux, respiration large.
 * Le MVP sélectionne un profil ; Supabase Auth (email + PIN) le remplacera
 * sans changer la forme de cet écran.
 */
export function Login() {
  const { users, login } = useBuna();

  return (
    <div className="flex min-h-dvh flex-col bg-cafe px-6 py-12 text-sable-pale">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
        <div className="mb-9">
          <BunaLogo size={104} className="-ml-2" />
        </div>

        <h1 className="t-display">
          Operations
        </h1>
        <p className="mt-3 max-w-sm text-[14px] leading-relaxed text-[#C4B5A4]">
          Déclarez ce que vous venez de faire. Le système s'occupe du stock, des coûts et de la marge —
          même sans connexion.
        </p>

        <div className="mt-10 space-y-2">
          <div className="label-section !text-[#A08E7C]">Choisissez votre profil</div>
          {users.map((u) => (
            <button
              key={u.id}
              onClick={() => login(u.id)}
              className="no-select flex min-h-[64px] w-full items-center gap-3 rounded-[6px] border border-[#4A3629] bg-[#3D2C21] px-4 text-left transition-colors active:bg-brun"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brun font-display text-[16px] text-sable-pale">
                {u.name.charAt(0)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium">{u.name}</span>
                <span className="num block text-[11px] tracking-[0.1em] text-[#A08E7C]">
                  {ROLE_LABEL[u.role].toUpperCase()}
                </span>
              </span>
              <span className="text-[18px] text-[#A08E7C]">›</span>
            </button>
          ))}
        </div>

        <p className="mt-8 text-[12px] leading-relaxed text-[#8C7A69]">
          Authentification de démonstration. Supabase Auth (email, magic link, PIN) sera branché
          au sprint Foundation — les rôles et permissions sont déjà appliqués.
        </p>
      </div>
    </div>
  );
}
