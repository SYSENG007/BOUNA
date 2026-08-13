import { useState } from 'react';
import { useBuna } from '../../store/BunaStore';
import { uuid } from '../../domain/ids';
import type { Recipe, RecipeIngredient, RecipeVersion, Item } from '../../domain/types';
import { RECIPES, RECIPE_VERSIONS } from '../../store/referentials';
import { UNIT_LABEL } from '../../domain/types';
import { SyncIndicator } from '../../design-system/components/SyncIndicator';
import { ScreenHeader } from '../../design-system/components/patterns';
import { Button, Card, Field } from '../../design-system/components/primitives';

export function RecipeManager() {
  const { state, saveRecipe } = useBuna();
  const [editing, setEditing] = useState<Recipe | 'new' | null>(null);

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

  const producibleItems = items.filter(i => (i.kind === 'FINISHED' || i.kind === 'INTERMEDIATE') && !i.archived);
  const rawItems = items.filter(i => i.kind !== 'FINISHED' && !i.archived);

  const canSave = name.trim().length > 0 && itemId !== '' && ingredients.length > 0;

  const handleAddIngredient = () => {
    if (!newIngredientId || !newIngredientQty) return;
    const qty = Number(newIngredientQty);
    if (qty <= 0) return;
    
    const targetItem = items.find(i => i.id === newIngredientId);
    if (!targetItem) return;

    setIngredients([
      ...ingredients,
      { itemId: newIngredientId, quantity: qty, unit: targetItem.unit }
    ]);
    setNewIngredientId('');
    setNewIngredientQty('');
  };

  const handleRemoveIngredient = (id: string) => {
    setIngredients(ingredients.filter(i => i.itemId !== id));
  };

  const handleSave = () => {
    if (!canSave) return;
    
    // Always create a new version when saving to avoid mutating frozen versions
    const nextVersionNum = currentVersion ? currentVersion.version + 1 : 1;
    const versionId = `rv-${uuid()}`;
    const recipeId = isNew ? `r-${uuid()}` : recipe.id;
    
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
          <Field label="Nom de la recette">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Sirop de Fraise (Maison)"
              className="buna-input"
              autoFocus
            />
          </Field>

          <Field label="Produit Résultant (Livrable)">
            <select
              value={itemId}
              onChange={(e) => setItemId(e.target.value)}
              className="buna-input bg-white"
            >
              <option value="" disabled>Choisir un produit...</option>
              {producibleItems.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({UNIT_LABEL[i.unit]})
                </option>
              ))}
            </select>
          </Field>
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
                    <span className="text-ink-500 ml-2">{ing.quantity} {UNIT_LABEL[ing.unit]}</span>
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
            
            <select
              value={newIngredientId}
              onChange={(e) => setNewIngredientId(e.target.value)}
              className="buna-input bg-white"
            >
              <option value="" disabled>Choisir l'ingrédient...</option>
              {rawItems.filter(i => !ingredients.some(ing => ing.itemId === i.id)).map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>

            <div className="flex gap-2">
              <input
                type="number"
                value={newIngredientQty}
                onChange={(e) => setNewIngredientQty(e.target.value)}
                placeholder="Quantité"
                className="buna-input flex-1"
                inputMode="decimal"
              />
              <Button 
                variant="secondary"
                disabled={!newIngredientId || !newIngredientQty} 
                onClick={handleAddIngredient}
              >
                Ajouter
              </Button>
            </div>
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
