import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBuna } from '../../../store/BunaStore';
import { fcfa, fcfaFull } from '../../../domain/money';
import { ScreenHeader } from '../../../design-system/components/patterns';
import { Button, Card, Field } from '../../../design-system/components/primitives';

const KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '000', '0', '⌫'];

/** Pavé numérique partagé par l'ouverture et la clôture : même geste, même forme. */
function Keypad({ onPress }: { onPress: (key: string) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {KEYS.map((k) => (
        <button
          key={k}
          onClick={() => onPress(k)}
          className="no-select num min-h-[60px] rounded-[6px] border border-ink-200 bg-surface text-[20px] text-ink-900 transition-colors active:bg-sable-pale"
        >
          {k}
        </button>
      ))}
    </div>
  );
}

/** Saisie d'un montant au pavé, avec sa garde de longueur. */
function useAmount() {
  const [raw, setRaw] = useState('');
  const press = (k: string) => {
    if (k === '⌫') setRaw((r) => r.slice(0, -1));
    else setRaw((r) => (r.length > 9 ? r : r + k));
  };
  return { raw, press, value: Number(raw || 0), reset: () => setRaw('') };
}

/**
 * La caisse a deux moments, et un seul écran.
 *
 * Tant qu'aucun shift n'est ouvert, il n'y a rien à compter : l'écran demande
 * le fond de caisse. Une fois le shift ouvert, il demande le comptage. Séparer
 * les deux en deux destinations obligerait à savoir laquelle chercher — alors
 * que la caisse, elle, n'est jamais que dans un état ou dans l'autre.
 */
export function Closing() {
  const { state } = useBuna();
  const open = !state.cashSession.closedAt;
  return open ? <CloseShift /> : <OpenShift />;
}

/* ------------------------------------------------------------- Ouverture */

function OpenShift() {
  const { state, openCashSession } = useBuna();
  const navigate = useNavigate();
  const { raw, press, value } = useAmount();

  const shift = state.cashSession.shiftNumber + 1;

  const submit = () => {
    openCashSession(value);
    navigate('/vente', { replace: true });
  };

  return (
    <div className="flex min-h-full flex-1 flex-col bg-ivoire">
      <ScreenHeader
        title="Ouvrez la caisse"
        subtitle={`Shift #${shift} · fond de caisse`}
        onBack={() => navigate(-1)}
      />

      <main className="flex-1 space-y-4 px-4 pb-32 pt-4">
        <p className="text-[13px] leading-relaxed text-ink-600">
          Comptez l'argent présent dans le tiroir avant la première vente. C'est ce montant
          qui servira de référence à la clôture — l'écart se mesure à partir de lui.
        </p>

        <Card className="text-center">
          <div className="label-section">Fond de caisse</div>
          <div className="mt-1 flex items-baseline justify-center gap-2">
            <span className="t-figure text-[40px] leading-none text-ink-900">
              {raw ? fcfa(value) : '—'}
            </span>
            <span className="text-[13px] text-ink-500">FCFA</span>
          </div>
        </Card>

        <Keypad onPress={press} />

        <p className="text-[13px] text-ink-600">
          Le tiroir peut être vide : saisissez 0, l'ouverture reste nécessaire.
        </p>

        <Button variant="primary" size="counter" full disabled={!raw} onClick={submit}>
          Ouvrir la caisse
        </Button>
      </main>
    </div>
  );
}

/* -------------------------------------------------------------- Clôture */

function CloseShift() {
  const { state, closeCashSession } = useBuna();
  const navigate = useNavigate();
  const { raw, press, value: counted } = useAmount();

  const [revealed, setRevealed] = useState(false);
  const [reason, setReason] = useState('');

  const expected = useMemo(() => {
    const cash = state.sales
      .filter((s) => s.status === 'COMPLETED' && s.paymentMethod === 'CASH')
      .reduce((sum, s) => sum + s.total, 0);
    return state.cashSession.openingCash + cash;
  }, [state.sales, state.cashSession.openingCash]);

  const variance = counted - expected;
  const needsReason = revealed && Math.abs(variance) > 0;

  const submit = () => {
    closeCashSession(counted, reason || undefined);
    navigate('/pilotage', { replace: true });
  };

  return (
    <div className="flex min-h-full flex-1 flex-col bg-ivoire">
      <ScreenHeader
        title="Comptez la caisse"
        subtitle={`Clôture · shift #${state.cashSession.shiftNumber}`}
        onBack={() => navigate(-1)}
      />

      <main className="flex-1 space-y-4 px-4 pb-32 pt-4">
        <p className="text-[13px] leading-relaxed text-ink-600">
          Saisissez l'argent réellement présent. Le montant attendu reste masqué jusqu'à votre saisie.
        </p>

        <Card className="text-center">
          <div className="label-section">Espèces comptées</div>
          <div className="mt-1 flex items-baseline justify-center gap-2">
            <span className="t-figure text-[40px] leading-none text-ink-900">{raw ? fcfa(counted) : '—'}</span>
            <span className="text-[13px] text-ink-500">FCFA</span>
          </div>
        </Card>

        {!revealed ? (
          <>
            <Keypad onPress={press} />
            <Button variant="primary" size="counter" full disabled={!raw} onClick={() => setRevealed(true)}>
              Comparer à l'attendu
            </Button>
          </>
        ) : (
          <>
            <Card padded={false} className="px-4 py-2">
              <div className="flex items-center justify-between py-2.5">
                <span className="text-[14px] text-ink-700">Fond d'ouverture</span>
                <span className="num text-[15px] text-ink-900">{fcfaFull(state.cashSession.openingCash)}</span>
              </div>
              <div className="flex items-center justify-between border-t border-ink-100 py-2.5">
                <span className="text-[14px] text-ink-700">Attendu</span>
                <span className="num text-[15px] text-ink-900">{fcfaFull(expected)}</span>
              </div>
              <div className="flex items-center justify-between border-t border-ink-100 py-2.5">
                <span className="text-[14px] text-ink-700">Compté</span>
                <span className="num text-[15px] text-ink-900">{fcfaFull(counted)}</span>
              </div>
              <div className="flex items-center justify-between border-t border-ink-100 py-2.5">
                <span className="text-[14px] font-semibold text-ink-900">Écart</span>
                <span
                  className={`num text-[19px] ${variance === 0 ? 'text-conforme-deep' : 'text-critique'}`}
                >
                  {variance > 0 ? '+' : ''}{fcfaFull(variance)}
                </span>
              </div>
            </Card>

            {needsReason ? (
              <>
                <p className="text-[13px] text-ink-600">
                  Un motif est requis, puis validation manager.
                </p>
                <Field
                  label="Motif de l'écart"
                  placeholder="ex. rendu de monnaie"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </>
            ) : (
              <p className="text-[13px] text-conforme-deep">Caisse juste. Rien à justifier.</p>
            )}

            <div className="flex gap-2.5">
              <Button className="flex-1" onClick={() => setRevealed(false)}>Recompter</Button>
              <Button
                variant="primary"
                className="flex-[1.4]"
                disabled={needsReason && !reason.trim()}
                onClick={submit}
              >
                {needsReason ? 'Justifier et clôturer' : 'Clôturer la caisse'}
              </Button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
