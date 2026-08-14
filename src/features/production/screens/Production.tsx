import { useNavigate } from 'react-router-dom';
import { useBuna, RECIPE_VERSIONS } from '../../../store/BunaStore';
import { formatQty } from '../../../domain/units';
import { isMadeToOrder } from '../../../domain/types';
import { feasibleUnits as feasible } from '../../../domain/production';
import { stockHealth } from '../../../domain/stock';
import { SyncIndicator } from '../../../design-system/components/SyncIndicator';
import { ActionRow, HEALTH_TONE } from '../../../design-system/components/patterns';
import { Badge, Button, Card, SectionLabel } from '../../../design-system/components/primitives';
import { IconClose } from '../../../design-system/icons';

/**
 * Production du jour — « ce qui reste à produire, et les matières qui vont
 * manquer avant la fin du service ». Le besoin est calculé, pas saisi.
 */
export function Production() {
  const { state, items, stockOf, dismissFromList, dismissedIn, restoreList } = useBuna();
  const navigate = useNavigate();

  const dismissed = dismissedIn('PRODUCTION');
  /* Ce qu'il y a à préparer, c'est ce qui se prépare D'AVANCE. Une boisson
     montée à la commande n'a rien à faire dans une liste de production : elle
     se prépare quand le client la demande, pas le matin. */
  const finished = state.items.filter(
    (i) => i.kind === 'FINISHED' && !isMadeToOrder(i) && i.targetStock && !dismissed.has(i.id),
  );

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
            <Card key={product.id} className="relative flex flex-col gap-3">
              {/* Écarter pour aujourd'hui : le besoin est calculé, pas saisi —
                  il n'y a rien à supprimer, seulement à remettre à demain. */}
              <button
                type="button"
                onClick={() => dismissFromList('PRODUCTION', product.id)}
                title={`Écarter ${product.name} de la production du jour`}
                aria-label={`Écarter ${product.name} de la production du jour`}
                className="group absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-[6px] text-ink-400 transition-colors hover:bg-critique-pale hover:text-critique"
              >
                <IconClose size={16} className="transition-transform duration-150 motion-safe:group-hover:rotate-90" />
              </button>

              <div className="flex items-start justify-between gap-3 pr-10">
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

        {dismissed.size > 0 && (
          <button
            type="button"
            onClick={() => restoreList('PRODUCTION')}
            className="w-full rounded-[6px] border border-ink-200 bg-surface px-3 py-2.5 text-[13px] text-ink-600 transition-colors hover:border-ink-300 hover:text-cafe"
          >
            {dismissed.size} produit{dismissed.size > 1 ? 's' : ''} écarté{dismissed.size > 1 ? 's' : ''} aujourd'hui · tout remettre
          </button>
        )}

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
