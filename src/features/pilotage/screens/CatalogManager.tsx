import { useState } from 'react';
import { useBuna } from '../../../store/BunaStore';
import { uuid } from '../../../domain/ids';
import type { Item, ItemKind, Unit } from '../../../domain/types';
import { ITEM_KIND_LABEL, UNIT_LABEL } from '../../../domain/types';
import { SyncIndicator } from '../../../design-system/components/SyncIndicator';
import { ScreenHeader } from '../../../design-system/components/patterns';
import { Button, Card, Field, SelectField } from '../../../design-system/components/primitives';
import { fcfaFull } from '../../../domain/money';

export function CatalogManager() {
  const { state, saveItem, archiveItem } = useBuna();
  const [editing, setEditing] = useState<Item | 'new' | null>(null);

  if (editing) {
    return (
      <EditItem
        item={editing}
        onSave={saveItem}
        onArchive={archiveItem}
        onClose={() => setEditing(null)}
      />
    );
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

const ITEM_KINDS: ItemKind[] = ['RAW_MATERIAL', 'PACKAGING', 'INTERMEDIATE', 'FINISHED'];
const UNITS: Unit[] = ['kg', 'g', 'L', 'mL', 'unite', 'sachet', 'bouteille', 'paquet', 'carton'];

function EditItem({
  item,
  onSave,
  onArchive,
  onClose,
}: {
  item: Item | 'new';
  onSave: (item: Item) => void;
  onArchive: (itemId: string) => void;
  onClose: () => void;
}) {
  const isNew = item === 'new';
  const [name, setName] = useState(isNew ? '' : item.name);
  const [kind, setKind] = useState<ItemKind>(isNew ? 'FINISHED' : item.kind);
  const [unit, setUnit] = useState<Unit>(isNew ? 'unite' : item.unit);
  const [priceStr, setPriceStr] = useState(isNew || item.price === undefined ? '' : String(item.price));

  const canSave = name.trim().length > 0;

  const handleSave = () => {
    if (!canSave) return;
    const price = priceStr.trim() !== '' ? Number(priceStr) : undefined;
    
    const savedItem: Item = isNew
      ? {
          id: `it-${uuid()}`,
          name: name.trim(),
          kind,
          unit,
          price,
          weightedAvgCost: 0,
        }
      : { ...item, name: name.trim(), kind, unit, price };
      
    onSave(savedItem);
    onClose();
  };

  return (
    <div className="flex min-h-full flex-1 flex-col bg-ivoire">
      <ScreenHeader
        title={isNew ? 'Nouvel article' : 'Modifier'}
        onBack={onClose}
      />

      <main className="flex-1 space-y-4 p-4">
        <Card className="space-y-4">
          <Field 
            label="Nom de l'article"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex: Sirop de Fraise"
            className="buna-input"
            autoFocus
          />

          <SelectField 
            label="Type"
            value={kind}
            onChange={(v) => setKind(v as ItemKind)}
            options={ITEM_KINDS.map((k) => ({ value: k, label: ITEM_KIND_LABEL[k] }))}
          />
          
          <SelectField 
            label="Unité de gestion"
            value={unit}
            onChange={(v) => setUnit(v as Unit)}
            options={UNITS.map((u) => ({ value: u, label: `${UNIT_LABEL[u]} (${u})` }))}
          />

          {kind === 'FINISHED' && (
            <Field 
              label="Prix de vente (FCFA)"
              type="number"
              value={priceStr}
              onChange={(e) => setPriceStr(e.target.value)}
              placeholder="Ex: 2500"
              className="buna-input"
              inputMode="numeric"
            />
          )}
        </Card>
      </main>

      <footer className="safe-b sticky bottom-0 space-y-2 border-t border-ink-200 bg-ivoire/95 p-4 backdrop-blur">
        <Button full disabled={!canSave} onClick={handleSave}>
          Enregistrer
        </Button>
        {/* RULE-001 : rien ne s'efface. Retirer du catalogue sort l'article des
            écrans du jour sans toucher à son historique — les ventes et les
            mouvements passés doivent rester lisibles. Le bouton dit donc
            « retirer », pas « supprimer », et la confirmation reprend le mot. */}
        {!isNew && (
          <Button
            full
            className="text-critique"
            onClick={() => {
              const ok = window.confirm(
                `Retirer « ${item.name} » du catalogue ?\n\n`
                + "Il disparaît des écrans mais son historique de ventes et de "
                + "mouvements est conservé.",
              );
              if (ok) { onArchive(item.id); onClose(); }
            }}
          >
            Retirer du catalogue
          </Button>
        )}
      </footer>
    </div>
  );
}
