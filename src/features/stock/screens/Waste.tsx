import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useBuna, LOCATIONS, LOC } from '../../../store/BunaStore';
import { UNIT_LABEL, WASTE_LABEL, type WasteReason } from '../../../domain/types';
import { fcfaFull } from '../../../domain/money';
import { ScreenHeader } from '../../../design-system/components/patterns';
import {
  Button, NumberStepper, SectionLabel, SelectField,
} from '../../../design-system/components/primitives';

const REASONS: WasteReason[] = ['CASSE', 'PERIME', 'SURDOSAGE', 'BATCH_RATE', 'INVENDU', 'INCONNU'];

/** Déclarer une perte — RULE-008 : toute correction sensible possède un motif. */
export function Waste() {
  const { state, items, recordWaste } = useBuna();
  const navigate = useNavigate();

  const [itemId, setItemId] = useState(state.items[0]?.id ?? '');
  const [locationId, setLocationId] = useState<string>(LOC.KITCHEN);
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState<WasteReason | null>(null);

  const item = items.get(itemId);
  const cost = quantity * (item?.weightedAvgCost ?? 0);

  const submit = () => {
    if (!reason || !item) return;
    recordWaste({ itemId, locationId, quantity, reason });
    navigate(-1);
  };

  return (
    <div className="flex min-h-full flex-1 flex-col bg-ivoire">
      <ScreenHeader title="Déclarer une perte" onBack={() => navigate(-1)} />

      <main className="flex-1 space-y-5 px-4 pb-32 pt-4">
        <SelectField
          label="Article"
          value={itemId}
          onChange={setItemId}
          options={state.items.map((i) => ({ value: i.id, label: i.name }))}
        />
        <SelectField
          label="Emplacement"
          value={locationId}
          onChange={setLocationId}
          options={LOCATIONS.map((l) => ({ value: l.id, label: l.name }))}
        />

        <div>
          <span className="mb-1.5 block text-[13px] font-medium text-ink-700">Quantité perdue</span>
          <NumberStepper value={quantity} onChange={setQuantity} unit={item ? UNIT_LABEL[item.unit] : 'unités'} min={1} />
        </div>

        <div>
          <SectionLabel className="mb-2">Motif — obligatoire</SectionLabel>
          <div className="grid grid-cols-2 gap-2">
            {REASONS.map((r) => (
              <button
                key={r}
                onClick={() => setReason(r)}
                className={clsx(
                  'no-select min-h-[48px] rounded-[6px] text-[14px] transition-colors',
                  reason === r
                    ? 'border-2 border-brun bg-sable-pale text-cafe'
                    : 'border border-ink-200 bg-surface text-ink-700',
                )}
              >
                {WASTE_LABEL[r]}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between rounded-[6px] bg-critique-pale px-4 py-3">
          <span className="text-[14px] text-critique-deep">Coût de la perte</span>
          <span className="num text-[17px] text-critique-deep">{fcfaFull(cost)}</span>
        </div>
      </main>

      <div className="safe-b rail-bar bottom-0 z-20 border-t border-ink-200 bg-ivoire/95 py-3 backdrop-blur">
        <Button variant="primary" size="counter" full onClick={submit} disabled={!reason}>
          {reason ? 'Enregistrer la perte' : 'Choisissez un motif'}
        </Button>
      </div>
    </div>
  );
}
