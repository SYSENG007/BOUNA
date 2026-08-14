import { useState } from 'react';
import { useBuna } from '../../../store/BunaStore';
import type { Item } from '../../../domain/types';
import { ITEM_KIND_LABEL, UNIT_LABEL } from '../../../domain/types';
import { SyncIndicator } from '../../../design-system/components/SyncIndicator';
import { ScreenHeader } from '../../../design-system/components/patterns';
import { Button, Card } from '../../../design-system/components/primitives';
import { fcfaFull } from '../../../domain/money';
import { ItemEditor } from './ItemEditor';

/**
 * Catalogue.
 *
 * L'édition passe par `ItemEditor`, qui portait déjà photo, coût, seuils et
 * fournisseur — et que personne n'appelait. Cet écran gardait à côté son propre
 * formulaire, limité au nom, au type, à l'unité et au prix : deux éditeurs pour
 * un même article, dont l'un ignorait la moitié de ses champs.
 */
export function CatalogManager() {
  const { state } = useBuna();
  const [editing, setEditing] = useState<Item | 'new' | null>(null);

  if (editing) {
    return <ItemEditor item={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />;
  }

  const items = state.items.filter((i) => !i.archived);

  return (
    <div className="flex min-h-full flex-1 flex-col bg-ivoire">
      <SyncIndicator />
      <ScreenHeader
        title="Catalogue Produits"
        subtitle={`${items.length} article(s)`}
        action={<Button variant="secondary" onClick={() => setEditing('new')}>+ Article</Button>}
      />

      <main className="flex-1 space-y-2 p-4">
        {items.map((item) => (
          <Card
            key={item.id}
            onClick={() => setEditing(item)}
            className="flex cursor-pointer items-center justify-between transition-colors hover:bg-sable-pale"
          >
            <div className="min-w-0">
              <div className="text-[15px] font-medium text-ink-900">{item.name}</div>
              <div className="text-[12px] text-ink-500">
                {ITEM_KIND_LABEL[item.kind]} · {UNIT_LABEL[item.unit]}
              </div>
            </div>
            {/* Un catalogue sans prix ne se relit pas : on ne savait pas à quoi
                on vendait ni à combien on achetait sans ouvrir chaque article.
                Le prix de vente est DÉCLARÉ ; le coût moyen pondéré est DÉDUIT
                des réceptions — d'où le filet doré sur le second seulement. */}
            <div className="ml-3 flex shrink-0 items-center gap-3">
              <div className="text-right">
                {item.price !== undefined && (
                  <div className="num text-[14px] text-ink-900">{fcfaFull(item.price)}</div>
                )}
                {item.weightedAvgCost !== undefined && item.weightedAvgCost > 0 && (
                  <div className="derived num text-[12px] text-ink-500">
                    coût {fcfaFull(Math.round(item.weightedAvgCost))} / {UNIT_LABEL[item.unit]}
                  </div>
                )}
                {item.price === undefined && !item.weightedAvgCost && (
                  <div className="text-[12px] text-surveiller-deep">prix à renseigner</div>
                )}
              </div>
              <div className="text-[18px] text-ink-300">›</div>
            </div>
          </Card>
        ))}
      </main>
    </div>
  );
}
