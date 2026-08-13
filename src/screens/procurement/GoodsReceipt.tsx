import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useBuna, SUPPLIERS } from '../../store/BunaStore';
import { fcfaFull } from '../../domain/money';
import { formatQty } from '../../domain/units';
import { PAYMENT_LABEL, UNIT_LABEL, type PaymentMethod } from '../../domain/types';
import { ScreenHeader } from '../../design-system/components/patterns';
import {
  Button, Card, Field, SectionLabel, SelectField,
} from '../../design-system/components/primitives';

interface Line { itemId: string; quantity: number; unitPrice: number }

/**
 * Réception (§21).
 * La réception est distincte de la commande : commandé 20 L, reçu 18 L, restant 2 L.
 * On saisit ce qui est réellement arrivé, pas ce qui était prévu.
 */
export function GoodsReceipt() {
  const { items, receiveGoods } = useBuna();
  const navigate = useNavigate();
  const routed = (useLocation().state ?? {}) as {
    supplierId?: string; locationId?: string; lines?: Line[]; transport?: number;
  };

  const ordered = routed.lines ?? [];
  const [received, setReceived] = useState<Record<string, number>>(
    Object.fromEntries(ordered.map((l) => [l.itemId, l.quantity])),
  );
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');

  if (!routed.supplierId || ordered.length === 0) {
    navigate('/achats/nouveau', { replace: true });
    return null;
  }

  const lines = ordered
    .map((l) => ({ ...l, quantity: received[l.itemId] ?? 0 }))
    .filter((l) => l.quantity > 0);

  const goods = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  const total = goods + (routed.transport ?? 0);
  const supplier = SUPPLIERS.find((s) => s.id === routed.supplierId);

  const submit = () => {
    receiveGoods({
      supplierId: routed.supplierId!,
      locationId: routed.locationId!,
      lines,
      transportCost: routed.transport ?? 0,
      paymentMethod,
    });
    navigate('/stock', { replace: true });
  };

  return (
    <div className="flex min-h-full flex-1 flex-col bg-ivoire">
      <ScreenHeader title="Réception" subtitle={supplier?.name} onBack={() => navigate(-1)} />

      <main className="flex-1 space-y-5 px-4 pb-32 pt-4">
        <p className="text-[13px] leading-relaxed text-ink-600">
          Saisissez les quantités <strong>réellement reçues</strong>. Une réception peut être partielle —
          le reste demeure attendu.
        </p>

        <div className="space-y-3">
          <SectionLabel>Lignes reçues</SectionLabel>
          {ordered.map((line) => {
            const item = items.get(line.itemId);
            if (!item) return null;
            const got = received[line.itemId] ?? 0;
            const missing = line.quantity - got;
            return (
              <Card key={line.itemId} className="space-y-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[15px] font-medium text-ink-900">{item.name}</span>
                  <span className="num text-[12px] text-ink-500">
                    commandé {formatQty(line.quantity, item.unit)}
                  </span>
                </div>
                <Field
                  label="Quantité reçue"
                  type="number"
                  inputMode="decimal"
                  value={got}
                  suffix={UNIT_LABEL[item.unit]}
                  onChange={(e) =>
                    setReceived((r) => ({ ...r, [line.itemId]: Number(e.target.value) }))
                  }
                />
                {missing > 0 && (
                  <div className="rounded-[4px] bg-surveiller-pale px-3 py-2 text-[12px] text-or-ink">
                    Restant à recevoir : {formatQty(missing, item.unit)}
                  </div>
                )}
              </Card>
            );
          })}
        </div>

        <div>
          <SectionLabel className="mb-2">Moyen de paiement</SectionLabel>
          <SelectField
            label=""
            value={paymentMethod}
            onChange={(v) => setPaymentMethod(v as PaymentMethod)}
            options={(['CASH', 'MOBILE_MONEY', 'CARD', 'OTHER'] as PaymentMethod[]).map((m) => ({
              value: m,
              label: PAYMENT_LABEL[m],
            }))}
          />
        </div>

        <Card padded={false} className="px-4 py-2">
          <div className="flex items-center justify-between py-2.5">
            <span className="text-[14px] text-ink-700">Marchandise reçue</span>
            <span className="num text-[15px]">{fcfaFull(goods)}</span>
          </div>
          <div className="flex items-center justify-between border-t border-ink-100 py-2.5">
            <span className="text-[14px] text-ink-700">Transport</span>
            <span className="num text-[15px]">{fcfaFull(routed.transport ?? 0)}</span>
          </div>
          <div className="flex items-center justify-between border-t border-ink-100 py-3">
            <span className="text-[15px] font-semibold text-ink-900">Total payé</span>
            <span className="num text-[20px] text-cafe">{fcfaFull(total)}</span>
          </div>
        </Card>
      </main>

      <div className="safe-b rail-bar bottom-0 z-20 border-t border-ink-200 bg-ivoire/95 py-3 backdrop-blur">
        <Button variant="primary" size="counter" full disabled={lines.length === 0} onClick={submit}>
          Valider la réception
        </Button>
      </div>
    </div>
  );
}
