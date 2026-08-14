import { useNavigate } from 'react-router-dom';
import { useBuna, RECIPE_VERSIONS } from '../../../store/BunaStore';
import { formatQty } from '../../../domain/units';
import { feasibleUnits as feasible } from '../../../domain/production';
import { stockHealth } from '../../../domain/stock';
import { SyncIndicator } from '../../../design-system/components/SyncIndicator';
import { ActionRow, HEALTH_TONE } from '../../../design-system/components/patterns';
import { Badge, Button, Card, SectionLabel } from '../../../design-system/components/primitives';

/**
 * Production du jour — « ce qui reste à produire, et les matières qui vont
 * manquer avant la fin du service ». Le besoin est calculé, pas saisi.
 */
export function Production() {
  const { state, items, stockOf } = useBuna();
  const navigate = useNavigate();

  const finished = state.items.filter((i) => i.kind === 'FINISHED' && i.targetStock);

  /* Même calcul que l'écran de déclaration : une seule source de vérité. */
  const feasibleUnits = (recipeVersionId: string) => {
    const version = RECIPE_VERSIONS.find((v) => v.id === recipeVersionId);
    if (!version) return { units: 0, limitingName: '—', unknown: true };
    return feasible(version.ingredients, (id) => items.get(id), (id) => stockOf(id));
  };

  const criticalItems = state.items
    .filter((i) => i.kind === 'RAW_MATERIAL' || i.kind === 'PACKAGING')
    .map((i) => ({ item: i, qty: stockOf(i.id), health: stockHealth(stockOf(i.id), i) }))
    .filter((r) => r.health !== 'OK');

  return (
    <div className="flex min-h-full flex-1 flex-col bg-ivoire">
      <SyncIndicator />

      <header className="px-4 pb-3 pt-4">
        <h1 className="t-h1 text-cafe">Production du jour</h1>
        <p className="text-[12px] text-ink-500">
          Cuisine ·{' '}
          {new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}
        </p>
      </header>

      <main className="flex-1 space-y-3 px-4 pb-28">
        {finished.map((product) => {
          /* Même lecture que le comptoir : sinon l'écran réclame indéfiniment une
             production qui a déjà eu lieu, rangée ailleurs. */
          const available = stockOf(product.id);
          const target = product.targetStock ?? 0;
          const toProduce = Math.max(0, Math.ceil(target - available));
          const recipe = RECIPE_VERSIONS.find(
            (v) => v.recipeId === (product.id === 'it-vanilla' ? 'rc-vanilla' : 'rc-caramel'),
          );
          const done = toProduce === 0;
          const feasible = recipe ? feasibleUnits(recipe.id) : null;

          return (
            <Card key={product.id} className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[16px] font-medium text-ink-900">{product.name}</div>
                  <div className="num mt-0.5 text-[12px] text-ink-500">
                    Disponible {Math.floor(available)} · cible {target}
                  </div>
                </div>
                {done ? (
                  <Badge tone="conforme">Terminé</Badge>
                ) : (
                  <Badge tone="surveiller">{toProduce} à produire</Badge>
                )}
              </div>

              {/* Barre d'avancement : lisible d'un regard, doublée du chiffre. */}
              <div className="h-1.5 overflow-hidden rounded-full bg-ink-100">
                <div
                  className={done ? 'h-full bg-conforme' : 'h-full bg-brun'}
                  style={{ width: `${Math.min(100, target ? (available / target) * 100 : 0)}%` }}
                />
              </div>

              {!done && recipe && feasible && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[12px] text-ink-500">
                    {feasible.units >= toProduce
                      ? `Matières suffisantes (${feasible.units} possibles)`
                      : `Seulement ${feasible.units} possibles · ${feasible.limitingName} limite`}
                  </span>
                  <Button
                    variant="primary"
                    size="compact"
                    onClick={() =>
                      navigate('/production/preparation', {
                        state: { itemId: product.id, planned: toProduce, recipeVersionId: recipe.id },
                      })
                    }
                  >
                    Lancer {Math.min(toProduce, feasible.units) || toProduce}
                  </Button>
                </div>
              )}
            </Card>
          );
        })}

        {criticalItems.length > 0 && (
          <>
            <SectionLabel className="pt-3">Matières critiques</SectionLabel>
            <Card padded={false}>
              {criticalItems.map(({ item, qty, health }) => (
                <ActionRow
                  key={item.id}
                  title={item.name}
                  detail={`${formatQty(qty, item.unit)} restants · minimum ${formatQty(item.minimumStock ?? 0, item.unit)}`}
                  tone={HEALTH_TONE[health]}
                  actionLabel="Signaler à l'approvisionnement"
                  onClick={() => navigate('/appro')}
                />
              ))}
            </Card>
          </>
        )}
      </main>

      <div className="safe-b rail-bar z-30 pb-2" style={{ bottom: 'var(--tabbar-h)' }}>
        <Button variant="primary" size="counter" full onClick={() => navigate('/production/preparation')}>
          Déclarer un batch
        </Button>
      </div>
    </div>
  );
}
