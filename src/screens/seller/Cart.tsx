import { useNavigate } from 'react-router-dom';
import { useCart } from '../CartContext';
import { fcfa, fcfaFull } from '../../domain/money';
import { ScreenHeader } from '../../design-system/components/patterns';
import { Button, EmptyState } from '../../design-system/components/primitives';

/** Panier — récapitulatif ajustable sans quitter le flux. */
export function Cart() {
  const { lines, count, total, add, remove } = useCart();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-full flex-1 flex-col bg-ivoire">
      <ScreenHeader title="Votre panier" onBack={() => navigate('/vendre')} />

      {lines.length === 0 ? (
        <EmptyState
          title="Panier vide"
          body="Retournez à la grille et appuyez sur un produit pour commencer la vente."
          action={<Button variant="primary" onClick={() => navigate('/vendre')}>Retour à la grille</Button>}
        />
      ) : (
        <>
          <main className="flex-1 px-4 pb-40 pt-3">
            <div className="divide-y divide-ink-100 rounded-[8px] border border-ink-200 bg-surface">
              {lines.map(({ item, quantity }) => (
                <div key={item.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-medium text-ink-900">{item.name}</div>
                    <div className="num text-[12px] text-ink-500">
                      {fcfa(item.price ?? 0)} × {quantity}
                    </div>
                  </div>
                  <div className="num w-20 shrink-0 text-right text-[15px] text-ink-900">
                    {fcfa(quantity * (item.price ?? 0))}
                  </div>
                  <div className="flex shrink-0 items-center overflow-hidden rounded-[6px] border border-ink-200">
                    <button
                      onClick={() => remove(item.id)}
                      aria-label={`Retirer un ${item.name}`}
                      className="no-select h-11 w-11 text-[19px] text-cafe active:bg-sable-pale"
                    >−</button>
                    <span className="num w-8 text-center text-[15px]">{quantity}</span>
                    <button
                      onClick={() => add(item.id)}
                      aria-label={`Ajouter un ${item.name}`}
                      className="no-select h-11 w-11 text-[19px] text-cafe active:bg-sable-pale"
                    >+</button>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-[8px] border border-ink-200 bg-surface px-4 py-2">
              <div className="flex items-center justify-between py-2 text-[14px]">
                <span className="text-ink-600">Articles</span>
                <span className="num text-ink-900">{count}</span>
              </div>
              <div className="flex items-center justify-between border-t border-ink-100 py-3">
                <span className="text-[15px] font-semibold text-ink-900">Total</span>
                <span className="num text-[22px] text-cafe">{fcfaFull(total)}</span>
              </div>
            </div>
          </main>

          <div className="safe-b fixed inset-x-0 bottom-0 z-20 border-t border-ink-200 bg-ivoire/95 px-4 py-3 backdrop-blur">
            <Button variant="primary" size="counter" full onClick={() => navigate('/vendre/encaissement')}>
              Encaisser {fcfaFull(total)}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
