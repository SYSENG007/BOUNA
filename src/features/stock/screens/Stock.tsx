import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { useBuna, LOCATIONS, RECIPES, RECIPE_VERSIONS } from '../../../store/BunaStore';
import { formatQty } from '../../../domain/units';
import { replenishmentNeed, stockHealth } from '../../../domain/stock';
import { consumptionVariance } from '../../../domain/production';
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
  const { state, items, stockOf, can } = useBuna();
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

  /*
   * §66 — théorique vs réel, déduit des recettes enregistrées.
   *
   * Cet écart se lisait sur un article nommé en dur (`it-lait`) et sur une dose
   * supposée de 150 mL par produit vendu, la même pour toutes les boissons. Sur
   * un vrai catalogue l'article n'existe pas : le réel restait à zéro et le
   * théorique décrivait une recette imaginaire. On ne montre plus que ce que
   * les recettes disent réellement, ingrédient par ingrédient.
   */
  const consumption = useMemo(() => {
    const soldByItem = new Map<string, number>();
    for (const sale of state.sales) {
      if (sale.status !== 'COMPLETED') continue;
      for (const line of sale.lines) {
        soldByItem.set(line.itemId, (soldByItem.get(line.itemId) ?? 0) + line.quantity);
      }
    }

    /* La recette d'un produit fini : celle qui le produit, dans sa version
       courante — la même lecture que l'écran de préparation. */
    const ingredientsOf = (finishedItemId: string) => {
      const recipe = RECIPES.find((r) => r.itemId === finishedItemId);
      if (!recipe) return undefined;
      const version =
        RECIPE_VERSIONS.find((v) => v.id === recipe.currentVersionId)
        ?? RECIPE_VERSIONS.find((v) => v.recipeId === recipe.id);
      return version?.ingredients;
    };

    return consumptionVariance(
      soldByItem,
      state.movements,
      ingredientsOf,
      (id) => items.get(id),
    );
  }, [state.sales, state.movements, items]);

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

        {consumption.length > 0 && (
          <>
            <SectionLabel>Théorique vs réel</SectionLabel>
            {/* Les trois plus gros écarts : au-delà, la liste cesse d'être lue. */}
            {consumption.slice(0, 3).map((row) => (
              <Card key={row.itemId} className="space-y-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[15px] font-medium text-ink-900">{row.name}</span>
                  <span className="num text-[11px] text-ink-500">
                    sur {row.soldUnits} vendu{row.soldUnits > 1 ? 's' : ''}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div>
                    {/* Le théorique est déduit d'une recette : filet doré. */}
                    <div className="derived num text-[19px] text-ink-900">
                      {formatQty(row.theoretical, row.unit)}
                    </div>
                    <div className="text-[11px] text-ink-500">Théorique</div>
                  </div>
                  <div>
                    <div className="num text-[19px] text-ink-900">{formatQty(row.actual, row.unit)}</div>
                    <div className="text-[11px] text-ink-500">Réel</div>
                  </div>
                  <div>
                    <div
                      className={clsx(
                        'num text-[19px]',
                        Math.abs(row.delta) < 0.001 ? 'text-conforme' : 'text-critique',
                      )}
                    >
                      {row.delta > 0 ? '+' : row.delta < 0 ? '−' : ''}
                      {formatQty(Math.abs(row.delta), row.unit)}
                    </div>
                    <div className="text-[11px] text-ink-500">Écart</div>
                  </div>
                </div>
                <p className="text-[12px] leading-relaxed text-ink-500">
                  {row.delta > 0
                    ? 'Il est sorti plus que ce que la recette prévoit : perte, surdosage ou comptage à revoir.'
                    : row.delta < 0
                      ? "Il est sorti moins que prévu : une production n'a peut-être pas été déclarée."
                      : 'La sortie correspond exactement à la recette.'}
                </p>
                {Math.abs(row.delta) >= 0.001 && (
                  <div className="flex gap-2.5">
                    <Button className="flex-1" onClick={() => navigate('/stock/perte')}>Déclarer une perte</Button>
                    <Button className="flex-1" onClick={() => navigate('/stock/inventaire')}>Inventaire</Button>
                  </div>
                )}
              </Card>
            ))}
          </>
        )}
      </main>
    </div>
  );
}
