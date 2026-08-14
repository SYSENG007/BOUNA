import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useCart } from '../CartContext';
import { useBuna } from '../../../store/BunaStore';
import { fcfa, fcfaFull } from '../../../domain/money';
import { PAYMENT_LABEL, type PaymentMethod } from '../../../domain/types';
import { ScreenHeader } from '../../../design-system/components/patterns';
import { Button, SectionLabel } from '../../../design-system/components/primitives';

const METHODS: PaymentMethod[] = ['CASH', 'MOBILE_MONEY', 'CARD', 'OTHER'];

/** Encaissement — quatre grandes cibles, montant reçu prérempli sur l'exact. */
export function Payment() {
  const { lines, count, total, clear } = useCart();
  const { user, state, completeSale } = useBuna();
  const navigate = useNavigate();

  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [received, setReceived] = useState<number>(total);
  const [busy, setBusy] = useState(false);

  if (lines.length === 0) {
    navigate('/vendre', { replace: true });
    return null;
  }

  /* Coupures usuelles : l'exact d'abord, puis ce que les clients tendent vraiment. */
  const suggestions = [total, 5000, 10000, 20000].filter((v, i, a) => v >= total && a.indexOf(v) === i);

  const submit = () => {
    if (busy) return;
    setBusy(true);
    const sale = completeSale(lines, method, method === 'CASH' ? received : total);
    if (sale) {
      clear();
      navigate('/vendre/recu', { replace: true, state: { saleId: sale.id } });
    } else {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full flex-1 flex-col bg-ivoire">
      <ScreenHeader title="Encaissement" onBack={() => navigate('/vendre/panier')} />

      <main className="flex-1 px-4 pb-40 pt-4">
        <div className="rounded-[8px] bg-cafe px-5 py-5 text-sable-pale">
          <SectionLabel className="!text-[#A08E7C]">À encaisser</SectionLabel>
          <div className="t-figure mt-1 text-[42px] leading-none">{fcfa(total)}</div>
          <div className="mt-1 text-[12px] text-[#A08E7C]">
            {count} article{count > 1 ? 's' : ''} · {user?.name.split(' ')[0]} · Shift #{state.cashSession.shiftNumber}
          </div>
        </div>

        <SectionLabel className="mb-2 mt-6">Moyen de paiement</SectionLabel>
        <div className="grid grid-cols-2 gap-2.5">
          {METHODS.map((m) => (
            <button
              key={m}
              onClick={() => setMethod(m)}
              className={clsx(
                'no-select min-h-[64px] rounded-[6px] text-[15px] font-medium transition-colors',
                method === m
                  ? 'border-2 border-brun bg-sable-pale text-cafe'
                  : 'border border-ink-200 bg-surface text-ink-700',
              )}
            >
              {PAYMENT_LABEL[m]}
            </button>
          ))}
        </div>

        {method === 'CASH' && (
          <>
            <SectionLabel className="mb-2 mt-6">Montant reçu</SectionLabel>
            <div className="grid grid-cols-4 gap-2">
              {suggestions.map((v, i) => (
                <button
                  key={v}
                  onClick={() => setReceived(v)}
                  className={clsx(
                    'no-select num min-h-[52px] rounded-[6px] text-[14px] transition-colors',
                    received === v
                      ? 'border-2 border-brun bg-sable-pale text-cafe'
                      : 'border border-ink-200 bg-surface text-ink-700',
                  )}
                >
                  {i === 0 ? 'Exact' : fcfa(v)}
                </button>
              ))}
            </div>
            {received > total && (
              <div className="mt-3 flex items-center justify-between rounded-[6px] bg-conforme-pale px-4 py-3">
                <span className="text-[14px] text-conforme-deep">Monnaie à rendre</span>
                <span className="num text-[18px] text-conforme-deep">{fcfaFull(received - total)}</span>
              </div>
            )}
          </>
        )}
      </main>

      <div className="safe-b rail-bar bottom-0 z-20 border-t border-ink-200 bg-ivoire/95 py-3 backdrop-blur">
        <Button variant="primary" size="counter" full onClick={submit} disabled={busy}>
          Valider — {PAYMENT_LABEL[method]}
        </Button>
      </div>
    </div>
  );
}
