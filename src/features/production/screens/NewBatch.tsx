import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { feasibleUnits, shortfallFor } from '../../../domain/production';
import { useBuna, LOC, LOCATIONS, RECIPE_VERSIONS } from '../../../store/BunaStore';
import { formatQty } from '../../../domain/units';
import { fcfaFull } from '../../../domain/money';
import { ScreenHeader } from '../../../design-system/components/patterns';
import {
  Button, Card, NumberStepper, SectionLabel, SelectField,
} from '../../../design-system/components/primitives';

const LOSS_PRESETS = [0, 3];

/**
 * Déclarer un batch.
 * L'utilisateur déclare une quantité réelle ; le système en déduit la
 * consommation d'ingrédients, le rendement et le coût. Il ne calcule jamais.
 */
export function NewBatch() {
  const { items, completeBatch, stockOf } = useBuna();
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

  /* Ce que les matières permettent réellement. L'écran laissait déclarer
     vingt-deux unités avec de quoi en faire zéro : le stock partait en négatif
     sans que rien ne le signale, et « Rupture » s'affichait sur un article
     qu'on venait de consommer deux fois. */
  const feasible = feasibleUnits(version.ingredients, (id) => items.get(id), (id) => stockOf(id));
  const shortfall = shortfallFor(version.ingredients, (id) => items.get(id), (id) => stockOf(id), produced);

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

        {/* On ne bloque pas : le préparateur a réellement fabriqué ce qu'il
            déclare, et lui refuser sa saisie éloignerait l'application du
            terrain. Mais il doit voir la conséquence avant de valider — sinon
            le stock devient une fiction que personne ne rattrape. */}
        {shortfall.length > 0 ? (
          <Card className="space-y-2 border border-surveiller bg-surveiller-pale">
            <div className="text-[14px] font-medium text-or-ink">
              Les matières ne suffisent pas pour {produced} unité{produced > 1 ? 's' : ''}
            </div>
            <ul className="space-y-1">
              {shortfall.map((m) => (
                <li key={m.itemId} className="num text-[13px] text-or-ink">
                  {m.name} — il manque {formatQty(m.missing, m.unit)}
                </li>
              ))}
            </ul>
            <p className="text-[12px] leading-relaxed text-or-ink">
              {feasible.unknown
                ? "Recette incomplète : impossible de dire combien d'unités sont possibles."
                : `Les matières en stock permettent ${feasible.units} unité${feasible.units > 1 ? 's' : ''}.`}{' '}
              Vous pouvez enregistrer quand même — le stock passera en négatif et
              l'écart devra être expliqué.
            </p>
          </Card>
        ) : (
          !feasible.unknown && (
            <p className="derived px-1 text-[12px] text-ink-500">
              Matières suffisantes — {feasible.units} unité{feasible.units > 1 ? 's' : ''} possibles
              {feasible.limitingName !== '—' && `, ${feasible.limitingName} limite`}.
            </p>
          )
        )}
      </main>

      <div className="action-bar rail-bar bottom-0 z-20 border-t border-ink-200 bg-ivoire/95 backdrop-blur">
        <Button variant="primary" size="counter" full onClick={submit} disabled={produced <= 0}>
          Enregistrer le batch
        </Button>
      </div>
    </div>
  );
}
