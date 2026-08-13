import { useMemo, useState } from 'react';
import { useBuna } from '../../store/BunaStore';
import { canAny } from '../../domain/permissions';
import { fcfaFull } from '../../domain/money';
import { formatQty } from '../../domain/units';
import { UNIT_LABEL, type Item, type ItemKind } from '../../domain/types';
import { SyncIndicator } from '../../design-system/components/SyncIndicator';
import { ProductImage } from '../../design-system/components/ProductImage';
import {
  Button, Card, EmptyState, Field, Segmented,
} from '../../design-system/components/primitives';
import { IconChevronRight, IconPlus } from '../../design-system/icons';
import { ItemEditor } from './ItemEditor';

const KINDS: { value: ItemKind | 'ALL'; label: string }[] = [
  { value: 'ALL', label: 'Tout' },
  { value: 'FINISHED', label: 'Produits' },
  { value: 'RAW_MATERIAL', label: 'Matières' },
  { value: 'PACKAGING', label: 'Emballages' },
];

/**
 * Catalogue — le seul écran où l'on saisit vraiment des données de référence.
 * Prix, seuils, photo : tout ce dont le reste du système déduit ses calculs.
 */
export function Catalogue() {
  const { state, user, stockOf } = useBuna();
  const [kind, setKind] = useState<ItemKind | 'ALL'>('ALL');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Item | 'new' | null>(null);

  const mayEdit = user ? canAny(user.roles, 'MODIFY_PRODUCT_COST') || canAny(user.roles, 'CREATE_PURCHASE') : false;

  const items = useMemo(
    () =>
      state.items
        .filter((i) => !i.archived)
        .filter((i) => (kind === 'ALL' ? true : i.kind === kind))
        .filter((i) => i.name.toLowerCase().includes(query.trim().toLowerCase())),
    [state.items, kind, query],
  );

  if (editing) {
    return <ItemEditor item={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />;
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-ivoire">
      <SyncIndicator />

      <header className="flex items-end justify-between gap-3 px-4 pb-3 pt-5">
        <div>
          <h1 className="t-h1 text-cafe">Catalogue</h1>
          <p className="t-small text-ink-500">
            {items.length} article{items.length > 1 ? 's' : ''} · prix, seuils et photos
          </p>
        </div>
        {mayEdit && (
          <Button variant="primary" size="compact" onClick={() => setEditing('new')}>
            <IconPlus size={16} />
            Nouvel article
          </Button>
        )}
      </header>

      <div className="space-y-3 px-4 pb-3">
        <Field label="" placeholder="Rechercher un article" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="-mx-4 overflow-x-auto px-4">
          <Segmented value={kind} onChange={setKind} options={KINDS} />
        </div>
      </div>

      <main className="flex-1 px-4 pb-28">
        {items.length === 0 ? (
          <EmptyState
            title="Aucun article"
            body={
              query
                ? "Aucun article ne porte ce nom. Vérifiez l'orthographe ou créez-le."
                : 'Créez votre premier article pour que le reste du système puisse en déduire stocks, coûts et marges.'
            }
            action={
              mayEdit ? (
                <Button variant="primary" onClick={() => setEditing('new')}>Créer un article</Button>
              ) : undefined
            }
          />
        ) : (
          <Card padded={false}>
            {items.map((item) => {
              const qty = stockOf(item.id);
              return (
                <button
                  key={item.id}
                  disabled={!mayEdit}
                  onClick={() => setEditing(item)}
                  className="flex w-full items-center gap-3 border-b border-ink-100 px-3 py-3 text-left transition-colors last:border-0 enabled:active:bg-sable-pale"
                >
                  <ProductImage src={item.imageUrl} name={item.name} size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium text-ink-900">{item.name}</span>
                    <span className="t-small block text-ink-500">
                      {item.price ? `${fcfaFull(item.price)} · ` : ''}
                      coût {fcfaFull(Math.round(item.weightedAvgCost ?? 0))} / {UNIT_LABEL[item.unit]}
                    </span>
                    <span className="num block text-[12px] text-ink-400">
                      en stock {formatQty(qty, item.unit)}
                    </span>
                  </span>
                  {mayEdit && <IconChevronRight size={18} className="shrink-0 text-ink-300" />}
                </button>
              );
            })}
          </Card>
        )}
      </main>
    </div>
  );
}
