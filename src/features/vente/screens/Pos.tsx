import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useBuna } from '../../../store/BunaStore';
import { useCart } from '../CartContext';
import { fcfa, fcfaFull } from '../../../domain/money';
import { SyncIndicator } from '../../../design-system/components/SyncIndicator';
import { ProductImage } from '../../../design-system/components/ProductImage';
import { Button } from '../../../design-system/components/primitives';
import { IconCart, IconClose } from '../../../design-system/icons';
import { ErrorBoundary } from '../../../shell/ErrorBoundary';
import { isMadeToOrder } from '../../../domain/types';
import type { Item, UUID } from '../../../domain/types';

/**
 * Écran de vente — la grille EST l'écran principal.
 * Un appui ajoute une unité, un appui long en retire une.
 * Objectif PRD : vente standard en moins de 10 s, 3 à 5 interactions.
 */
export function Pos() {
  const { state, user, stockOf, can, policy } = useBuna();
  const { cart, add, remove, count, total } = useCart();
  const navigate = useNavigate();

  const openedAt = new Date(state.cashSession.openedAt);
  const cashOpen = !state.cashSession.closedAt;

  /*
   * Pas de vente sans caisse ouverte.
   *
   * L'écart de caisse se mesure entre un fond déclaré à l'ouverture et un
   * comptage à la clôture. Encaisser hors shift produit des ventes que rien ne
   * rattache à un tiroir : à la clôture, l'attendu ne veut plus rien dire et
   * l'écart n'est plus imputable à personne. Mieux vaut bloquer trente secondes
   * que de rendre la journée irréconciliable.
   */
  if (!cashOpen) return <CaisseFermee canOpen={can('MANAGE_CASH_SESSION')} />;

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

        {/*
          La seule sortie du mode boutique, et elle est explicite.
          Pendant un service, la navigation est masquée pour qu'on ne la quitte
          pas par erreur entre deux clients : il faut donc un geste nommé pour
          en sortir, et son libellé dit exactement ce qu'il fait.
        */}
        <button
          type="button"
          onClick={() => navigate('/')}
          className="group flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-[6px] border border-ink-200 bg-surface px-3 text-[12.5px] font-medium text-ink-600 transition-colors hover:border-ink-300 hover:text-cafe"
        >
          <IconClose
            size={15}
            className="transition-transform duration-150 motion-safe:group-hover:rotate-90"
          />
          Sortir de la boutique
        </button>
      </header>

      <main className="flex-1 px-3 pb-40">
        {/*
          Limite étroite autour de la seule grille. Un article de catalogue mal
          formé — un prix absent d'un type inattendu, une image impossible à
          résoudre — ne doit pas emporter l'encaissement : le panier flottant et
          son total sont rendus en dehors de cette limite, donc une vente
          commencée peut toujours être terminée pendant que la grille est à
          terre.

          La grille est un composant à part entière, et pas une boucle écrite
          ici : ce qui plante dans un `.map()` posé dans le rendu de `Pos`
          plante dans `Pos`, hors de portée de cette limite. Seul un enfant
          rendu par React est protégé par la limite qui l'entoure.
        */}
        <ErrorBoundary
          zone="grille de vente"
          fallback={(retry) => <GrilleIndisponible onRetry={retry} />}
        >
          <ProductGrid
            items={state.items}
            cart={cart}
            stockOf={stockOf}
            onAdd={add}
            onRemove={remove}
            blockWithoutStock={policy.saleBlockedWithoutStock}
          />
        </ErrorBoundary>
      </main>

      {/* Panier flottant : le total est toujours visible, l'action toujours à portée de pouce. */}
      {count > 0 && (
        <div className="safe-b rail-bar z-30 pb-2" style={{ bottom: 'var(--tabbar-h)' }}>
          <button
            onClick={() => navigate('/vente/panier')}
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

/**
 * Caisse fermée — l'écran de vente refuse d'ouvrir.
 *
 * Le message nomme la cause et l'action, dans cet ordre. Il ne dit pas
 * « erreur » : rien n'est cassé, il manque simplement un geste, et ce geste
 * n'appartient pas forcément à la personne qui lit.
 */
function CaisseFermee({ canOpen }: { canOpen: boolean }) {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-full flex-1 flex-col bg-ivoire">
      <SyncIndicator />

      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md space-y-4 text-center">
          <h1 className="font-display text-[24px] leading-tight text-cafe">
            La caisse est fermée
          </h1>
          <p className="text-[14px] leading-relaxed text-ink-600">
            {canOpen
              ? "Comptez le fond de caisse et ouvrez le shift : c'est lui qui sert de référence à l'écart, au moment de clôturer."
              : "Un responsable doit ouvrir la caisse avant la première vente. Sans shift ouvert, l'argent encaissé ne pourrait être rattaché à aucun tiroir."}
          </p>

          <div className="flex flex-col gap-2.5 pt-2">
            {canOpen && (
              <Button variant="primary" size="counter" full onClick={() => navigate('/finance/caisse')}>
                Ouvrir la caisse
              </Button>
            )}
            <Button full onClick={() => navigate('/')}>Sortir de la boutique</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProductGrid({
  items, cart, stockOf, onAdd, onRemove, blockWithoutStock,
}: {
  items: Item[];
  cart: Record<UUID, number>;
  stockOf: (itemId: UUID) => number;
  onAdd: (id: UUID) => void;
  onRemove: (id: UUID) => void;
  /**
   * Le manque de stock refuse-t-il la vente ?
   *
   * En suivi simple, non. Le stock d'un produit fini y est une DÉCLARATION —
   * « j'ai préparé quarante cafés » — pas un compte tenu à l'unité près.
   * Refuser d'encaisser parce qu'une déclaration du matin est épuisée
   * reviendrait à refuser le seul chiffre que l'établissement connaisse
   * vraiment : sa vente. Le négatif qui en résulte n'est pas une erreur, c'est
   * la question que le comptage du soir posera.
   */
  blockWithoutStock: boolean;
}) {
  const products = items.filter((i) => i.kind === 'FINISHED');

  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
      {products.map((p) => {
        const qty = cart[p.id] ?? 0;
        /* Le stock vendable, c'est tout ce qui est sur le site — pas seulement ce
           qui a été rangé au comptoir. Lire LOC.POS seul affichait « rupture »
           sur un produit dont il restait vingt unités au frigo. */
        const available = stockOf(p.id);
        /* Un produit monté à la commande n'a pas de stock de produit fini :
           le déclarer en rupture parce qu'il vaut zéro rendrait la carte
           invendable en permanence. Sa disponibilité tient aux ingrédients. */
        const toOrder = isMadeToOrder(p);
        const empty = !toOrder && available <= 0;
        const out = empty && blockWithoutStock;
        /* Le plafond s'applique à CHAQUE ajout, pas seulement au premier :
           `out` ne protégeait que l'appui initial — rien n'empêchait ensuite
           le bouton « + » du stepper de dépasser indéfiniment le disponible.
           Aucun produit du catalogue actuel n'est en BATCH (tous sont « à la
           commande »), donc ce plafond est dormant aujourd'hui — mais il
           redevient actif dès qu'un produit fini stocké réapparaît. */
        const atCeiling = blockWithoutStock && !toOrder && qty >= available;
        return (
          <div
            key={p.id}
            role="button"
            tabIndex={out ? -1 : 0}
            aria-disabled={out}
            onClick={() => !out && !atCeiling && onAdd(p.id)}
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
                {/* Le chiffre reste affiché même quand il ne bloque plus : il
                    informe le vendeur au lieu de lui interdire. En dessous de
                    zéro, il dit « on a vendu plus que déclaré » — une question
                    pour le soir, pas un refus au comptoir. */}
                <div className={clsx('text-[11px]', empty ? 'text-or-ink' : 'text-ink-500')}>
                  {toOrder
                    ? 'À la commande'
                    : out
                      ? 'Rupture'
                      : available <= 0
                        ? 'Plus rien de déclaré'
                        : `${Math.floor(available)} dispo`}
                </div>
              </div>

              {/* Explicit Stepper when active, replacing the vague long-press UX */}
              {qty > 0 && (
                <div className="flex items-center gap-2 rounded-full bg-surface shadow-sm border border-brun/20 px-1 py-1" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-ink-100 text-cafe active:bg-ink-200 transition-colors"
                    onClick={() => onRemove(p.id)}
                  >
                    <span className="text-lg leading-none mb-[2px]">−</span>
                  </button>
                  <span className="num min-w-[16px] text-center text-[15px] font-medium text-cafe">{qty}</span>
                  <button
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-cafe text-sable-pale transition-colors active:bg-cafe-soft disabled:opacity-40"
                    onClick={() => onAdd(p.id)}
                    disabled={atCeiling}
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
  );
}

/**
 * Repli de la grille. Il reste dans le flux de l'écran : ni pleine page, ni
 * modale. Le panier et le total gardent leur place sous les yeux, ce qui est
 * précisément la promesse — la vente en cours n'est pas interrompue.
 */
function GrilleIndisponible({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-[8px] border border-ink-200 bg-surface px-4 py-6 text-center">
      <h2 className="font-display text-[19px] leading-tight text-cafe">
        Les produits ne s'affichent plus
      </h2>
      <p className="mx-auto mt-2 max-w-sm text-[14px] leading-relaxed text-ink-600">
        Un article du catalogue empêche la grille de s'afficher. Votre panier et l'encaissement
        fonctionnent toujours : vous pouvez terminer la vente en cours.
      </p>
      <div className="mt-4 flex justify-center">
        <Button variant="primary" size="counter" onClick={onRetry}>
          Réafficher les produits
        </Button>
      </div>
      <p className="mt-3 text-[13px] text-ink-500">
        Si la grille reste vide, vérifiez vos articles depuis le catalogue.
      </p>
    </div>
  );
}
