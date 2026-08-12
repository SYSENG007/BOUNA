import { useMemo, useState } from 'react';
import { useBuna } from '../../store/BunaStore';
import { fcfa, fcfaFull, percent } from '../../domain/money';
import { EXPENSE_LABEL, type ExpenseCategory } from '../../domain/types';
import { Card, SectionLabel, Segmented } from '../../design-system/components/primitives';
import { SyncIndicator } from '../../design-system/components/SyncIndicator';

type Range = 'DAY' | 'WEEK' | 'MONTH';

/**
 * Cockpit Owner — registre « brand » : trois questions, trois réponses.
 * Combien avons-nous vendu · combien avons-nous gagné · où perdons-nous de l'argent.
 */
export function Cockpit() {
  const { state, user } = useBuna();
  const [range, setRange] = useState<Range>('DAY');

  const m = useMemo(() => {
    const sales = state.sales.filter((s) => s.status === 'COMPLETED');
    const revenue = sales.reduce((s, x) => s + x.total, 0);
    const cogs = sales.reduce((s, x) => s + x.cogs, 0);
    const gross = revenue - cogs;
    const expenses = state.expenses.reduce((s, e) => s + e.amount, 0);
    const wasteCost = state.waste.reduce((s, w) => s + w.cost, 0);
    const cashVariance =
      state.cashSession.countedCash === null
        ? 0
        : state.cashSession.countedCash -
          (state.cashSession.openingCash +
            sales.filter((s) => s.paymentMethod === 'CASH').reduce((sum, s) => sum + s.total, 0));

    const byProduct = new Map<string, number>();
    for (const s of sales) {
      for (const l of s.lines) byProduct.set(l.name, (byProduct.get(l.name) ?? 0) + l.quantity);
    }
    const top = [...byProduct.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

    const byCategory = new Map<ExpenseCategory, number>();
    for (const e of state.expenses) byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.amount);

    return {
      revenue, cogs, gross, expenses, wasteCost, cashVariance, top,
      orders: sales.length,
      basket: sales.length ? Math.round(revenue / sales.length) : 0,
      marginPct: revenue > 0 ? (gross / revenue) * 100 : 0,
      leak: wasteCost + Math.abs(Math.min(0, cashVariance)),
      byCategory: [...byCategory.entries()].sort((a, b) => b[1] - a[1]),
      expenseTotal: expenses,
    };
  }, [state]);

  return (
    <div className="flex-1 bg-shell">
      <div className="lg:hidden"><SyncIndicator /></div>

      <div className="mx-auto max-w-5xl px-4 py-6 lg:px-10 lg:py-10">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-[32px] leading-tight text-cafe lg:text-[42px]">
              Bonjour {user?.name.split(' ')[0]}
            </h1>
            <p className="text-[13px] text-ink-500">
              {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} ·
              trois questions, trois réponses
            </p>
          </div>
          <Segmented
            value={range}
            onChange={setRange}
            options={[
              { value: 'DAY', label: "Aujourd'hui" },
              { value: 'WEEK', label: 'Semaine' },
              { value: 'MONTH', label: 'Mois' },
            ]}
          />
        </header>

        {range !== 'DAY' && (
          <div className="mb-4 rounded-[6px] bg-info-pale px-4 py-3 text-[13px] text-info-deep">
            Les agrégats hebdomadaires et mensuels seront calculés côté serveur (vues PostgreSQL).
            Les chiffres ci-dessous restent ceux de la journée locale.
          </div>
        )}

        {/* Trois questions — le cœur du cockpit. */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="flex flex-col gap-2">
            <SectionLabel>Combien avons-nous vendu ?</SectionLabel>
            <div className="flex items-baseline gap-2">
              <span className="num text-[36px] leading-none text-ink-900">{fcfa(m.revenue)}</span>
              <span className="text-[12px] text-ink-500">FCFA</span>
            </div>
            <div className="num text-[12px] text-ink-500">
              {m.orders} commandes · {fcfa(m.basket)} / panier
            </div>
          </Card>

          <Card className="flex flex-col gap-2">
            <SectionLabel>Combien avons-nous gagné ?</SectionLabel>
            <div className="flex items-baseline gap-2">
              <span className="num text-[36px] leading-none text-conforme-deep">{fcfa(m.gross)}</span>
              <span className="text-[12px] text-ink-500">FCFA</span>
            </div>
            <div className="num text-[12px] text-ink-500">Marge {percent(m.marginPct)}</div>
          </Card>

          <Card className="flex flex-col gap-2">
            <SectionLabel>Où perdons-nous de l'argent ?</SectionLabel>
            <div className="flex items-baseline gap-2">
              {/* Zéro perte n'est pas une alerte : le rouge est réservé à une vraie fuite. */}
              <span
                className={`num text-[36px] leading-none ${m.leak > 0 ? 'text-critique' : 'text-conforme-deep'}`}
              >
                {m.leak > 0 ? `−${fcfa(m.leak)}` : '0'}
              </span>
              <span className="text-[12px] text-ink-500">FCFA</span>
            </div>
            <div className="num text-[12px] text-ink-500">
              {m.leak > 0
                ? `Waste ${fcfa(m.wasteCost)} · Caisse ${m.cashVariance !== 0 ? fcfa(m.cashVariance) : '—'}`
                : 'Aucune perte constatée aujourd\'hui'}
            </div>
          </Card>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card>
            <SectionLabel className="mb-3">Top produits</SectionLabel>
            {m.top.length === 0 ? (
              <p className="text-[14px] text-ink-500">Aucune vente enregistrée sur cet appareil.</p>
            ) : (
              <div className="space-y-2.5">
                {m.top.map(([name, qty]) => {
                  const max = m.top[0][1];
                  return (
                    <div key={name} className="flex items-center gap-3">
                      <span className="w-40 shrink-0 truncate text-[13px] text-ink-700">{name}</span>
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100">
                        <span className="block h-full bg-brun" style={{ width: `${(qty / max) * 100}%` }} />
                      </span>
                      <span className="num w-8 shrink-0 text-right text-[13px] text-ink-900">{qty}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <Card>
            <SectionLabel className="mb-3">Dépenses du jour · {fcfaFull(m.expenseTotal)}</SectionLabel>
            <div className="space-y-2.5">
              {m.byCategory.map(([cat, amount]) => (
                <div key={cat} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 text-[13px] text-ink-700">{EXPENSE_LABEL[cat]}</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100">
                    <span
                      className="block h-full bg-sable"
                      style={{ width: `${m.expenseTotal ? (amount / m.expenseTotal) * 100 : 0}%` }}
                    />
                  </span>
                  <span className="num w-12 shrink-0 text-right text-[13px] text-ink-900">
                    {m.expenseTotal ? Math.round((amount / m.expenseTotal) * 100) : 0} %
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
