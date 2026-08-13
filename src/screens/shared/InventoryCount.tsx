import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useBuna, LOCATIONS } from '../../store/BunaStore';
import { formatQty } from '../../domain/units';
import { fcfaFull } from '../../domain/money';
import { UNIT_LABEL, WASTE_LABEL, type WasteReason } from '../../domain/types';
import { ScreenHeader } from '../../design-system/components/patterns';
import {
  Button, Card, Field, SectionLabel, SelectField,
} from '../../design-system/components/primitives';

const REASONS: WasteReason[] = ['CASSE', 'PERIME', 'SURDOSAGE', 'INVENDU', 'INCONNU'];

/**
 * Inventaire (§24).
 * Le théorique reste masqué tant que l'utilisateur n'a pas saisi son comptage :
 * sinon on ne compte pas, on recopie. L'écart n'écrase jamais le stock — il
 * produit un mouvement d'ajustement motivé.
 */
export function InventoryCount() {
  const { state, adjustStock, stockOf } = useBuna();
  const navigate = useNavigate();

  const [locationId, setLocationId] = useState(LOCATIONS[0].id);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, WasteReason>>({});
  const [revealed, setRevealed] = useState(false);

  const items = state.items.filter((i) => !i.archived && stockOf(i.id, locationId) > 0);

  const rows = items.map((item) => {
    const theoretical = stockOf(item.id, locationId);
    const raw = counts[item.id];
    const counted = raw === undefined || raw === '' ? null : Number(raw);
    const delta = counted === null ? null : counted - theoretical;
    return { item, theoretical, counted, delta };
  });

  const entered = rows.filter((r) => r.counted !== null);
  const withGap = entered.filter((r) => Math.abs(r.delta ?? 0) > 0.0001);
  const missingReason = withGap.filter((r) => !reasons[r.item.id]);
  const lossValue = withGap.reduce(
    (sum, r) => sum + Math.min(0, r.delta ?? 0) * (r.item.weightedAvgCost ?? 0),
    0,
  );

  const submit = () => {
    for (const row of withGap) {
      adjustStock({
        itemId: row.item.id,
        locationId,
        countedQuantity: row.counted!,
        reason: WASTE_LABEL[reasons[row.item.id]],
      });
    }
    navigate('/stock', { replace: true });
  };

  return (
    <div className="flex min-h-full flex-1 flex-col bg-ivoire">
      <ScreenHeader
        title="Inventaire"
        subtitle={revealed ? 'Écarts constatés' : 'Comptez, puis comparez'}
        onBack={() => (revealed ? setRevealed(false) : navigate(-1))}
      />

      <main className="flex-1 space-y-4 px-4 pb-32 pt-4">
        {!revealed ? (
          <>
            <SelectField
              label="Emplacement"
              value={locationId}
              onChange={(v) => { setLocationId(v); setCounts({}); }}
              options={LOCATIONS.map((l) => ({ value: l.id, label: l.name }))}
            />

            <p className="t-small text-ink-600">
              Saisissez ce que vous comptez réellement. Le stock théorique reste masqué
              jusqu'à la comparaison.
            </p>

            <div className="space-y-2.5">
              {rows.map(({ item }) => (
                <Field
                  key={item.id}
                  label={item.name}
                  type="number"
                  inputMode="decimal"
                  placeholder="—"
                  suffix={UNIT_LABEL[item.unit]}
                  value={counts[item.id] ?? ''}
                  onChange={(e) => setCounts((c) => ({ ...c, [item.id]: e.target.value }))}
                />
              ))}
            </div>
          </>
        ) : (
          <>
            {withGap.length === 0 ? (
              <Card className="space-y-2">
                <SectionLabel>Résultat</SectionLabel>
                <p className="t-body text-conforme-deep">
                  Aucun écart. Le stock théorique correspond au comptage — rien à ajuster.
                </p>
              </Card>
            ) : (
              <>
                <p className="t-small text-ink-600">
                  {withGap.length} écart{withGap.length > 1 ? 's' : ''} constaté
                  {withGap.length > 1 ? 's' : ''}. Chacun demande un motif avant validation.
                </p>

                {withGap.map(({ item, theoretical, counted, delta }) => (
                  <Card key={item.id} className="space-y-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="t-h3 text-ink-900">{item.name}</span>
                      <span className={clsx('num text-[17px]', delta! < 0 ? 'text-critique' : 'text-conforme-deep')}>
                        {delta! > 0 ? '+' : ''}{formatQty(delta!, item.unit)}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3 border-t border-ink-100 pt-2.5 text-center">
                      <div>
                        <div className="num text-[15px] text-ink-900">{formatQty(theoretical, item.unit)}</div>
                        <div className="text-[11px] text-ink-500">Théorique</div>
                      </div>
                      <div>
                        <div className="num text-[15px] text-ink-900">{formatQty(counted!, item.unit)}</div>
                        <div className="text-[11px] text-ink-500">Compté</div>
                      </div>
                    </div>

                    <div>
                      <SectionLabel className="mb-1.5">Motif</SectionLabel>
                      <div className="flex flex-wrap gap-2">
                        {REASONS.map((r) => (
                          <button
                            key={r}
                            onClick={() => setReasons((x) => ({ ...x, [item.id]: r }))}
                            className={clsx(
                              'no-select min-h-[38px] rounded-[6px] px-3 text-[13px] transition-colors',
                              reasons[item.id] === r
                                ? 'border-2 border-brun bg-sable-pale text-cafe'
                                : 'border border-ink-200 bg-surface text-ink-700',
                            )}
                          >
                            {WASTE_LABEL[r]}
                          </button>
                        ))}
                      </div>
                    </div>
                  </Card>
                ))}

                {lossValue < 0 && (
                  <div className="derived">
                    <SectionLabel className="mb-1">Valeur de l'écart</SectionLabel>
                    <p className="t-small text-ink-600">
                      {fcfaFull(Math.abs(lossValue))} de matière manquante, imputée en perte au
                      moment de la validation.
                    </p>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </main>

      <div className="safe-b rail-bar bottom-0 z-20 border-t border-ink-200 bg-ivoire/95 py-3 backdrop-blur">
        {!revealed ? (
          <Button
            variant="primary"
            size="counter"
            full
            disabled={entered.length === 0}
            onClick={() => setRevealed(true)}
          >
            {entered.length === 0
              ? 'Saisissez au moins un comptage'
              : `Comparer ${entered.length} comptage${entered.length > 1 ? 's' : ''}`}
          </Button>
        ) : (
          <Button
            variant="primary"
            size="counter"
            full
            disabled={missingReason.length > 0}
            onClick={submit}
          >
            {missingReason.length > 0
              ? `${missingReason.length} motif${missingReason.length > 1 ? 's' : ''} manquant${missingReason.length > 1 ? 's' : ''}`
              : withGap.length === 0
                ? 'Terminer l’inventaire'
                : `Valider ${withGap.length} ajustement${withGap.length > 1 ? 's' : ''}`}
          </Button>
        )}
      </div>
    </div>
  );
}
