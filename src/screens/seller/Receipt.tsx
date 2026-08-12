import { useLocation, useNavigate } from 'react-router-dom';
import { useBuna } from '../../store/BunaStore';
import { fcfa, percent } from '../../domain/money';
import { AmountRow, ScreenHeader } from '../../design-system/components/patterns';
import { Button, Card, SectionLabel } from '../../design-system/components/primitives';

/**
 * Vente enregistrée.
 * « Ce que le vendeur déclare, le système le déduit » — on montre la déduction,
 * c'est ce qui construit la confiance dans les chiffres du soir.
 */
export function Receipt() {
  const navigate = useNavigate();
  const { state } = useBuna();
  const routed = (useLocation().state ?? {}) as { saleId?: string };
  const sale = state.sales.find((s) => s.id === routed.saleId) ?? state.sales[0];

  if (!sale) {
    navigate('/vendre', { replace: true });
    return null;
  }

  const margin = sale.total - sale.cogs;
  const marginPct = sale.total > 0 ? (margin / sale.total) * 100 : 0;
  const units = sale.lines.reduce((s, l) => s + l.quantity, 0);

  return (
    <div className="flex min-h-full flex-1 flex-col bg-ivoire">
      <ScreenHeader title="Vente enregistrée" />

      <main className="flex-1 px-4 pb-32 pt-4">
        <div className="mb-4 flex items-center gap-2.5 rounded-[6px] bg-conforme-pale px-4 py-3">
          <span className="h-2 w-2 rounded-full bg-conforme" />
          <span className="text-[13px] text-conforme-deep">
            #{sale.number} ·{' '}
            {new Date(sale.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>

        <Card padded={false} className="px-4 py-2">
          {sale.lines.map((l) => (
            <AmountRow
              key={l.itemId}
              label={l.name}
              sub={`${l.quantity} × ${fcfa(l.unitPrice)}`}
              amount={l.quantity * l.unitPrice}
            />
          ))}
          <div className="border-t border-ink-100">
            <AmountRow label="Total encaissé" amount={sale.total} strong />
          </div>
        </Card>

        <SectionLabel className="mb-2 mt-6">Déduit automatiquement</SectionLabel>
        <Card padded={false} className="px-4 py-2">
          <AmountRow label="Stock disponible" amount={`−${units}`} unit="unités" />
          <AmountRow label="Coût des produits vendus" amount={sale.cogs} />
          <AmountRow
            label="Marge brute"
            sub={percent(marginPct)}
            amount={margin}
            tone="positive"
          />
        </Card>

        <p className="mt-4 px-1 text-[12px] leading-relaxed text-ink-500">
          Session de caisse shift #{state.cashSession.shiftNumber} mise à jour. Cette vente ne peut plus
          être supprimée — seulement annulée avec un motif.
        </p>
      </main>

      <div className="safe-b fixed inset-x-0 bottom-0 z-20 border-t border-ink-200 bg-ivoire/95 px-4 py-3 backdrop-blur">
        <div className="flex gap-2.5">
          <Button size="counter" className="flex-1" onClick={() => navigate('/commandes')}>
            Voir les ventes
          </Button>
          <Button variant="primary" size="counter" className="flex-[1.4]" onClick={() => navigate('/vendre')}>
            Nouvelle vente
          </Button>
        </div>
      </div>
    </div>
  );
}
