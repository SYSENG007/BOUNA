import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBuna } from '../../store/BunaStore';
import { fcfa, fcfaFull } from '../../domain/money';
import { ScreenHeader } from '../../design-system/components/patterns';
import { Button, Card, Field } from '../../design-system/components/primitives';

const KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '000', '0', '⌫'];

/**
 * Clôture de caisse guidée.
 * Le montant attendu reste masqué jusqu'à la saisie du comptage — sinon on ne
 * compte pas, on recopie.
 */
export function Closing() {
  const { state, closeCashSession } = useBuna();
  const navigate = useNavigate();

  const [raw, setRaw] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [reason, setReason] = useState('');

  const expected = useMemo(() => {
    const cash = state.sales
      .filter((s) => s.status === 'COMPLETED' && s.paymentMethod === 'CASH')
      .reduce((sum, s) => sum + s.total, 0);
    return state.cashSession.openingCash + cash;
  }, [state.sales, state.cashSession.openingCash]);

  const counted = Number(raw || 0);
  const variance = counted - expected;
  const needsReason = revealed && Math.abs(variance) > 0;

  const press = (k: string) => {
    if (k === '⌫') setRaw((r) => r.slice(0, -1));
    else setRaw((r) => (r.length > 9 ? r : r + k));
  };

  const submit = () => {
    closeCashSession(counted, reason || undefined);
    navigate('/aujourdhui', { replace: true });
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
            <span className="num text-[40px] leading-none text-ink-900">{raw ? fcfa(counted) : '—'}</span>
            <span className="text-[13px] text-ink-500">FCFA</span>
          </div>
        </Card>

        {!revealed ? (
          <>
            <div className="grid grid-cols-3 gap-2">
              {KEYS.map((k) => (
                <button
                  key={k}
                  onClick={() => press(k)}
                  className="no-select num min-h-[60px] rounded-[6px] border border-ink-200 bg-surface text-[20px] text-ink-900 transition-colors active:bg-sable-pale"
                >
                  {k}
                </button>
              ))}
            </div>
            <Button variant="primary" size="counter" full disabled={!raw} onClick={() => setRevealed(true)}>
              Comparer à l'attendu
            </Button>
          </>
        ) : (
          <>
            <Card padded={false} className="px-4 py-2">
              <div className="flex items-center justify-between py-2.5">
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
