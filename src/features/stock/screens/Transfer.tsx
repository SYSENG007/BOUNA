import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useBuna, LOCATIONS } from '../../../store/BunaStore';
import { formatQty } from '../../../domain/units';
import { UNIT_LABEL } from '../../../domain/types';
import { ScreenHeader } from '../../../design-system/components/patterns';
import { ProductImage } from '../../../design-system/components/ProductImage';
import {
  Button, Card, NumberStepper, SectionLabel, SelectField,
} from '../../../design-system/components/primitives';
import { IconTransfer } from '../../../design-system/icons';

/**
 * Transfert de stock (§30).
 * Deux mouvements cohérents partageant un même identifiant : ce qui sort d'un
 * emplacement entre dans l'autre. On ne peut jamais transférer plus que ce qui
 * est réellement présent à l'origine.
 */
export function Transfer() {
  const { state, items, stockOf, transferStock } = useBuna();
  const navigate = useNavigate();

  const [from, setFrom] = useState<string>(LOCATIONS[1].id);
  const [to, setTo] = useState<string>(LOCATIONS[3].id);
  const [itemId, setItemId] = useState<string>('');
  const [quantity, setQuantity] = useState(1);

  /* On ne propose que ce qui existe à l'emplacement de départ. */
  const available = useMemo(
    () =>
      state.items
        .filter((i) => !i.archived && stockOf(i.id, from) > 0)
        .map((i) => ({ item: i, qty: stockOf(i.id, from) })),
    [state.items, from, stockOf],
  );

  const selected = itemId ? items.get(itemId) : undefined;
  const maxQty = selected ? Math.floor(stockOf(selected.id, from) * 100) / 100 : 0;
  const sameLocation = from === to;
  const canSubmit = !!selected && quantity > 0 && quantity <= maxQty && !sameLocation;

  const submit = () => {
    if (!canSubmit || !selected) return;
    transferStock({ itemId: selected.id, from, to, quantity });
    navigate('/stock', { replace: true });
  };

  const fromName = LOCATIONS.find((l) => l.id === from)?.name ?? '';
  const toName = LOCATIONS.find((l) => l.id === to)?.name ?? '';

  return (
    <div className="flex min-h-full flex-1 flex-col bg-ivoire">
      <ScreenHeader title="Transférer du stock" onBack={() => navigate(-1)} />

      <main className="flex-1 space-y-5 px-4 pb-32 pt-4">
        {/* Le trajet, montré avant les détails : d'où, vers où. */}
        <Card className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <SectionLabel>Depuis</SectionLabel>
            <div className="truncate text-[15px] font-medium text-ink-900">{fromName}</div>
          </div>
          <IconTransfer size={22} className="shrink-0 text-brun" />
          <div className="min-w-0 flex-1 text-right">
            <SectionLabel>Vers</SectionLabel>
            <div className="truncate text-[15px] font-medium text-ink-900">{toName}</div>
          </div>
        </Card>

        <div className="grid grid-cols-2 gap-3">
          <SelectField
            label="Emplacement d'origine"
            value={from}
            onChange={(v) => { setFrom(v); setItemId(''); setQuantity(1); }}
            options={LOCATIONS.map((l) => ({ value: l.id, label: l.name }))}
          />
          <SelectField
            label="Destination"
            value={to}
            onChange={setTo}
            options={LOCATIONS.map((l) => ({ value: l.id, label: l.name }))}
          />
        </div>

        {sameLocation && (
          <p className="rounded-[4px] bg-surveiller-pale px-3 py-2 text-[13px] text-or-ink">
            Choisissez deux emplacements différents.
          </p>
        )}

        <div>
          <SectionLabel className="mb-2">Article à transférer</SectionLabel>
          {available.length === 0 ? (
            <Card>
              <p className="t-small text-ink-500">
                Aucun stock à {fromName}. Choisissez un autre emplacement d'origine.
              </p>
            </Card>
          ) : (
            <Card padded={false}>
              {available.map(({ item, qty }) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setItemId(item.id);
                    setQuantity(Math.min(quantity, Math.floor(qty)) || 1);
                  }}
                  className={clsx(
                    'flex w-full items-center gap-3 border-b border-ink-100 px-3 py-3 text-left transition-colors last:border-0',
                    itemId === item.id ? 'bg-sable-pale' : 'active:bg-sable-pale',
                  )}
                >
                  <ProductImage src={item.imageUrl} name={item.name} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium text-ink-900">{item.name}</span>
                    <span className="num block text-[12px] text-ink-500">
                      {formatQty(qty, item.unit)} disponibles
                    </span>
                  </span>
                  {itemId === item.id && (
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-brun" />
                  )}
                </button>
              ))}
            </Card>
          )}
        </div>

        {selected && (
          <>
            <div>
              <div className="mb-1.5 flex items-baseline justify-between">
                <span className="text-[13px] font-medium text-ink-800">Quantité à transférer</span>
                <span className="num text-[12px] text-ink-500">
                  max {formatQty(maxQty, selected.unit)}
                </span>
              </div>
              <NumberStepper
                value={quantity}
                onChange={setQuantity}
                unit={UNIT_LABEL[selected.unit]}
                min={1}
                max={maxQty}
              />
            </div>

            {/* Ce que le transfert va produire — déduit, jamais saisi. */}
            <div className="derived">
              <SectionLabel className="mb-1">Après le transfert</SectionLabel>
              <p className="t-small text-ink-700">
                {fromName} : {formatQty(maxQty - quantity, selected.unit)} restants
              </p>
              <p className="t-small text-ink-700">
                {toName} : {formatQty(stockOf(selected.id, to) + quantity, selected.unit)}
              </p>
            </div>
          </>
        )}
      </main>

      <div className="safe-b rail-bar bottom-0 z-40 border-t border-ink-200 bg-ivoire/95 py-3 backdrop-blur">
        <Button variant="primary" size="counter" full disabled={!canSubmit} onClick={submit}>
          {!selected
            ? 'Choisissez un article'
            : sameLocation
              ? 'Choisissez deux emplacements'
              : `Transférer ${formatQty(quantity, selected.unit)}`}
        </Button>
      </div>
    </div>
  );
}
