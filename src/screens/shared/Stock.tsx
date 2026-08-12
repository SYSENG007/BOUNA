import { useMemo, useState } from 'react';
import { useBuna, LOCATIONS } from '../../store/BunaStore';
import { formatQty } from '../../domain/units';
import { stockHealth } from '../../domain/stock';
import type { ItemKind } from '../../domain/types';
import { SyncIndicator } from '../../design-system/components/SyncIndicator';
import { StockRow } from '../../design-system/components/patterns';
import {
  Button, Card, EmptyState, Field, SectionLabel, Segmented,
} from '../../design-system/components/primitives';
import { useNavigate } from 'react-router-dom';

type Filter = 'ALL' | ItemKind;

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'ALL', label: 'Tout' },
  { value: 'RAW_MATERIAL', label: 'Matières' },
  { value: 'FINISHED', label: 'Préparés' },
  { value: 'PACKAGING', label: 'Emballages' },
];

/**
 * Stock temps réel.
 * « Stock issu des mouvements, jamais saisi. L'écart théorique/réel est visible
 * sur l'écran, pas dans un rapport. »
 */
export function Stock() {
  const { state, stockOf } = useBuna();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('ALL');
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    return state.items
      .filter((i) => (filter === 'ALL' ? true : i.kind === filter))
      .filter((i) => i.name.toLowerCase().includes(query.trim().toLowerCase()))
      .map((item) => {
        // On affiche l'emplacement qui porte l'essentiel du stock : c'est là qu'on ira le chercher.
        const perLocation = LOCATIONS.map((l) => ({ l, qty: stockOf(item.id, l.id) }))
          .filter((x) => x.qty > 0)
          .sort((a, b) => b.qty - a.qty);
        const total = stockOf(item.id);
        return {
          item,
          total,
          location: perLocation[0]?.l.name ?? 'Aucun emplacement',
          health: stockHealth(total, item),
        };
      })
      .sort((a, b) => {
        const order = { RUPTURE: 0, CRITIQUE: 1, SURVEILLER: 2, OK: 3 };
        return order[a.health] - order[b.health];
      });
  }, [state.items, filter, query, stockOf]);

  /* §66 — théorique vs réel sur le lait, calculé depuis les ventes du jour. */
  const milkVariance = useMemo(() => {
    const soldUnits = state.sales
      .filter((s) => s.status === 'COMPLETED')
      .reduce((sum, s) => sum + s.lines.reduce((n, l) => n + l.quantity, 0), 0);
    const theoretical = (soldUnits * 150) / 1000; // 150 mL par produit
    const actual = state.movements
      .filter((m) => m.itemId === 'it-lait' && m.movementType === 'PRODUCTION_CONSUMPTION')
      .reduce((sum, m) => sum + Math.abs(m.quantity) / (m.unit === 'mL' ? 1000 : 1), 0);
    return { theoretical, actual, delta: actual - theoretical, soldUnits };
  }, [state.sales, state.movements]);

  return (
    <div className="flex min-h-full flex-1 flex-col bg-ivoire">
      <SyncIndicator />

      <header className="px-4 pb-3 pt-4">
        <h1 className="t-h1 text-cafe">Stock</h1>
        <p className="text-[12px] text-ink-500">Calculé depuis les mouvements · jamais saisi</p>
      </header>

      <div className="space-y-3 px-4 pb-3">
        <Field label="" placeholder="Rechercher un article" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="-mx-4 overflow-x-auto px-4">
          <Segmented value={filter} onChange={setFilter} options={FILTERS} />
        </div>
      </div>

      <main className="flex-1 space-y-4 px-4 pb-28">
        {rows.length === 0 ? (
          <EmptyState title="Aucun article" body="Aucun article ne correspond à cette recherche." />
        ) : (
          <Card padded={false}>
            {rows.map(({ item, total, location, health }) => (
              <StockRow
                key={item.id}
                name={item.name}
                location={location}
                quantity={formatQty(total, item.unit)}
                health={health}
              />
            ))}
          </Card>
        )}

        {milkVariance.soldUnits > 0 && (
          <>
            <SectionLabel>Théorique vs réel — lait</SectionLabel>
            <Card className="space-y-3">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <div className="num text-[19px] text-ink-900">{milkVariance.theoretical.toFixed(1)} L</div>
                  <div className="text-[11px] text-ink-500">Théorique</div>
                </div>
                <div>
                  <div className="num text-[19px] text-ink-900">{milkVariance.actual.toFixed(1)} L</div>
                  <div className="text-[11px] text-ink-500">Réel</div>
                </div>
                <div>
                  <div className="num text-[19px] text-critique">
                    {milkVariance.delta >= 0 ? '−' : '+'}{Math.abs(milkVariance.delta).toFixed(1)} L
                  </div>
                  <div className="text-[11px] text-ink-500">Écart</div>
                </div>
              </div>
              <p className="text-[12px] leading-relaxed text-ink-500">
                Sur {milkVariance.soldUnits} ventes. Un écart s'affiche avec sa cause possible : lancez un
                inventaire ou déclarez un gaspillage.
              </p>
              <div className="flex gap-2.5">
                <Button className="flex-1" onClick={() => navigate('/stock/perte')}>Déclarer une perte</Button>
                <Button className="flex-1" onClick={() => navigate('/stock/inventaire')}>Inventaire</Button>
              </div>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
