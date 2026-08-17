import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { consumedBy, feasibleUnits, shortfallFor, type ConsumedLine } from '../../../domain/production';
import { useBuna, LOC, LOCATIONS, RECIPES, RECIPE_VERSIONS } from '../../../store/BunaStore';
import { canConvert, convert, formatQty, storageUnit, subUnitsOf } from '../../../domain/units';
import { fcfaFull } from '../../../domain/money';
import { UNIT_LABEL, isMadeToOrder, type DosingUnit, type UUID } from '../../../domain/types';
import { ScreenHeader } from '../../../design-system/components/patterns';
import {
  Button, Card, Field, NumberStepper, SectionLabel, SelectField,
} from '../../../design-system/components/primitives';
import { IconClose } from '../../../design-system/icons';

/** Une ligne de sortie en cours de saisie — les champs sont du texte tant qu'on tape. */
interface DraftLine { key: string; itemId: UUID; quantity: string; unit: DosingUnit }

let lineKey = 0;

/**
 * Déclarer une préparation.
 *
 * L'écran exigeait une recette pour s'ouvrir. Sur un établissement qui vient
 * d'ouvrir, il n'y en a aucune : pas de recette, pas de production ; pas de
 * production, pas de produit fini ; pas de produit fini, pas de vente. Toute
 * l'application se refermait sur une donnée de référence que personne ne
 * pouvait encore écrire honnêtement.
 *
 * La seule question qui compte est donc posée en premier — qu'avez-vous
 * préparé, et combien. La recette, quand elle existe, ajoute ce qu'elle sait
 * déduire. Elle ne conditionne plus rien.
 */
export function NewBatch() {
  const { state, items, completeBatch, stockOf, saveItem } = useBuna();
  const navigate = useNavigate();
  const routed = (useLocation().state ?? {}) as
    { itemId?: string; planned?: number; recipeVersionId?: string };

  /* Ce qu'on peut déclarer avoir préparé : un produit fini du catalogue. */
  const products = useMemo(
    () => state.items.filter((i) => i.kind === 'FINISHED' && !i.archived),
    [state.items],
  );

  const [productId, setProductId] = useState<UUID>(routed.itemId ?? products[0]?.id ?? '');
  const [produced, setProduced] = useState(routed.planned ?? 0);
  const [loss, setLoss] = useState(0);
  const [locationId, setLocationId] = useState<string>(LOC.POS);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [showLines, setShowLines] = useState(false);

  const product = items.get(productId);
  /* Le plan n'existe que quand la production du jour en a proposé un. Déclarer
     une préparation spontanée n'a pas de « prévu » : le rendement vaut alors
     100 %, ce qui est la vérité — on n'a pas fait moins que prévu, on n'avait
     rien prévu. */
  const planned = routed.planned ?? produced;

  /* La recette du produit choisi, si quelqu'un en a écrit une. */
  const recipe = RECIPES.find((r) => r.itemId === productId);
  const version = recipe
    ? RECIPE_VERSIONS.find((v) => v.id === recipe.currentVersionId)
      ?? RECIPE_VERSIONS.find((v) => v.recipeId === recipe.id)
    : undefined;

  /* Les articles qu'on peut déclarer avoir sortis : tout sauf le produit fini
     lui-même — un café ne se fabrique pas avec des cafés. */
  const consumables = useMemo(
    () => state.items.filter((i) => !i.archived && i.kind !== 'FINISHED'),
    [state.items],
  );

  /* Ce que la déclaration va réellement sortir du stock. Le constat d'abord,
     la recette ensuite : la règle vit dans le domaine, pas ici. */
  const declared: ConsumedLine[] = lines.flatMap((line) => {
    const quantity = Number(line.quantity.replace(',', '.'));
    if (!line.itemId || !Number.isFinite(quantity) || quantity <= 0) return [];
    return [{ itemId: line.itemId, quantity, unit: storageUnit(line.unit) }];
  });
  const consumption = consumedBy(produced, declared, version?.ingredients);

  /* Ramenée à « par unité produite » pour être lisible face à un stock. */
  const perUnit = produced > 0
    ? consumption.map((c) => ({ ...c, quantity: c.quantity / produced }))
    : consumption;

  const feasible = feasibleUnits(perUnit, (id) => items.get(id), (id) => stockOf(id));
  const shortfall = shortfallFor(perUnit, (id) => items.get(id), (id) => stockOf(id), produced);

  const yieldPct = planned > 0 ? Math.round((produced / planned) * 100) : 100;

  /* Coût de ce qui est sorti, au coût moyen pondéré. Sans consommation
     déclarée ni recette, il n'y a pas de coût à annoncer — et zéro serait un
     mensonge, pas une absence. */
  const batchCost = consumption.reduce((sum, line) => {
    const item = items.get(line.itemId);
    if (!item || !canConvert(line.unit, item.unit)) return sum;
    return sum + convert(line.quantity, line.unit, item.unit) * (item.weightedAvgCost ?? 0);
  }, 0);
  const costKnown = consumption.length > 0;

  const addLine = () => {
    const first = consumables[0];
    if (!first) return;
    lineKey += 1;
    setLines((l) => [...l, { key: `l${lineKey}`, itemId: first.id, quantity: '', unit: first.unit }]);
  };
  const patchLine = (key: string, next: Partial<DraftLine>) =>
    setLines((l) => l.map((line) => (line.key === key ? { ...line, ...next } : line)));

  const submit = () => {
    if (!product || produced <= 0) return;
    completeBatch({
      itemId: productId,
      recipeVersionId: version?.id ?? null,
      planned,
      produced,
      loss,
      locationId,
      consumption: declared,
    });
    navigate('/production', { replace: true });
  };

  /* Sans produit fini au catalogue, il n'y a rien à déclarer — et cette
     fois c'est vrai : on ne peut pas préparer un produit qui n'existe pas.
     On donne le chemin plutôt que d'afficher une liste vide. */
  if (products.length === 0) {
    return (
      <div className="flex min-h-full flex-1 flex-col bg-ivoire">
        <ScreenHeader title="Déclarer une préparation" onBack={() => navigate('/production')} />
        <main className="flex-1 px-4 pt-4">
          <Card className="space-y-3">
            <div className="text-[15px] font-medium text-ink-900">Aucun produit fini au catalogue</div>
            <p className="text-[13px] leading-relaxed text-ink-600">
              Une préparation produit un article vendable au comptoir. Créez-en un, puis revenez
              déclarer ce que vous avez préparé.
            </p>
            <Button variant="primary" onClick={() => navigate('/pilotage/catalogue')}>
              Ouvrir le catalogue
            </Button>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-ivoire">
      <ScreenHeader title="Déclarer une préparation" onBack={() => navigate('/production')} />

      <main className="flex-1 space-y-5 px-4 pb-32 pt-4">
        <SelectField
          label="Qu'avez-vous préparé ?"
          value={productId}
          onChange={setProductId}
          options={products.map((p) => ({ value: p.id, label: p.name }))}
          hint={
            version
              ? `Recette v${version.version}${costKnown ? ` · ${fcfaFull(Math.round(batchCost / Math.max(1, produced)))} par unité` : ''}`
              : "Aucune recette enregistrée pour ce produit — vous pouvez déclarer quand même."
          }
        />

        {/*
          Un produit monté devant le client n'a pas de stock à lui : lui en
          créer un produirait un compteur qui monte et ne redescend jamais,
          puisque la vente ne le décompte pas. On le dit, et on propose le
          geste qui répare — sans l'imposer.
        */}
        {product && isMadeToOrder(product) && (
          <Card className="space-y-2 border border-info bg-info-pale">
            <div className="text-[14px] font-medium text-info-deep">
              « {product.name} » est monté devant le client
            </div>
            <p className="text-[12.5px] leading-relaxed text-info-deep">
              Il n'a pas de stock à lui : le comptoir ne décomptera pas ce que vous déclarez ici.
              Si vous le préparez d'avance, comptez-le désormais.
            </p>
            <Button
              size="compact"
              onClick={() => saveItem({ ...product, productionMode: 'BATCH' })}
            >
              Le compter désormais
            </Button>
          </Card>
        )}

        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="text-[13px] font-medium text-ink-700">Quantité préparée</span>
            {routed.planned != null && (
              <span className="num text-[12px] text-ink-500">prévu {routed.planned}</span>
            )}
          </div>
          <NumberStepper value={produced} onChange={setProduced} unit="unités" />
        </div>

        {/*
          Ce qui est sorti pour ce lot. Facultatif, et c'est tout l'intérêt :
          personne ne pèse ses grammes le matin du service. Mais quand la ligne
          est notée, c'est elle qui fait foi — pas la recette, qui ne dit que
          ce qui aurait dû sortir.
        */}
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <span className="text-[13px] font-medium text-ink-700">Ce que vous avez sorti</span>
            <button
              type="button"
              onClick={() => { setShowLines((v) => !v); if (!showLines && lines.length === 0) addLine(); }}
              className="text-[12.5px] font-medium text-cafe underline underline-offset-2"
            >
              {showLines ? 'Masquer' : version ? 'Autre chose que la recette' : 'Le noter (facultatif)'}
            </button>
          </div>

          {showLines && (
            <Card padded={false} className="space-y-3 px-4 py-4">
              {lines.map((line) => {
                const item = items.get(line.itemId);
                return (
                  <div key={line.key} className="flex items-end gap-2">
                    <div className="min-w-0 flex-[1.4]">
                      <SelectField
                        label="Article"
                        value={line.itemId}
                        onChange={(v) => {
                          const next = items.get(v);
                          patchLine(line.key, { itemId: v, unit: next?.unit ?? 'unite' });
                        }}
                        options={consumables.map((i) => ({ value: i.id, label: i.name }))}
                      />
                    </div>
                    <div className="w-[92px] shrink-0">
                      <Field
                        label="Quantité"
                        type="number"
                        inputMode="decimal"
                        value={line.quantity}
                        onChange={(e) => patchLine(line.key, { quantity: e.target.value })}
                      />
                    </div>
                    <div className="w-[96px] shrink-0">
                      <SelectField
                        label="Unité"
                        value={line.unit}
                        onChange={(v) => patchLine(line.key, { unit: v as DosingUnit })}
                        options={(item ? subUnitsOf(item.unit) : ['unite' as const]).map((u) => ({
                          value: u, label: UNIT_LABEL[u],
                        }))}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setLines((l) => l.filter((x) => x.key !== line.key))}
                      aria-label="Retirer cette ligne"
                      className="mb-[13px] flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] text-ink-400 transition-colors hover:bg-critique-pale hover:text-critique"
                    >
                      <IconClose size={16} />
                    </button>
                  </div>
                );
              })}

              <Button size="compact" onClick={addLine}>Ajouter un article</Button>

              {declared.length > 0 && version && (
                <p className="text-[12px] leading-relaxed text-ink-500">
                  Ce constat remplace la déduction de la recette : c'est lui qui sortira du stock.
                </p>
              )}
            </Card>
          )}
        </div>

        <div>
          <span className="mb-1.5 block text-[13px] font-medium text-ink-700">Pertes de préparation</span>
          <div className="grid grid-cols-3 gap-2">
            {[0, 3].map((v) => (
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
                ![0, 3].includes(loss)
                  ? 'border-2 border-brun bg-sable-pale text-cafe'
                  : 'border border-ink-200 bg-surface text-ink-700',
              )}
            >
              Écart ({Math.max(0, planned - produced)})
            </button>
          </div>
        </div>

        {/* Ce que le système déduit tout seul — affiché avant validation, pas après. */}
        {consumption.length > 0 && (
          <div>
            <div className="derived">
              <SectionLabel className="mb-2">Sortira du stock</SectionLabel>
            </div>
            <Card padded={false} className="px-4 py-1">
              {consumption.map((line) => {
                const item = items.get(line.itemId);
                if (!item) return null;
                return (
                  <div
                    key={`${line.itemId}-${line.unit}`}
                    className="flex items-center justify-between border-b border-ink-100 py-2.5 last:border-0"
                  >
                    <span className="text-[14px] text-ink-700">{item.name}</span>
                    <span className="num text-[14px] text-ink-900">
                      −{formatQty(line.quantity, line.unit)}
                    </span>
                  </div>
                );
              })}
            </Card>
          </div>
        )}

        {routed.planned != null && (
          <div className="flex items-center justify-between rounded-[6px] bg-sable-pale px-4 py-3">
            <span className="text-[14px] text-cafe">Rendement</span>
            <span className="num text-[16px] text-cafe">
              {yieldPct} %{produced < planned ? ` · −${planned - produced} unités` : ''}
            </span>
          </div>
        )}

        <SelectField
          label="Où le rangez-vous ?"
          value={locationId}
          onChange={setLocationId}
          options={LOCATIONS.map((l) => ({ value: l.id, label: l.name }))}
          hint="C'est de là que la vente le déduira."
        />

        {version && (
          <p className="px-1 text-[12px] leading-relaxed text-ink-500">
            {product?.name ?? recipe?.name} · recette v{version.version} figée. Le lot conservera cette
            version même si la recette évolue demain.
          </p>
        )}

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
                ? "Impossible de dire combien d'unités sont possibles."
                : `Les matières en stock permettent ${feasible.units} unité${feasible.units > 1 ? 's' : ''}.`}{' '}
              Vous pouvez enregistrer quand même — le stock passera en négatif et
              l'écart devra être expliqué.
            </p>
          </Card>
        ) : (
          consumption.length > 0 && !feasible.unknown && (
            <p className="derived px-1 text-[12px] text-ink-500">
              Matières suffisantes — {feasible.units} unité{feasible.units > 1 ? 's' : ''} possibles
              {feasible.limitingName !== '—' && `, ${feasible.limitingName} limite`}.
            </p>
          )
        )}

        {/*
          Rien de sorti, rien de déduit. On le dit franchement plutôt que
          d'afficher un coût de zéro, qui se lirait comme une marge parfaite.
        */}
        {consumption.length === 0 && produced > 0 && (
          <p className="px-1 text-[12px] leading-relaxed text-ink-500">
            Sans recette ni constat de sortie, la préparation ajoute {produced} unité
            {produced > 1 ? 's' : ''} au stock sans en déduire de matières. Le coût de ce lot
            restera inconnu jusqu'au comptage.
          </p>
        )}
      </main>

      <div className="action-bar rail-bar bottom-0 z-20 border-t border-ink-200 bg-ivoire/95 backdrop-blur">
        <Button variant="primary" size="counter" full onClick={submit} disabled={produced <= 0 || !product}>
          {produced <= 0 ? 'Indiquez la quantité préparée' : `Enregistrer ${produced} unité${produced > 1 ? 's' : ''}`}
        </Button>
      </div>
    </div>
  );
}
