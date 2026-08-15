import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBuna } from '../../../store/BunaStore';
import { fcfa, fcfaFull } from '../../../domain/money';
import {
  breakdownBySource, isCostly, openVariances, recoveredCost, resolutionsFor, RESOLUTION_LABEL,
  unresolvedAmount, VARIANCE_SOURCE_LABEL, type Resolution, type Variance,
} from '../../../domain/variance';
import { ScreenHeader } from '../../../design-system/components/patterns';
import { ActorStamp } from '../../../design-system/components/ActorStamp';
import { Badge, Button, Card, Field, SectionLabel } from '../../../design-system/components/primitives';
import { VarianceBar } from '../../../design-system/charts';

/**
 * Écarts et recouvrements.
 *
 * Un écart constaté n'est pas une information, c'est une question ouverte.
 * Cet écran est l'endroit où quelqu'un y répond — et où la réponse est datée
 * et signée. Un écart soldé « erreur de saisie » ne coûte rien ; soldé
 * « perte » ou « vol », il coûte, et le tableau de bord le compte.
 */
export function Ecarts() {
  const { variances, resolveVariance } = useBuna();
  const navigate = useNavigate();
  const [active, setActive] = useState<Variance | null>(null);

  const open = openVariances(variances);
  const resolved = variances.filter((v) => v.resolution !== null);
  const breakdown = breakdownBySource(variances).filter((b) => b.open > 0 || b.resolved > 0);
  const maxDelta = Math.max(1, ...open.map((v) => Math.abs(v.delta)));

  return (
    <div className="flex min-h-full flex-1 flex-col bg-ivoire">
      <ScreenHeader
        title="Écarts"
        subtitle={open.length ? `${open.length} à expliquer` : 'Tout est soldé'}
        onBack={() => navigate(-1)}
      />

      <main className="flex-1 space-y-5 px-4 pb-28 pt-4">
        {open.length === 0 && resolved.length === 0 ? (
          <Card>
            <p className="text-[14px] leading-relaxed text-ink-600">
              Aucun écart constaté. Ils apparaissent ici dès qu'un comptage, une clôture de
              caisse ou un rendement de préparation ne tombe pas sur ce que le système déduisait.
            </p>
          </Card>
        ) : (
          <>
            <Card className="derived space-y-2">
              <SectionLabel>Reste à expliquer</SectionLabel>
              <div className="num text-[34px] leading-none text-ink-900">{fcfaFull(unresolvedAmount(variances))}</div>
              <p className="text-[12.5px] leading-relaxed text-ink-500">
                FCFA en attente d'un motif. Les écarts déjà soldés ont coûté{' '}
                <strong className="num text-ink-700">{fcfa(recoveredCost(variances))} FCFA</strong> —
                une erreur de saisie corrigée ne coûte rien.
              </p>
            </Card>

            {breakdown.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {breakdown.map((b) => (
                  <Card key={b.source} className="flex flex-col gap-1">
                    <div className="label-section">{VARIANCE_SOURCE_LABEL[b.source]}</div>
                    <div className="num text-[19px] leading-none text-ink-900">{b.open}</div>
                    <div className="text-[11.5px] text-ink-500">
                      {b.open > 0 ? `${fcfa(b.openAmount)} FCFA` : 'rien d\'ouvert'}
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}

        {open.length > 0 && (
          <section className="space-y-2">
            <SectionLabel>Ouverts</SectionLabel>
            {open.map((v) => (
              <Card key={v.id} className="space-y-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[15px] font-medium text-ink-900">{v.subject}</span>
                  <Badge tone="info">{VARIANCE_SOURCE_LABEL[v.source]}</Badge>
                </div>
                <div className="derived space-y-1.5">
                  <div className="flex justify-between text-[12.5px] text-ink-500">
                    <span>Déduit <span className="num text-ink-700">{v.theoretical.toFixed(2)}</span></span>
                    <span>Déclaré <span className="num text-ink-700">{v.declared.toFixed(2)}</span></span>
                  </div>
                  <VarianceBar value={v.delta} max={maxDelta} format={(n) => n.toFixed(2)} />
                  <div className="text-[12.5px] text-ink-600">
                    Valorisé <strong className="num text-ink-900">{fcfa(v.amount)} FCFA</strong>
                  </div>
                </div>
                <ActorStamp actor={v.actor} showCapability />
                <Button full onClick={() => setActive(v)}>
                  {v.source === 'DEBT' ? 'Marquer remboursé' : 'Donner un motif'}
                </Button>
              </Card>
            ))}
          </section>
        )}

        {resolved.length > 0 && (
          <section className="space-y-2">
            <SectionLabel>Soldés</SectionLabel>
            <Card padded={false}>
              {resolved.slice(0, 12).map((v) => (
                <div key={v.id} className="border-b border-ink-100 px-4 py-3 last:border-b-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-[14px] text-ink-900">{v.subject}</span>
                    <Badge tone={v.resolution && isCostly(v.resolution) ? 'critique' : 'conforme'}>
                      {v.resolution ? RESOLUTION_LABEL[v.resolution] : '—'}
                    </Badge>
                  </div>
                  <div className="text-[12.5px] text-ink-500">
                    {fcfa(v.amount)} FCFA · {VARIANCE_SOURCE_LABEL[v.source].toLowerCase()}
                    {v.resolutionNote ? ` · ${v.resolutionNote}` : ''}
                  </div>
                  {v.resolver && <ActorStamp actor={v.resolver} className="mt-1" />}
                </div>
              ))}
            </Card>
          </section>
        )}
      </main>

      {active && (
        <ResolveSheet
          variance={active}
          onClose={() => setActive(null)}
          onResolve={(resolution, note) => {
            resolveVariance(active.id, resolution, note);
            setActive(null);
          }}
        />
      )}
    </div>
  );
}

function ResolveSheet({
  variance, onClose, onResolve,
}: {
  variance: Variance;
  onClose: () => void;
  onResolve: (resolution: Resolution, note?: string) => void;
}) {
  const [choice, setChoice] = useState<Resolution | null>(null);
  const [note, setNote] = useState('');
  const isDebt = variance.source === 'DEBT';
  const options = resolutionsFor(variance.source);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <button type="button" aria-label="Fermer" onClick={onClose} className="absolute inset-0 bg-cafe/45" />
      <div className="safe-b relative w-full max-w-md rounded-t-[16px] bg-ivoire p-4 sm:rounded-[16px]"
        style={{ boxShadow: 'var(--shadow-e2)' }}>
        <h2 className="font-display text-[20px] leading-tight text-cafe">
          {isDebt ? 'Cette dette est-elle remboursée ?' : "Que s'est-il passé ?"}
        </h2>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-600">
          {variance.subject} ·{' '}
          {isDebt ? 'montant dû' : 'écart de'}{' '}
          <strong className="num text-ink-900">{fcfa(variance.amount)} FCFA</strong>.
          {isDebt
            ? ' Elle reste ouverte tant que personne ne confirme le remboursement.'
            : " Le motif décide si cet écart coûte de l'argent ou non."}
        </p>

        <div className="mt-4 space-y-2">
          {options.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setChoice(r)}
              className={`flex min-h-[var(--spacing-touch)] w-full items-center justify-between rounded-[6px] border px-3.5 text-left text-[14px] transition-colors ${
                choice === r
                  ? 'border-cafe bg-sable-pale text-ink-900'
                  : 'border-ink-200 bg-surface text-ink-700 hover:bg-sable-pale/40'
              }`}
            >
              {RESOLUTION_LABEL[r]}
              {isCostly(r) && <span className="text-[11.5px] text-critique">coûte</span>}
            </button>
          ))}
        </div>

        <div className="mt-3">
          <Field
            label="Précision (facultatif)"
            value={note}
            onChange={(e) => setNote(e.currentTarget.value)}
            placeholder="Ce que vous avez constaté"
          />
        </div>

        <div className="mt-4 flex gap-2">
          <Button full onClick={onClose}>Annuler</Button>
          <Button
            full
            variant="primary"
            disabled={!choice}
            onClick={() => choice && onResolve(choice, note.trim() || undefined)}
          >
            {isDebt ? 'Confirmer le remboursement' : "Solder l'écart"}
          </Button>
        </div>
      </div>
    </div>
  );
}
