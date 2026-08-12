import { useMemo, useState } from 'react';
import { useBuna } from '../../store/BunaStore';
import { fcfa, fcfaFull } from '../../domain/money';
import { EXPENSE_LABEL, PAYMENT_LABEL, type ExpenseCategory } from '../../domain/types';
import { SyncIndicator } from '../../design-system/components/SyncIndicator';
import { Card, SectionLabel, Segmented } from '../../design-system/components/primitives';

type Tab = 'EXPENSES' | 'AUDIT';

/**
 * Finance — charges directes d'un côté, traçabilité intégrale de l'autre.
 * « Rien ne se supprime. »
 */
export function Finance() {
  const { state } = useBuna();
  const [tab, setTab] = useState<Tab>('EXPENSES');
  const [category, setCategory] = useState<ExpenseCategory | 'ALL'>('ALL');

  const expenses = useMemo(
    () =>
      state.expenses
        .filter((e) => category === 'ALL' || e.category === category)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [state.expenses, category],
  );

  const total = expenses.reduce((s, e) => s + e.amount, 0);
  const categories = [...new Set(state.expenses.map((e) => e.category))];

  return (
    <div className="flex-1 bg-shell">
      <div className="lg:hidden"><SyncIndicator /></div>

      <div className="mx-auto max-w-4xl px-4 py-6 lg:px-10 lg:py-10">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="t-h1 text-cafe lg:text-[38px] lg:leading-[44px]">Finance</h1>
            <p className="text-[13px] text-ink-500">Dépenses du jour et journal d'audit</p>
          </div>
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'EXPENSES', label: 'Dépenses' },
              { value: 'AUDIT', label: 'Audit' },
            ]}
          />
        </header>

        {tab === 'EXPENSES' ? (
          <>
            <div className="mb-3 -mx-4 overflow-x-auto px-4">
              <Segmented
                value={category}
                onChange={setCategory}
                options={[
                  { value: 'ALL' as const, label: 'Toutes' },
                  ...categories.map((c) => ({ value: c, label: EXPENSE_LABEL[c] })),
                ]}
              />
            </div>

            <Card padded={false}>
              {expenses.map((e) => (
                <div
                  key={e.id}
                  className="flex items-center gap-3 border-b border-ink-100 px-4 py-3 last:border-0"
                >
                  <span className="num w-12 shrink-0 text-[12px] text-ink-500">
                    {new Date(e.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] text-ink-900">{e.description}</span>
                    <span className="block text-[12px] text-ink-500">
                      {EXPENSE_LABEL[e.category]} · {PAYMENT_LABEL[e.paymentMethod]}
                    </span>
                  </span>
                  <span className="num shrink-0 text-[15px] text-ink-900">{fcfa(e.amount)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between bg-sable-pale px-4 py-3">
                <span className="text-[14px] font-semibold text-cafe">Total du jour</span>
                <span className="num text-[18px] text-cafe">{fcfaFull(total)}</span>
              </div>
            </Card>
          </>
        ) : (
          <>
            <SectionLabel className="mb-2">Non modifiable · conservé 5 ans</SectionLabel>
            <Card padded={false}>
              {state.audit.map((a) => (
                <div key={a.id} className="flex gap-3 border-b border-ink-100 px-4 py-3 last:border-0">
                  <span className="num w-12 shrink-0 text-[12px] text-ink-500">
                    {new Date(a.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] text-ink-900">{a.action}</span>
                    <span className="block text-[12px] leading-snug text-ink-500">
                      {a.userName} · {a.role} · {a.detail}
                    </span>
                  </span>
                </div>
              ))}
            </Card>
            <p className="mt-3 px-1 text-[12px] leading-relaxed text-ink-500">
              Chaque ligne remonte à sa source : vente → batch → recette → lot → fournisseur → achat.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
