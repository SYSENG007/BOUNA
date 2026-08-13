import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useBuna, LOC } from '../../store/BunaStore';
import { useCart } from '../CartContext';
import { fcfa, fcfaFull } from '../../domain/money';
import { SyncIndicator } from '../../design-system/components/SyncIndicator';
import { BunaLogo } from '../../design-system/components/BunaLogo';
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
        <BunaLogo size={42} />
      </header>

      <main className="flex-1 px-3 pb-40">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
          {products.map((p) => {
            const qty = cart[p.id] ?? 0;
            const available = stockOf(p.id, LOC.POS);
            const out = available <= 0;
            return (
              <div
                key={p.id}
                role="button"
                tabIndex={out ? -1 : 0}
                aria-disabled={out}
                onClick={() => !out && add(p.id)}
                className={clsx(
                  'no-select relative flex min-h-[128px] flex-col justify-between rounded-[8px] border p-3 text-left transition-all duration-200',
                  out
                    ? 'border-ink-200 bg-ink-100 opacity-60'
                    : qty > 0
                      ? 'border-brun bg-sable-pale ring-1 ring-brun/30'
                      : 'border-ink-200 bg-surface active:scale-[0.98] hover:border-ink-300',
                )}
                style={{ boxShadow: qty > 0 ? 'var(--shadow-e1)' : undefined }}
              >
                <div className="flex items-start gap-2.5">
                  <ProductImage src={p.imageUrl} name={p.name} size="sm" />
                  <span className="text-[14.5px] font-medium leading-tight text-ink-900">{p.name}</span>
                </div>
                
                <div className="flex items-end justify-between">
                  <div>
                    <div className="t-figure text-[19px] text-cafe">{fcfa(p.price ?? 0)}</div>
                    <div className="text-[11px] text-ink-500">
                      {out ? 'Rupture' : `${Math.floor(available)} dispo`}
                    </div>
                  </div>
                  
                  {/* Explicit Stepper when active, replacing the vague long-press UX */}
                  {qty > 0 && (
                    <div className="flex items-center gap-2 rounded-full bg-surface shadow-sm border border-brun/20 px-1 py-1" onClick={(e) => e.stopPropagation()}>
                      <button 
                        className="flex h-7 w-7 items-center justify-center rounded-full bg-ink-100 text-cafe active:bg-ink-200 transition-colors"
                        onClick={() => remove(p.id)}
                      >
                        <span className="text-lg leading-none mb-[2px]">−</span>
                      </button>
                      <span className="num min-w-[16px] text-center text-[15px] font-medium text-cafe">{qty}</span>
                      <button 
                        className="flex h-7 w-7 items-center justify-center rounded-full bg-cafe text-sable-pale active:bg-cafe-soft transition-colors"
                        onClick={() => add(p.id)}
                      >
                        <span className="text-lg leading-none mb-[2px]">+</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </main>

      {/* Panier flottant : le total est toujours visible, l'action toujours à portée de pouce. */}
      {count > 0 && (
        <div className="safe-b rail-bar z-30 pb-2" style={{ bottom: 'var(--tabbar-h)' }}>
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
