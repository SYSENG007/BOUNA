import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useBuna, LOC } from '../../store/BunaStore';
import { useCart } from '../CartContext';
import { fcfa, fcfaFull } from '../../domain/money';
import { SyncIndicator } from '../../design-system/components/SyncIndicator';
import { BunaMark } from '../../design-system/components/primitives';
import { ProductImage } from '../../design-system/components/ProductImage';
import { IconCart } from '../../design-system/icons';

/**
 * Écran de vente — la grille EST l'écran principal.
 * Un appui ajoute une unité, un appui long en retire une.
 * Objectif PRD : vente standard en moins de 10 s, 3 à 5 interactions.
 */
export function Pos() {
  const { state, user, stockOf } = useBuna();
  const { cart, add, remove, count, total } = useCart();
  const navigate = useNavigate();

  const products = state.items.filter((i) => i.kind === 'FINISHED');
  const openedAt = new Date(state.cashSession.openedAt);

  /* Appui long = −1 : pas d'écran intermédiaire pour corriger une erreur. */
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  const startPress = (id: string) => {
    longPressTimer = setTimeout(() => {
      remove(id);
      longPressTimer = null;
      if ('vibrate' in navigator) navigator.vibrate?.(12);
    }, 450);
  };
  const endPress = (id: string) => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
      add(id);
    }
  };

  return (
    <div className="flex min-h-full flex-1 flex-col bg-ivoire">
      <SyncIndicator />

      <header className="flex items-center gap-3 px-4 pb-3 pt-4">
        <div className="min-w-0 flex-1">
          <h1 className="t-h1 text-cafe">
            Bonjour {user?.name.split(' ')[0]}
          </h1>
          <p className="truncate text-[12px] text-ink-500">
            Shift #{state.cashSession.shiftNumber} ouvert depuis{' '}
            {openedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} · Coffee Bar Auchan
          </p>
        </div>
        <BunaMark size={38} />
      </header>

      <main className="flex-1 px-3 pb-40">
        <div className="grid grid-cols-2 gap-2.5">
          {products.map((p) => {
            const qty = cart[p.id] ?? 0;
            const available = stockOf(p.id, LOC.POS);
            const out = available <= 0;
            return (
              <button
                key={p.id}
                disabled={out}
                onPointerDown={() => !out && startPress(p.id)}
                onPointerUp={() => !out && endPress(p.id)}
                onPointerLeave={() => { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; } }}
                onContextMenu={(e) => e.preventDefault()}
                className={clsx(
                  'no-select relative flex min-h-[128px] flex-col justify-between rounded-[8px] border p-3 text-left transition-colors',
                  out
                    ? 'border-ink-200 bg-ink-100 opacity-60'
                    : qty > 0
                      ? 'border-brun bg-sable-pale'
                      : 'border-ink-200 bg-surface active:bg-sable-pale',
                )}
                style={{ boxShadow: qty > 0 ? 'var(--shadow-e1)' : undefined }}
              >
                {qty > 0 && (
                  <span className="num absolute right-2.5 top-2.5 flex h-8 min-w-8 items-center justify-center rounded-full bg-cafe px-2 text-[15px] text-sable-pale">
                    {qty}
                  </span>
                )}
                <div className="flex items-start gap-2.5">
                  <ProductImage src={p.imageUrl} name={p.name} size="sm" />
                  <span className="text-[14.5px] font-medium leading-tight text-ink-900">{p.name}</span>
                </div>
                <div>
                  <div className="t-figure text-[19px] text-cafe">{fcfa(p.price ?? 0)}</div>
                  <div className="text-[11px] text-ink-500">
                    {out ? 'Rupture' : `${Math.floor(available)} dispo`}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        <p className="mt-4 px-1 text-center text-[12px] text-ink-400">
          Un appui = +1 · appui long = −1
        </p>
      </main>

      {/* Panier flottant : le total est toujours visible, l'action toujours à portée de pouce. */}
      {count > 0 && (
        <div className="safe-b fixed inset-x-0 bottom-[58px] z-20 px-3 pb-2">
          <button
            onClick={() => navigate('/vendre/panier')}
            className="no-select flex min-h-[56px] w-full items-center justify-between gap-3 rounded-[8px] bg-cafe px-5 text-sable-pale"
            style={{ boxShadow: 'var(--shadow-e2)' }}
          >
            <span className="flex items-center gap-2 text-[15px] font-medium">
              <IconCart size={19} />
              Panier · {count}
            </span>
            <span className="num text-[18px]">{fcfaFull(total)}</span>
          </button>
        </div>
      )}
    </div>
  );
}
