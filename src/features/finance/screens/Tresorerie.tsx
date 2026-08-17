import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBuna } from '../../../store/BunaStore';
import { fcfa, fcfaFull } from '../../../domain/money';
import { cashFlowReport, cashPositions, upcomingOutflow } from '../../../domain/cashflow';
import { replenishmentNeed } from '../../../domain/stock';
import { formatQty } from '../../../domain/units';
import { useCashFlowInput } from '../../pilotage/useAnalytics';
import { SyncIndicator } from '../../../design-system/components/SyncIndicator';
import { Badge, Card, SectionLabel } from '../../../design-system/components/primitives';
import { BarSeries, HBars, Sparkline } from '../../../design-system/charts';

/**
 * Trésorerie — l'argent réellement entré et sorti.
 *
 * À ne pas confondre avec la marge : une journée peut être rentable et vider
 * la caisse. C'est cet écran qui répond à « est-ce qu'on peut payer le laitier
 * demain matin, en espèces ? » — d'où la ventilation par moyen de paiement,
 * qui n'est pas un détail comptable mais la question elle-même.
 */
export function Tresorerie() {
  const { state, stockOf } = useBuna();
  const navigate = useNavigate();
  const input = useCashFlowInput();
  const now = Date.now();

  const report = useMemo(() => cashFlowReport(input, now, 14), [input, now]);
  const positions = cashPositions(report);

  /* Ce que le réapprovisionnement va coûter : une trésorerie confortable qui
   * ne couvre pas la liste de courses de demain n'est pas confortable. */
  const upcoming = useMemo(() => {
    const needs = state.items
      .filter((i) => i.targetStock !== undefined)
      .map((i) => ({
        itemId: i.id,
        name: i.name,
        quantity: replenishmentNeed(stockOf(i.id), i),
        unitCost: i.weightedAvgCost,
        unit: i.unit,
      }))
      .filter((n) => n.quantity > 0);
    return { ...upcomingOutflow(needs), needs };
  }, [state.items, stockOf]);

  const covered = report.closingBalance - upcoming.total;

  return (
    <div className="flex-1 bg-shell">
      <div className="lg:hidden"><SyncIndicator /></div>

      <div className="mx-auto max-w-4xl px-4 py-6 lg:px-10 lg:py-10">
        <header className="mb-6">
          <h1 className="t-h1 text-cafe lg:text-[38px] lg:leading-[44px]">Trésorerie</h1>
          <p className="text-[13px] text-ink-500">Quatorze derniers jours · ce qui entre, ce qui sort, ce qui reste</p>
        </header>

        <Card className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="label-section">Disponible aujourd'hui</div>
              <div className="num text-[38px] leading-none text-ink-900">{fcfaFull(report.closingBalance)}</div>
              <div className="text-[12px] text-ink-500">
                FCFA · départ {fcfa(report.openingBalance)} · net {report.net >= 0 ? '+' : ''}{fcfa(report.net)}
              </div>
            </div>
            <Sparkline
              points={report.points.map((p) => p.balance)}
              width={120}
              height={36}
              tone={report.net >= 0 ? 'conforme' : 'critique'}
            />
          </div>

          <div className="derived border-t border-ink-100 pt-3 text-[13.5px] leading-relaxed text-ink-700">
            {report.runway.hasData ? (
              <>
                Au rythme de sortie constaté, la trésorerie tient{' '}
                <strong className="num text-ink-900">{report.runway.value} jour{report.runway.value > 1 ? 's' : ''}</strong>.
                {report.averageBurn.hasData && (
                  <> Sortie moyenne : {fcfa(report.averageBurn.value)} FCFA par jour ouvré.</>
                )}
              </>
            ) : (
              <>Aucune sortie enregistrée sur la période : l'autonomie ne se calcule pas.</>
            )}
            {report.negativeDays > 0 && (
              <> {report.negativeDays} journée{report.negativeDays > 1 ? 's ont' : ' a'} consommé de la trésorerie.</>
            )}
          </div>
        </Card>

        <section className="mt-6">
          <SectionLabel className="mb-2">Entrées et sorties par jour</SectionLabel>
          <Card>
            <BarSeries
              data={report.points.map((p) => ({
                label: p.period.label,
                value: p.flow.hasData ? p.flow.value.inflow : null,
                compare: p.flow.hasData ? p.flow.value.outflow : null,
              }))}
              format={(n) => `${fcfa(n)} FCFA`}
              label="Encaissements et paiements par jour"
            />
            <p className="mt-3 text-[12px] leading-relaxed text-ink-500">
              La barre pleine est ce qui est entré, l'ombre derrière est ce qui est sorti.
              Une journée hachurée n'a rien reçu de saisi.
            </p>
          </Card>
        </section>

        <section className="mt-6">
          <SectionLabel className="mb-2">Où est l'argent</SectionLabel>
          <Card className="space-y-4">
            {positions.length === 0 ? (
              <p className="text-[13.5px] text-ink-500">Aucun mouvement d'argent sur la période.</p>
            ) : (
              <>
                <HBars
                  rows={positions.map((p) => ({
                    label: p.label,
                    value: Math.max(0, p.balance),
                    tone: p.balance < 0 ? 'critique' : 'cafe',
                    right: `${fcfa(p.balance)} FCFA`,
                  }))}
                />
                <div className="space-y-1.5 border-t border-ink-100 pt-3">
                  {positions.map((p) => (
                    <div key={p.method} className="flex items-baseline justify-between gap-3 text-[12.5px] text-ink-500">
                      <span>{p.label}</span>
                      <span className="num">
                        +{fcfa(p.in)} entré · −{fcfa(p.out)} sorti
                      </span>
                    </div>
                  ))}
                </div>
                <p className="text-[12px] leading-relaxed text-ink-500">
                  Les espèces sont dans le tiroir, le mobile money est sur un compte.
                  Un total global ne dit pas avec quoi on peut payer.
                </p>
              </>
            )}
          </Card>
        </section>

        <section className="mt-6">
          <div className="mb-2 flex items-center justify-between">
            <SectionLabel>Ce qui va sortir</SectionLabel>
            <button
              type="button"
              onClick={() => navigate('/appro')}
              className="text-[12.5px] text-brun underline-offset-2 hover:underline"
            >
              Liste de courses
            </button>
          </div>
          <Card className="space-y-3">
            {upcoming.lines.length === 0 ? (
              <p className="text-[13.5px] text-ink-500">
                Aucun article sous son seuil : rien à racheter dans l'immédiat.
              </p>
            ) : (
              <>
                <div className="derived">
                  <div className="text-[13.5px] leading-relaxed text-ink-700">
                    Le réapprovisionnement coûtera environ{' '}
                    <strong className="num text-ink-900">{fcfaFull(upcoming.total)}</strong>,
                    estimé au coût moyen pondéré.
                  </div>
                  <div className="mt-1">
                    <Badge tone={covered >= 0 ? 'conforme' : 'critique'}>
                      {covered >= 0
                        ? `Couvert · il resterait ${fcfa(covered)} FCFA`
                        : `Découvert de ${fcfa(Math.abs(covered))} FCFA`}
                    </Badge>
                  </div>
                </div>
                {upcoming.incomplete && (
                  <p className="text-[12px] leading-relaxed text-surveiller">
                    Certains articles n'ont pas de coût connu : l'estimation est partielle,
                    la dépense réelle sera plus élevée.
                  </p>
                )}
                <HBars
                  rows={upcoming.lines.slice(0, 6).map((l) => {
                    const need = upcoming.needs.find((n) => n.itemId === l.itemId);
                    return {
                      label: l.name,
                      value: l.estimatedCost,
                      tone: 'info' as const,
                      right: `${need ? formatQty(l.quantity, need.unit) : l.quantity} · ${fcfa(l.estimatedCost)}`,
                    };
                  })}
                />
              </>
            )}
          </Card>
        </section>
      </div>
    </div>
  );
}
