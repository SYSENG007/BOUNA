import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBuna } from '../../store/BunaStore';
import { fcfa, percent } from '../../domain/money';
import { stockHealth } from '../../domain/stock';
import { formatQty } from '../../domain/units';
import { SyncIndicator } from '../../design-system/components/SyncIndicator';
import { ActionRow, KpiTile } from '../../design-system/components/patterns';
import { Button, Card, SectionLabel } from '../../design-system/components/primitives';

/** Manager — « Quatre chiffres, trois points à surveiller, un bouton : clôturer. » */
export function Today() {
  const { state, stockOf } = useBuna();
  const navigate = useNavigate();

  const kpi = useMemo(() => {
    const sales = state.sales.filter((s) => s.status === 'COMPLETED');
    const revenue = sales.reduce((s, x) => s + x.total, 0);
    const cogs = sales.reduce((s, x) => s + x.cogs, 0);
    const units = sales.reduce((s, x) => s + x.lines.reduce((n, l) => n + l.quantity, 0), 0);
    const margin = revenue > 0 ? ((revenue - cogs) / revenue) * 100 : 0;
    return {
      revenue, cogs, units, margin,
      orders: sales.length,
      basket: sales.length ? Math.round(revenue / sales.length) : 0,
    };
  }, [state.sales]);

  const alerts = useMemo(() => {
    const out: { title: string; detail: string; tone: 'critique' | 'surveiller'; to: string; action: string }[] = [];
    for (const item of state.items) {
      const qty = stockOf(item.id);
      const health = stockHealth(qty, item);
      if (health === 'CRITIQUE' || health === 'RUPTURE') {
        const need = Math.max(0, (item.targetStock ?? 0) - qty);
        out.push({
          title: `Stock ${item.name.toLowerCase()} faible`,
          detail: `${formatQty(qty, item.unit)} · besoin estimé ${formatQty(need, item.unit)}`,
          tone: 'critique',
          to: '/approvisionnement',
          action: `Ajouter ${formatQty(need, item.unit)} au bon de commande`,
        });
      }
    }
    return out.slice(0, 4);
  }, [state.items, stockOf]);

  return (
    <div className="flex min-h-full flex-1 flex-col bg-ivoire">
      <SyncIndicator />

      <header className="px-4 pb-3 pt-4">
        <h1 className="t-h1 text-cafe">Aujourd'hui</h1>
        <p className="text-[12px] text-ink-500">
          {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} · Coffee Bar Auchan
        </p>
      </header>

      <main className="flex-1 space-y-4 px-4 pb-28">
        <Card className="flex flex-col gap-1">
          <SectionLabel>Chiffre d'affaires</SectionLabel>
          <div className="flex items-baseline gap-2">
            <span className="t-figure text-[40px] leading-none text-ink-900">{fcfa(kpi.revenue)}</span>
            <span className="text-[13px] text-ink-500">FCFA</span>
          </div>
          <div className="text-[12px] text-ink-500">
            {kpi.orders} commande{kpi.orders > 1 ? 's' : ''} enregistrée{kpi.orders > 1 ? 's' : ''} sur cet appareil
          </div>
        </Card>

        <div className="grid grid-cols-2 gap-3">
          <KpiTile label="Commandes" value={String(kpi.orders)} />
          <KpiTile label="Produits vendus" value={String(kpi.units)} />
          <KpiTile label="Panier moyen" value={fcfa(kpi.basket)} unit="FCFA" />
          <KpiTile
            label="Marge brute"
            value={percent(kpi.margin)}
            tone={kpi.margin >= 50 ? 'positive' : 'negative'}
          />
        </div>

        <SectionLabel className="pt-2">À surveiller</SectionLabel>
        {alerts.length === 0 ? (
          <Card>
            <p className="text-[14px] text-ink-500">Rien à signaler. Stocks au-dessus des seuils.</p>
          </Card>
        ) : (
          <Card padded={false}>
            {alerts.map((a, i) => (
              <ActionRow
                key={i}
                title={a.title}
                detail={a.detail}
                tone={a.tone}
                actionLabel={a.action}
                onClick={() => navigate(a.to)}
              />
            ))}
          </Card>
        )}
      </main>

      <div className="safe-b fixed inset-x-0 z-30 px-4 pb-2" style={{ bottom: 'var(--spacing-tabbar)' }}>
        <Button variant="primary" size="counter" full onClick={() => navigate('/cloture')}>
          Clôturer la journée
        </Button>
      </div>
    </div>
  );
}
