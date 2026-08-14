import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useBuna, SUPPLIERS } from '../../../store/BunaStore';
import { replenishmentNeed, stockHealth } from '../../../domain/stock';
import { formatQty } from '../../../domain/units';
import { fcfaFull } from '../../../domain/money';
import { SyncIndicator } from '../../../design-system/components/SyncIndicator';
import { Button, Card, EmptyState, SectionLabel } from '../../../design-system/components/primitives';

/**
 * Liste de courses (§14).
 * Chaque ligne porte : stock actuel, cible, quantité recommandée, dernier prix,
 * fournisseur habituel. L'approvisionneur coche pendant ses courses.
 */
export function Replenishment() {
  const { state, stockOf, can } = useBuna();
  const navigate = useNavigate();
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const rows = useMemo(() => {
    return state.items
      .filter((i) => i.kind !== 'FINISHED' && i.targetStock)
      .map((item) => {
        const qty = stockOf(item.id);
        return {
          item,
          qty,
          need: replenishmentNeed(qty, item),
          health: stockHealth(qty, item),
          supplier: SUPPLIERS.find((s) => s.id === item.preferredSupplierId),
        };
      })
      .filter((r) => r.need > 0)
      .sort((a, b) => {
        const order = { RUPTURE: 0, CRITIQUE: 1, SURVEILLER: 2, OK: 3 };
        return order[a.health] - order[b.health];
      });
  }, [state.items, stockOf]);

  const urgent = rows.filter((r) => r.health === 'CRITIQUE' || r.health === 'RUPTURE');
  const planned = rows.filter((r) => r.health === 'SURVEILLER' || r.health === 'OK');

  const selected = rows.filter((r) => checked[r.item.id]);
  const estimated = selected.reduce((sum, r) => sum + r.need * (r.item.weightedAvgCost ?? 0), 0);

  /* La commande reprend ce qui est coché : article, quantité manquante et
     dernier prix connu, modifiables ensuite ligne par ligne. */
  const openPurchase = () =>
    navigate('/appro/commande', {
      state: {
        lines: selected.map((r) => ({
          itemId: r.item.id,
          quantity: Math.ceil(r.need),
          unitPrice: Math.round(r.item.weightedAvgCost ?? 0),
        })),
        supplierId: selected[0]?.supplier?.id,
      },
    });

  const renderGroup = (title: string, group: typeof rows) =>
    group.length > 0 && (
      <>
        <SectionLabel className="pt-2">{title}</SectionLabel>
        <Card padded={false}>
          {group.map(({ item, qty, need, supplier }) => (
            <button
              key={item.id}
              onClick={() => setChecked((c) => ({ ...c, [item.id]: !c[item.id] }))}
              className="flex w-full min-h-[72px] items-center gap-3 border-b border-ink-100 px-4 py-3 text-left transition-colors last:border-0 active:bg-sable-pale"
            >
              <span
                className={clsx(
                  'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center self-start rounded-[4px] border text-[13px]',
                  checked[item.id]
                    ? 'border-conforme bg-conforme text-white'
                    : 'border-ink-300 bg-surface',
                )}
              >
                {checked[item.id] ? '✓' : ''}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={clsx(
                    'block text-[15px] font-medium',
                    checked[item.id] ? 'text-ink-400 line-through' : 'text-ink-900',
                  )}
                >
                  {item.name} — acheter {formatQty(need, item.unit)}
                </span>
                <span className="num block text-[12px] text-ink-500">
                  stock {formatQty(qty, item.unit)} · cible {formatQty(item.targetStock ?? 0, item.unit)} ·
                  dernier prix {fcfaFull(item.weightedAvgCost ?? 0)}
                </span>
                {supplier && (
                  <span className="block text-[12px] text-ink-500">{supplier.name}</span>
                )}
              </span>
            </button>
          ))}
        </Card>
      </>
    );

  return (
    <div className="flex min-h-full flex-1 flex-col bg-ivoire">
      <SyncIndicator />

      <header className="flex items-start justify-between gap-3 px-4 pb-3 pt-4">
        <div>
          <h1 className="t-h1 text-cafe">À acheter</h1>
          <p className="text-[12px] text-ink-500">Besoins calculés depuis les seuils et le stock réel</p>
        </div>
        {/* Créer un ingrédient ou corriger son coût vivait dans Pilotage, à
            trois écrans d'ici. L'approvisionneur qui découvre un produit chez
            son fournisseur en a besoin MAINTENANT, pas après avoir traversé
            l'application. */}
        {can('MANAGE_CATALOG') && (
          <Button variant="secondary" size="compact" onClick={() => navigate('/pilotage/catalogue')}>
            Gérer les articles
          </Button>
        )}
      </header>

      <main className="flex-1 space-y-3 px-4 pb-32">
        {rows.length === 0 ? (
          <EmptyState
            title="Rien à acheter"
            body="Tous les articles sont au-dessus de leur stock cible. Rien ne presse."
          />
        ) : (
          <>
            {renderGroup('Urgent', urgent)}
            {renderGroup('À prévoir', planned)}
          </>
        )}
      </main>

      {/* La barre est toujours là. Elle ne dépendait que du coût estimé : un
          article sans coût connu donnait zéro, la barre disparaissait, et il
          devenait impossible d'acheter précisément ce qu'on n'avait jamais
          acheté. On peut aussi partir de rien et composer sa commande. */}
      <div className="safe-b rail-bar z-30 pb-2" style={{ bottom: 'var(--tabbar-h)' }}>
        <Button variant="primary" size="counter" full onClick={openPurchase}>
          {selected.length === 0
            ? 'Composer un achat'
            : estimated > 0
              ? `Enregistrer l'achat — ~${fcfaFull(estimated)}`
              : `Enregistrer l'achat — ${selected.length} article${selected.length > 1 ? 's' : ''}`}
        </Button>
      </div>
    </div>
  );
}
