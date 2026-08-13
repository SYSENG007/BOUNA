import { useState } from 'react';
import { useBuna } from '../../store/BunaStore';
import { uuid } from '../../domain/ids';
import type { Item, ItemKind, Unit } from '../../domain/types';
import { UNIT_LABEL } from '../../domain/types';
import { SyncIndicator } from '../../design-system/components/SyncIndicator';
import { ScreenHeader } from '../../design-system/components/patterns';
import { Button, Card, Field, SelectField } from '../../design-system/components/primitives';

export function CatalogManager() {
  const { state, saveItem } = useBuna();
  const [editing, setEditing] = useState<Item | 'new' | null>(null);

  if (editing) {
    return <EditItem item={editing} onSave={saveItem} onClose={() => setEditing(null)} />;
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
            <div>
              <div className="text-[15px] font-medium text-ink-900">{item.name}</div>
              <div className="text-[12px] text-ink-500">
                {item.kind} · Unité : {UNIT_LABEL[item.unit]}
              </div>
            </div>
            <div className="text-[18px] text-ink-300">›</div>
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
  onClose,
}: {
  item: Item | 'new';
  onSave: (item: Item) => void;
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
            options={ITEM_KINDS.map((k) => ({ value: k, label: k }))}
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

      <footer className="safe-b sticky bottom-0 border-t border-ink-200 bg-ivoire/95 p-4 backdrop-blur">
        <Button full disabled={!canSave} onClick={handleSave}>
          Enregistrer
        </Button>
      </footer>
    </div>
  );
}
