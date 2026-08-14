import { useMemo, useState } from 'react';
import { useBuna, LOCATIONS } from '../../../store/BunaStore';
import { formatQty } from '../../../domain/units';
import { replenishmentNeed, stockHealth } from '../../../domain/stock';
import type { ItemKind } from '../../../domain/types';
import { SyncIndicator } from '../../../design-system/components/SyncIndicator';
import { StockRow } from '../../../design-system/components/patterns';
import {
  Button, Card, EmptyState, Field, SectionLabel, Segmented,
} from '../../../design-system/components/primitives';
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
  const { state, stockOf, can } = useBuna();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('ALL');
  const [locationFilter, setLocationFilter] = useState<string>('ALL');
  const [query, setQuery] = useState('');

  const locationOptions = useMemo(() => [
    { value: 'ALL', label: 'Tous les emplacements' },
    ...LOCATIONS.map(l => ({ value: l.id, label: l.name }))
  ], []);

  const rows = useMemo(() => {
    return state.items
      .filter((i) => (filter === 'ALL' ? true : i.kind === filter))
      .filter((i) => i.name.toLowerCase().includes(query.trim().toLowerCase()))
      .map((item) => {
        // On affiche l'emplacement qui porte l'essentiel du stock : c'est là qu'on ira le chercher.
        const perLocation = LOCATIONS
          .filter((l) => locationFilter === 'ALL' || l.id === locationFilter)
          .map((l) => ({ l, qty: stockOf(item.id, l.id) }))
          .filter((x) => x.qty > 0)
          .sort((a, b) => b.qty - a.qty);
          
        const total = locationFilter === 'ALL' 
          ? stockOf(item.id) 
          : stockOf(item.id, locationFilter);

        return {
          item,
          total,
          location: locationFilter !== 'ALL' 
            ? (LOCATIONS.find(l => l.id === locationFilter)?.name ?? 'Inconnu')
            : (perLocation[0]?.l.name ?? 'Aucun emplacement'),
          health: stockHealth(total, item),
        };
      })
      .filter(r => locationFilter === 'ALL' || r.total > 0 || r.item.targetStock !== undefined)
      .sort((a, b) => {
        const order = { RUPTURE: 0, CRITIQUE: 1, SURVEILLER: 2, OK: 3 };
        return order[a.health] - order[b.health];
      });
  }, [state.items, filter, query, stockOf, locationFilter]);

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

  /*
   * Le pont vers l'approvisionnement.
   *
   * Constater un manque et le commander étaient deux features séparées : on
   * voyait « Lait entier — critique » puis on partait le retrouver de tête dans
   * un autre écran. Ce qui manque part directement en commande, avec la
   * quantité qui manque et le dernier prix connu.
   */
  const missing = useMemo(
    () =>
      rows
        .map(({ item, total }) => ({ item, need: replenishmentNeed(total, item) }))
        .filter((r) => r.need > 0),
    [rows],
  );

  const buyMissing = () =>
    navigate('/appro/commande', {
      state: {
        lines: missing.map(({ item, need }) => ({
          itemId: item.id,
          quantity: Math.ceil(need),
          unitPrice: Math.round(item.weightedAvgCost ?? 0),
        })),
      },
    });

  return (
    <div className="flex min-h-full flex-1 flex-col bg-ivoire">
      <SyncIndicator />

      <header className="px-4 pb-3 pt-4">
        <h1 className="t-h1 text-cafe">Stock</h1>
        <p className="text-[12px] text-ink-500">Calculé depuis les mouvements · jamais saisi</p>
      </header>

      <div className="space-y-3 px-4 pb-3">
        <div className="flex gap-2">
          <Button size="compact" className="flex-1" onClick={() => navigate('/stock/transfert')}>Transférer</Button>
          <Button size="compact" className="flex-1" onClick={() => navigate('/stock/inventaire')}>Inventaire</Button>
          <Button size="compact" className="flex-1" onClick={() => navigate('/stock/perte')}>Perte</Button>
        </div>
        {missing.length > 0 && can('PLACE_ORDER') && (
          <Button variant="primary" size="compact" full onClick={buyMissing}>
            Commander ce qui manque — {missing.length} article{missing.length > 1 ? 's' : ''}
          </Button>
        )}
        <Field label="" placeholder="Rechercher un article" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="-mx-4 overflow-x-auto px-4 flex flex-col gap-3">
          <Segmented value={filter} onChange={setFilter} options={FILTERS} />
          <div className="flex gap-2 pb-1 overflow-x-auto no-scrollbar">
            {locationOptions.map(opt => (
              <Button
                key={opt.value}
                size="compact"
                variant={locationFilter === opt.value ? 'primary' : 'secondary'}
                onClick={() => setLocationFilter(opt.value)}
                className="whitespace-nowrap flex-shrink-0"
              >
                {opt.label}
              </Button>
            ))}
          </div>
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
