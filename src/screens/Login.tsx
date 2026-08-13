import { useState, type FormEvent } from 'react';
import { useBuna } from '../store/BunaStore';
import { ROLE_LABEL } from '../domain/types';
import { BunaLogo } from '../design-system/components/BunaLogo';
import { Button, Field } from '../design-system/components/primitives';

/**
 * Connexion.
 * Registre « brand » : fond café, Playfair généreux, respiration large.
 *
 * Avec un backend configuré, on demande de vraies informations d'identification.
 * Sans backend, on retombe sur la sélection de profil, ce qui permet de
 * travailler sur l'interface sans dépendre du réseau.
 */
export function Login() {
  const { users, login, signIn, authLoading, backendConfigured } = useBuna();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !email.trim() || !password) return;
    setBusy(true);
    setError(null);
    const message = await signIn(email, password);
    if (message) {
      setError(message);
      setBusy(false);
    }
    // En cas de succès, le profil arrive et la coque bascule d'elle-même.
  };

  return (
    <div className="flex min-h-dvh flex-col bg-cafe px-6 py-12 text-sable-pale">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
        <div className="mb-9">
          <BunaLogo size={104} className="-ml-2" />
        </div>

        <h1 className="t-display">Operations</h1>
        <p className="mt-3 max-w-sm text-[14px] leading-relaxed text-[#C4B5A4]">
          Déclarez ce que vous venez de faire. Le système s'occupe du stock, des coûts et de la marge —
          même sans connexion.
        </p>

        {authLoading ? (
          <p className="mt-10 text-[13px] text-[#A08E7C]">Reprise de votre session…</p>
        ) : backendConfigured ? (
          <form className="mt-10 space-y-4" onSubmit={submit}>
            <div className="[&_span]:!text-[#C4B5A4]">
              <Field
                label="E-mail"
                type="email"
                inputMode="email"
                autoComplete="username"
                placeholder="prenom@buna.sn"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="!border-[#4A3629] !bg-[#3D2C21] !text-sable-pale placeholder:!text-[#8C7A69]"
              />
            </div>
            <div className="[&_span]:!text-[#C4B5A4]">
              <Field
                label="Mot de passe"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="!border-[#4A3629] !bg-[#3D2C21] !text-sable-pale placeholder:!text-[#8C7A69]"
              />
            </div>

            {/* L'erreur explique ce qui s'est passé et ce qu'on peut faire. */}
            {error && (
              <p className="rounded-[4px] bg-[#4A2A21] px-3 py-2.5 text-[13px] leading-relaxed text-[#F0C4B4]">
                {error}
              </p>
            )}

            <Button
              type="submit"
              variant="primary"
              size="counter"
              full
              disabled={busy || !email.trim() || !password}
              className="!bg-sable-pale !text-cafe hover:!bg-white"
            >
              {busy ? 'Connexion…' : 'Se connecter'}
            </Button>

            <p className="text-[12px] leading-relaxed text-[#8C7A69]">
              Une seule connexion suffit : votre session est conservée sur cet appareil, et
              l'application reste utilisable hors ligne ensuite.
            </p>
          </form>
        ) : (
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
            <p className="pt-4 text-[12px] leading-relaxed text-[#8C7A69]">
              Mode démonstration — aucun backend configuré. Renseignez les clés Supabase dans
              .env.local pour activer l'authentification réelle.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
