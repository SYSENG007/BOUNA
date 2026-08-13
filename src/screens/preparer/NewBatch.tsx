import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useBuna, LOC, LOCATIONS, RECIPE_VERSIONS } from '../../store/BunaStore';
import { formatQty } from '../../domain/units';
import { fcfaFull } from '../../domain/money';
import { ScreenHeader } from '../../design-system/components/patterns';
import {
  Button, Card, NumberStepper, SectionLabel, SelectField,
} from '../../design-system/components/primitives';

const LOSS_PRESETS = [0, 3];

/**
 * Déclarer un batch.
 * L'utilisateur déclare une quantité réelle ; le système en déduit la
 * consommation d'ingrédients, le rendement et le coût. Il ne calcule jamais.
 */
export function NewBatch() {
  const { items, completeBatch } = useBuna();
  const navigate = useNavigate();
  const routed = (useLocation().state ?? {}) as
    { itemId?: string; planned?: number; recipeVersionId?: string };

  const [recipeVersionId, setRecipeVersionId] = useState(routed.recipeVersionId ?? 'rv-vanilla-2');
  const planned = routed.planned ?? 30;
  const [produced, setProduced] = useState(routed.planned ?? 27);
  const [loss, setLoss] = useState(0);
  const [locationId, setLocationId] = useState<string>(LOC.FRIDGE);

  const version = RECIPE_VERSIONS.find((v) => v.id === recipeVersionId)!;
  const productId = version.recipeId === 'rc-vanilla' ? 'it-vanilla' : 'it-caramel';
  const product = items.get(productId)!;

  const yieldPct = planned > 0 ? Math.round((produced / planned) * 100) : 100;
  const unitCost = version.ingredients.reduce((sum, ing) => {
    const item = items.get(ing.itemId);
    if (!item) return sum;
    const perUnitInItemUnit =
      ing.unit === item.unit ? ing.quantity : ing.quantity / (item.unit === 'L' || item.unit === 'kg' ? 1000 : 1);
    return sum + perUnitInItemUnit * (item.weightedAvgCost ?? 0);
  }, 0);

  const submit = () => {
    completeBatch({ itemId: productId, recipeVersionId, planned, produced, loss, locationId });
    navigate('/production', { replace: true });
  };

  return (
    <div className="flex min-h-full flex-1 flex-col bg-ivoire">
      <ScreenHeader title="Nouveau batch" onBack={() => navigate('/production')} />

      <main className="flex-1 space-y-5 px-4 pb-32 pt-4">
        <div>
          <SelectField
            label="Produit"
            value={recipeVersionId}
            onChange={setRecipeVersionId}
            options={RECIPE_VERSIONS.map((v) => ({
              value: v.id,
              label: v.recipeId === 'rc-vanilla' ? 'Vanilla Iced Coffee' : 'Caramel Latte',
            }))}
            hint={`Recette v${version.version} · coût théorique ${fcfaFull(Math.round(unitCost))} / unité`}
          />
        </div>

        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="text-[13px] font-medium text-ink-700">Quantité produite</span>
            <span className="num text-[12px] text-ink-500">prévu {planned}</span>
          </div>
          <NumberStepper value={produced} onChange={setProduced} unit="unités" />
        </div>

        <div>
          <span className="mb-1.5 block text-[13px] font-medium text-ink-700">Pertes de préparation</span>
          <div className="grid grid-cols-3 gap-2">
            {LOSS_PRESETS.map((v) => (
              <button
                key={v}
                onClick={() => setLoss(v)}
                className={clsx(
                  'no-select min-h-[48px] rounded-[6px] text-[14px] transition-colors',
                  loss === v
                    ? 'border-2 border-brun bg-sable-pale text-cafe'
                    : 'border border-ink-200 bg-surface text-ink-700',
                )}
              >
                {v === 0 ? 'Aucune' : `${v} unités`}
              </button>
            ))}
            <button
              onClick={() => setLoss(Math.max(0, planned - produced))}
              className={clsx(
                'no-select min-h-[48px] rounded-[6px] text-[14px] transition-colors',
                !LOSS_PRESETS.includes(loss)
                  ? 'border-2 border-brun bg-sable-pale text-cafe'
                  : 'border border-ink-200 bg-surface text-ink-700',
              )}
            >
              Écart ({Math.max(0, planned - produced)})
            </button>
          </div>
        </div>

        {/* Ce que le système déduit tout seul — affiché avant validation, pas après. */}
        <div>
          <div className="derived">
            <SectionLabel className="mb-2">Consommation déduite</SectionLabel>
          </div>
          <Card padded={false} className="px-4 py-1">
            {version.ingredients.map((ing) => {
              const item = items.get(ing.itemId);
              if (!item) return null;
              return (
                <div
                  key={ing.itemId}
                  className="flex items-center justify-between border-b border-ink-100 py-2.5 last:border-0"
                >
                  <span className="text-[14px] text-ink-700">{item.name}</span>
                  <span className="num text-[14px] text-ink-900">
                    −{formatQty(ing.quantity * produced, ing.unit)}
                  </span>
                </div>
              );
            })}
          </Card>
        </div>

        <div className="flex items-center justify-between rounded-[6px] bg-sable-pale px-4 py-3">
          <span className="text-[14px] text-cafe">Rendement</span>
          <span className="num text-[16px] text-cafe">
            {yieldPct} %{produced < planned ? ` · −${planned - produced} unités` : ''}
          </span>
        </div>

        <SelectField
          label="Emplacement de destination"
          value={locationId}
          onChange={setLocationId}
          options={LOCATIONS.map((l) => ({ value: l.id, label: l.name }))}
        />

        <p className="px-1 text-[12px] leading-relaxed text-ink-500">
          {product.name} · recette v{version.version} figée. Le batch conservera cette version même si la
          recette évolue demain.
        </p>
      </main>

      <div className="safe-b rail-bar bottom-0 z-20 border-t border-ink-200 bg-ivoire/95 py-3 backdrop-blur">
        <Button variant="primary" size="counter" full onClick={submit} disabled={produced <= 0}>
          Enregistrer le batch
        </Button>
      </div>
    </div>
  );
}
