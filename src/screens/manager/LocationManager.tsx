import { useState } from 'react';
import { useBuna } from '../../store/BunaStore';
import { uuid } from '../../domain/ids';
import type { LocationType, StockLocation } from '../../domain/types';
import { LOCATIONS } from '../../store/referentials';
import { SyncIndicator } from '../../design-system/components/SyncIndicator';
import { ScreenHeader } from '../../design-system/components/patterns';
import { Button, Card, Field } from '../../design-system/components/primitives';

export function LocationManager() {
  const { saveLocation } = useBuna();
  const [editing, setEditing] = useState<StockLocation | 'new' | null>(null);

  if (editing) {
    return <EditLocation location={editing} onSave={saveLocation} onClose={() => setEditing(null)} />;
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-ivoire">
      <SyncIndicator />
      <ScreenHeader
        title="Emplacements"
        subtitle={`${LOCATIONS.length} emplacement(s)`}
        action={<Button variant="secondary" onClick={() => setEditing('new')}>+ Emplacement</Button>}
      />

      <main className="flex-1 space-y-2 p-4">
        {LOCATIONS.map((loc) => (
          <Card
            key={loc.id}
            onClick={() => setEditing(loc)}
            className="flex cursor-pointer items-center justify-between transition-colors hover:bg-sable-pale"
          >
            <div>
              <div className="text-[15px] font-medium text-ink-900">{loc.name}</div>
              <div className="text-[12px] text-ink-500">Type : {loc.type}</div>
            </div>
            <div className="text-[18px] text-ink-300">›</div>
          </Card>
        ))}
      </main>
    </div>
  );
}

const LOCATION_TYPES: LocationType[] = ['CENTRAL', 'KITCHEN', 'FRIDGE', 'POS', 'RESERVE'];

function EditLocation({
  location,
  onSave,
  onClose,
}: {
  location: StockLocation | 'new';
  onSave: (loc: StockLocation) => void;
  onClose: () => void;
}) {
  const isNew = location === 'new';
  const [name, setName] = useState(isNew ? '' : location.name);
  const [type, setType] = useState<LocationType>(isNew ? 'RESERVE' : location.type);

  const canSave = name.trim().length > 0;

  const handleSave = () => {
    if (!canSave) return;
    const loc: StockLocation = isNew
      ? {
          id: `loc-${uuid()}`,
          siteId: 'site-auchan', // Will be dynamic when we support multiple sites
          name: name.trim(),
          type,
        }
      : { ...location, name: name.trim(), type };
    onSave(loc);
    onClose();
  };

  return (
    <div className="flex min-h-full flex-1 flex-col bg-ivoire">
      <ScreenHeader
        title={isNew ? 'Nouvel emplacement' : 'Modifier'}
        onBack={onClose}
      />

      <main className="flex-1 space-y-4 p-4">
        <Card className="space-y-4">
          <Field label="Nom de l'emplacement">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Frigo Boissons, Réserve arrière..."
              className="buna-input"
              autoFocus
            />
          </Field>

          <Field label="Rôle (Type)">
            <select
              value={type}
              onChange={(e) => setType(e.target.value as LocationType)}
              className="buna-input bg-white"
            >
              {LOCATION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          
          <p className="text-[12px] text-ink-500">
            Le type définit le comportement du stock dans cet emplacement. CENTRAL est le stock principal, POS est le point de vente, RESERVE est une zone de stockage secondaire.
          </p>
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
