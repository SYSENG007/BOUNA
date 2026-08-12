import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBuna, SUPPLIERS, LOCATIONS, LOC } from '../../store/BunaStore';
import { fcfa, fcfaFull, percent } from '../../domain/money';
import { weightedAverageCost } from '../../domain/stock';
import { ScreenHeader } from '../../design-system/components/patterns';
import {
  Button, Card, Field, SectionLabel, SelectField,
} from '../../design-system/components/primitives';

interface Line { itemId: string; quantity: number; unitPrice: number }

/**
 * Achat & réception (§22).
 * Un achat génère une dépense ET une entrée de stock. Le coût moyen pondéré
 * est recalculé et affiché AVANT validation : l'acheteur voit l'impact de son prix.
 */
export function Purchase() {
  const { state, items, stockOf } = useBuna();
  const navigate = useNavigate();

  const purchasable = state.items.filter((i) => i.kind !== 'FINISHED');
  const [supplierId, setSupplierId] = useState(SUPPLIERS[0].id);
  const [locationId, setLocationId] = useState<string>(LOC.CENTRAL);
  const [transport, setTransport] = useState(0);
  const [lines, setLines] = useState<Line[]>([
    { itemId: 'it-lait', quantity: 20, unitPrice: 1100 },
  ]);

  const subtotal = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  const total = subtotal + transport;

  const patch = (i: number, next: Partial<Line>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...next } : l)));

  const addLine = () => {
    const used = new Set(lines.map((l) => l.itemId));
    const next = purchasable.find((i) => !used.has(i.id));
    if (next) setLines((ls) => [...ls, { itemId: next.id, quantity: 1, unitPrice: next.weightedAvgCost ?? 0 }]);
  };

  return (
    <div className="flex min-h-full flex-1 flex-col bg-ivoire">
      <ScreenHeader title="Nouvel achat" subtitle="Achat · réception · paiement" onBack={() => navigate(-1)} />

      <main className="flex-1 space-y-5 px-4 pb-32 pt-4">
        <SelectField
          label="Fournisseur"
          value={supplierId}
          onChange={setSupplierId}
          options={SUPPLIERS.map((s) => ({ value: s.id, label: s.name }))}
        />
        <SelectField
          label="Emplacement de réception"
          value={locationId}
          onChange={setLocationId}
          options={LOCATIONS.map((l) => ({ value: l.id, label: l.name }))}
        />

        <div className="space-y-3">
          <SectionLabel>Articles</SectionLabel>
          {lines.map((line, i) => {
            const item = items.get(line.itemId);
            if (!item) return null;
            const currentQty = stockOf(item.id);
            const currentCost = item.weightedAvgCost ?? 0;
            const newCost = weightedAverageCost(currentQty, currentCost, line.quantity, line.unitPrice);
            const drift = currentCost > 0 ? ((line.unitPrice - currentCost) / currentCost) * 100 : 0;

            return (
              <Card key={i} className="space-y-3">
                <div className="flex items-start gap-2">
                  <div className="flex-1">
                    <SelectField
                      label="Article"
                      value={line.itemId}
                      onChange={(v) => patch(i, { itemId: v })}
                      options={purchasable.map((it) => ({ value: it.id, label: `${it.name} (${it.unit})` }))}
                    />
                  </div>
                  {lines.length > 1 && (
                    <button
                      onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
                      aria-label="Retirer la ligne"
                      className="mt-7 h-11 w-11 shrink-0 text-[18px] text-ink-400"
                    >
                      ×
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Field
                    label="Quantité"
                    type="number"
                    inputMode="decimal"
                    value={line.quantity}
                    suffix={item.unit}
                    onChange={(e) => patch(i, { quantity: Number(e.target.value) })}
                  />
                  <Field
                    label="Prix unitaire"
                    type="number"
                    inputMode="numeric"
                    value={line.unitPrice}
                    suffix="FCFA"
                    onChange={(e) => patch(i, { unitPrice: Number(e.target.value) })}
                  />
                </div>

                <div className="flex items-center justify-between border-t border-ink-100 pt-2.5">
                  <span className="text-[13px] text-ink-600">Total ligne</span>
                  <span className="num text-[15px] text-ink-900">{fcfaFull(line.quantity * line.unitPrice)}</span>
                </div>

                {/* Impact prix — §18 et §41, montré avant l'enregistrement. */}
                {currentCost > 0 && Math.abs(drift) >= 1 && (
                  <div
                    className={`rounded-[4px] px-3 py-2 text-[12px] leading-relaxed ${
                      drift > 0 ? 'bg-surveiller-pale text-or-ink' : 'bg-conforme-pale text-conforme-deep'
                    }`}
                  >
                    {drift > 0 ? '↑' : '↓'} {percent(Math.abs(drift), 1)} vs coût actuel ({fcfa(currentCost)}).
                    Nouveau coût moyen pondéré : {fcfaFull(Math.round(newCost))} / {item.unit}.
                  </div>
                )}
              </Card>
            );
          })}

          <Button full onClick={addLine}>+ Ajouter un article</Button>
        </div>

        <Field
          label="Transport"
          type="number"
          inputMode="numeric"
          value={transport}
          suffix="FCFA"
          hint="Charge directe — n'entre pas dans la valeur du stock (§39)."
          onChange={(e) => setTransport(Number(e.target.value))}
        />

        <Card padded={false} className="px-4 py-2">
          <div className="flex items-center justify-between py-2.5">
            <span className="text-[14px] text-ink-700">Sous-total</span>
            <span className="num text-[15px]">{fcfaFull(subtotal)}</span>
          </div>
          <div className="flex items-center justify-between border-t border-ink-100 py-2.5">
            <span className="text-[14px] text-ink-700">Transport</span>
            <span className="num text-[15px]">{fcfaFull(transport)}</span>
          </div>
          <div className="flex items-center justify-between border-t border-ink-100 py-3">
            <span className="text-[15px] font-semibold text-ink-900">Total</span>
            <span className="num text-[20px] text-cafe">{fcfaFull(total)}</span>
          </div>
        </Card>

        <p className="px-1 text-[12px] leading-relaxed text-ink-500">
          L'enregistrement de la réception créera les mouvements de stock, mettra à jour le coût moyen
          pondéré et générera la dépense correspondante.
        </p>
      </main>

      <div className="safe-b fixed inset-x-0 bottom-0 z-20 border-t border-ink-200 bg-ivoire/95 px-4 py-3 backdrop-blur">
        <div className="flex gap-2.5">
          <Button className="flex-1" onClick={() => navigate(-1)}>Annuler</Button>
          <Button
            variant="primary"
            className="flex-[1.6]"
            disabled={subtotal <= 0}
            onClick={() => navigate('/achats/reception', { state: { supplierId, locationId, lines, transport } })}
          >
            Passer à la réception
          </Button>
        </div>
      </div>
    </div>
  );
}
