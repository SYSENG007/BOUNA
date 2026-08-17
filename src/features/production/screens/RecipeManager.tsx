import { useState } from 'react';
import { useBuna } from '../../../store/BunaStore';
import { isUuid, uuid } from '../../../domain/ids';
import type { Recipe, RecipeIngredient, RecipeVersion, Item } from '../../../domain/types';
import { RECIPES, RECIPE_VERSIONS } from '../../../store/referentials';
import { UNIT_LABEL } from '../../../domain/types';
import type { DosingUnit, Unit } from '../../../domain/types';
import { convert, formatDose, storageUnit, subUnitsOf } from '../../../domain/units';
import { observedRecipe } from '../../../domain/production';
import { SyncIndicator } from '../../../design-system/components/SyncIndicator';
import { ScreenHeader } from '../../../design-system/components/patterns';
import { Button, Card, Field, SelectField } from '../../../design-system/components/primitives';

/** Le nombre exact tel qu'il partira en base, sans zéros inutiles. */
function formatStored(quantity: number): string {
  return quantity.toFixed(5).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');
}

export function RecipeManager() {
  const { state, saveRecipe } = useBuna();
  const [editing, setEditing] = useState<Recipe | 'new' | null>(null);

  /*
   * Les recettes que les lots ont déjà écrites.
   *
   * Chaque fois qu'un préparateur note ce qu'il a sorti, il décrit une recette
   * sans le savoir. Au bout de quelques lots, la moyenne devient une
   * proposition sérieuse — et c'est la seule rampe entre les deux régimes qui
   * ne demande pas une soirée de saisie. Sans elle, le suivi simple serait un
   * cul-de-sac confortable.
   *
   * On ne propose que pour les produits qui n'ont PAS encore de recette : on
   * ne vient pas contredire ce que quelqu'un a délibérément écrit.
   */
  const proposals = state.items
    .filter((i) => i.kind === 'FINISHED' && !i.archived && !RECIPES.some((r) => r.itemId === i.id))
    .map((item) => ({ item, observed: observedRecipe(item.id, state.batches, state.movements) }))
    .filter((p): p is { item: Item; observed: NonNullable<ReturnType<typeof observedRecipe>> } =>
      p.observed !== null);

  if (editing) {
    const version = editing === 'new' 
      ? null 
      : RECIPE_VERSIONS.find(v => v.id === editing.currentVersionId) || null;
      
    return (
      <EditRecipe 
        recipe={editing} 
        currentVersion={version}
        items={state.items}
        onSave={saveRecipe} 
        onClose={() => setEditing(null)} 
      />
    );
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-ivoire">
      <SyncIndicator />
      <ScreenHeader
        title="Recettes"
        subtitle={`${RECIPES.length} recette(s)`}
        action={<Button variant="secondary" onClick={() => setEditing('new')}>+ Recette</Button>}
      />

      <main className="flex-1 space-y-2 p-4">
        {proposals.map(({ item, observed }) => (
          <Card key={item.id} className="space-y-2.5 border border-brun/40 bg-sable-pale">
            <div className="text-[15px] font-medium text-cafe">
              Vos préparations décrivent déjà « {item.name} »
            </div>
            <p className="text-[13px] leading-relaxed text-ink-700">
              {observed.batches} lot{observed.batches > 1 ? 's' : ''} · {observed.produced} unité
              {observed.produced > 1 ? 's' : ''} produite{observed.produced > 1 ? 's' : ''}. Voici ce
              qui est sorti, en moyenne, pour une unité :
            </p>
            {/* Ce que le système déduit — le filet doré, jamais sur une saisie. */}
            <div className="derived">
              <ul className="space-y-1">
                {observed.doses.map((dose) => {
                  const ingredient = state.items.find((i) => i.id === dose.itemId);
                  return (
                    <li key={`${dose.itemId}-${dose.unit}`} className="num text-[13px] text-ink-700">
                      {ingredient?.name ?? 'Article'} — {formatDose(dose.quantity, dose.unit)}
                      {dose.spread > 0.25 && (
                        <span className="text-or-ink"> · dosage irrégulier d'un lot à l'autre</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
            <p className="text-[12px] leading-relaxed text-ink-500">
              C'est une moyenne, pas une mesure : relisez-la avant de la figer. Une fois
              enregistrée, elle déduira la consommation de chaque préparation.
            </p>
            <Button variant="primary" size="compact" onClick={() => setEditing('new')}>
              Écrire la recette
            </Button>
          </Card>
        ))}

        {RECIPES.map((recipe) => {
          const version = RECIPE_VERSIONS.find(v => v.id === recipe.currentVersionId);
          const item = state.items.find(i => i.id === recipe.itemId);
          
          return (
            <Card
              key={recipe.id}
              onClick={() => setEditing(recipe)}
              className="flex cursor-pointer items-center justify-between transition-colors hover:bg-sable-pale"
            >
              <div>
                <div className="text-[15px] font-medium text-ink-900">{recipe.name}</div>
                <div className="text-[12px] text-ink-500">
                  Produit : {item?.name ?? 'Inconnu'} · {version?.ingredients.length ?? 0} ingrédient(s)
                </div>
              </div>
              <div className="text-[18px] text-ink-300">›</div>
            </Card>
          );
        })}
      </main>
    </div>
  );
}

function EditRecipe({
  recipe,
  currentVersion,
  items,
  onSave,
  onClose,
}: {
  recipe: Recipe | 'new';
  currentVersion: RecipeVersion | null;
  items: Item[];
  onSave: (recipe: Recipe, version: RecipeVersion) => void;
  onClose: () => void;
}) {
  const isNew = recipe === 'new';
  const [name, setName] = useState(isNew ? '' : recipe.name);
  const [itemId, setItemId] = useState(isNew ? '' : recipe.itemId);
  const [ingredients, setIngredients] = useState<RecipeIngredient[]>(currentVersion?.ingredients || []);

  const [newIngredientId, setNewIngredientId] = useState('');
  const [newIngredientQty, setNewIngredientQty] = useState('');
  /*
   * L'unité de la ligne, distincte de celle de l'article.
   *
   * Le cacao s'achète au kilo, il se dose au gramme. La ligne reprenait
   * l'unité d'achat sans le dire, donc « 50 » voulait dire cinquante kilos de
   * cacao pour une tasse. On écrit maintenant la sous-unité à côté du nombre,
   * et `convert()` fait le reste — la recette reste comparable au stock.
   */
  const [newIngredientUnit, setNewIngredientUnit] = useState<DosingUnit | ''>('');

  const producibleItems = items.filter(i => (i.kind === 'FINISHED' || i.kind === 'INTERMEDIATE') && !i.archived);
  const rawItems = items.filter(i => i.kind !== 'FINISHED' && !i.archived);

  const canSave = name.trim().length > 0 && itemId !== '' && ingredients.length > 0;

  /* L'article choisi commande les unités proposées : on ne dose pas un liquide
     en grammes, et proposer l'inverse ne ferait qu'inviter à l'erreur. */
  const newIngredientItem = items.find((i) => i.id === newIngredientId);
  const unitChoices = newIngredientItem ? subUnitsOf(newIngredientItem.unit) : [];
  const effectiveUnit: DosingUnit | '' =
    newIngredientUnit && unitChoices.includes(newIngredientUnit)
      ? newIngredientUnit
      : newIngredientItem?.unit ?? '';

  const pickIngredient = (id: string) => {
    setNewIngredientId(id);
    /* On repart de l'unité de l'article : garder « g » en passant du cacao au
       lait proposerait une masse pour un volume. */
    setNewIngredientUnit('');
  };

  const handleAddIngredient = () => {
    if (!newIngredientId || !newIngredientQty || !effectiveUnit) return;
    const qty = Number(newIngredientQty);
    if (qty <= 0) return;

    const targetItem = items.find(i => i.id === newIngredientId);
    if (!targetItem) return;

    /*
     * On convertit ici, pas plus tard, et vers l'unité la plus fine que la
     * base sache écrire. Seul le milligramme lui est inconnu : il devient des
     * grammes. Tout ramener à l'unité de l'article aurait été plus net, mais
     * `quantity` n'a que quatre décimales — 1 mg en kilos y vaut zéro, et une
     * quantité nulle est refusée par la contrainte.
     */
    const stored = storageUnit(effectiveUnit);
    setIngredients([
      ...ingredients,
      {
        itemId: newIngredientId,
        quantity: convert(qty, effectiveUnit, stored),
        unit: stored,
      },
    ]);
    setNewIngredientId('');
    setNewIngredientQty('');
    setNewIngredientUnit('');
  };

  const handleRemoveIngredient = (id: string) => {
    setIngredients(ingredients.filter(i => i.itemId !== id));
  };

  const handleSave = () => {
    if (!canSave) return;
    
    // Always create a new version when saving to avoid mutating frozen versions
    const nextVersionNum = currentVersion ? currentVersion.version + 1 : 1;
    /*
     * Des UUID nus : la base les attend ainsi. Une recette d'avant ce
     * changement porte une clé préfixée que PostgreSQL refuse — on lui en
     * donne une neuve, elle n'a jamais eu de contrepartie serveur à préserver.
     */
    const versionId = uuid();
    const recipeId = isNew || !isUuid(recipe.id) ? uuid() : recipe.id;
    
    const newVersion: RecipeVersion = {
      id: versionId,
      recipeId,
      version: nextVersionNum,
      frozen: false,
      ingredients,
    };
    
    const newRecipe: Recipe = isNew
      ? { id: recipeId, itemId, name: name.trim(), currentVersionId: versionId }
      : { ...recipe, itemId, name: name.trim(), currentVersionId: versionId };
      
    onSave(newRecipe, newVersion);
    onClose();
  };

  return (
    <div className="flex min-h-full flex-1 flex-col bg-ivoire">
      <ScreenHeader
        title={isNew ? 'Nouvelle recette' : 'Modifier la recette'}
        onBack={onClose}
      />

      <main className="flex-1 space-y-4 p-4">
        <Card className="space-y-4">
          <Field 
            label="Nom de la recette"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex: Sirop de Fraise (Maison)"
            className="buna-input"
            autoFocus
          />

          <SelectField 
            label="Produit Résultant (Livrable)"
            value={itemId}
            onChange={(v) => setItemId(v)}
            options={[
              { value: '', label: 'Choisir un produit...' },
              ...producibleItems.map((i) => ({ value: i.id, label: `${i.name} (${UNIT_LABEL[i.unit]})` }))
            ]}
          />
        </Card>

        <Card className="space-y-4">
          <div className="text-[14px] font-medium text-ink-900">Ingrédients</div>
          
          <div className="space-y-2">
            {ingredients.map(ing => {
              const item = items.find(i => i.id === ing.itemId);
              return (
                <div key={ing.itemId} className="flex items-center justify-between border-b border-ink-100 pb-2">
                  <div className="text-[14px]">
                    <span className="font-medium">{item?.name ?? 'Inconnu'}</span>
                    {/* Enregistré dans l'unité de l'article, relu dans celle
                        où on l'a saisi : 0,005 L se lit « 5 mL ». */}
                    <span className="text-ink-500 ml-2">{formatDose(ing.quantity, ing.unit)}</span>
                  </div>
                  <button 
                    onClick={() => handleRemoveIngredient(ing.itemId)}
                    className="p-2 text-critique text-[18px]"
                  >
                    ×
                  </button>
                </div>
              );
            })}
            
            {ingredients.length === 0 && (
              <div className="text-[13px] text-ink-500 py-2">Aucun ingrédient défini.</div>
            )}
          </div>

          <div className="mt-4 pt-4 border-t border-ink-100 space-y-3">
            <div className="text-[13px] font-medium text-ink-700">Ajouter un ingrédient</div>
            
            <SelectField
              label=""
              value={newIngredientId}
              onChange={pickIngredient}
              options={[
                { value: '', label: 'Choisir l\'ingrédient...' },
                ...rawItems.filter(i => !ingredients.some(ing => ing.itemId === i.id)).map((i) => ({ value: i.id, label: i.name }))
              ]}
            />

            <div className="flex items-start gap-2">
              <div className="flex-1">
                <Field
                  label=""
                  type="number"
                  value={newIngredientQty}
                  onChange={(e) => setNewIngredientQty(e.target.value)}
                  placeholder="Quantité"
                  className="buna-input"
                  inputMode="decimal"
                  step="any"
                />
              </div>
              {/* L'unité se choisit à côté du nombre, jamais après coup. */}
              <div className="w-[104px] shrink-0">
                <SelectField
                  label=""
                  value={effectiveUnit}
                  onChange={(v) => setNewIngredientUnit(v as Unit)}
                  options={
                    unitChoices.length
                      ? unitChoices.map((u) => ({ value: u, label: UNIT_LABEL[u] }))
                      : [{ value: '', label: '—' }]
                  }
                />
              </div>
              <Button
                variant="secondary"
                className="min-h-[50px] shrink-0"
                disabled={!newIngredientId || !newIngredientQty || !effectiveUnit}
                onClick={handleAddIngredient}
              >
                Ajouter
              </Button>
            </div>

            {/* Ce que ça fera au stock, dit dans l'unité de l'article — le
                filet doré marque la déduction, pas la saisie. */}
            {/* On ne le dit que quand l'unité change vraiment à l'écriture —
                le milligramme, seul absent de la base. Répéter « 5 mL = 5 mL »
                n'apprendrait rien à personne. */}
            {effectiveUnit && Number(newIngredientQty) > 0
              && storageUnit(effectiveUnit) !== effectiveUnit && (
              <p className="derived text-[12px] text-ink-500">
                Enregistré comme {formatStored(
                  convert(Number(newIngredientQty), effectiveUnit, storageUnit(effectiveUnit)),
                )} {UNIT_LABEL[storageUnit(effectiveUnit)]} — la même quantité, dans l'unité
                que la base sait écrire.
              </p>
            )}
          </div>
        </Card>
      </main>

      <footer className="safe-b sticky bottom-0 border-t border-ink-200 bg-ivoire/95 p-4 backdrop-blur">
        <Button full disabled={!canSave} onClick={handleSave}>
          Enregistrer la recette
        </Button>
      </footer>
    </div>
  );
}
