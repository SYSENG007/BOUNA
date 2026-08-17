import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useBuna, LOCATIONS } from '../../../store/BunaStore';
import {
  CLOSING_STEPS, CLOSING_STEP_LABEL, businessDateOf, cashCountView, closingProgress, expensesView,
  finalValidationView, reconcilableMethods, salesReconciliationView, stockVarianceView,
  type ClosingStepId, type StockCountEntry,
} from '../../../domain/closing';
import { PAYMENT_LABEL, WASTE_LABEL, type PaymentMethod, type WasteReason } from '../../../domain/types';
import { coherenceFindings, type CoherenceFinding } from '../../../domain/coherence';
import { fcfa, fcfaFull } from '../../../domain/money';
import { formatQty } from '../../../domain/units';
import { ScreenHeader } from '../../../design-system/components/patterns';
import {
  Badge, Button, Card, Field, SectionLabel,
} from '../../../design-system/components/primitives';
import { IconCheck } from '../../../design-system/icons';

const REASONS: WasteReason[] = ['CASSE', 'PERIME', 'SURDOSAGE', 'INVENDU', 'INCONNU'];

const num = (raw: string) => Number(raw.replace(',', '.'));
const filled = (raw: string) => raw.trim() !== '' && Number.isFinite(num(raw));

/**
 * La clôture de journée — cinq étapes, une seule discipline.
 *
 * Le moteur (`domain/closing.ts`) existait depuis longtemps, testé, et
 * n'était importé par aucun écran : la caisse tenait sa propre logique
 * simplifiée à côté. C'est ce qui manquait pour que le suivi simple mesure
 * quelque chose — sans comptage du soir, il ne fait que ne plus bloquer.
 *
 * La règle qui gouverne l'écran : **on déclare avant de voir**. L'attendu de
 * caisse, le total système, le stock théorique restent absents tant que la
 * personne n'a pas donné son chiffre — et absents du TYPE, pas seulement de
 * l'affichage (`Reveal<T>`), pour qu'aucune inattention ne puisse les faire
 * fuiter. Sinon on ne compte pas : on recopie.
 */
/** La journée métier, en instants ISO — bornes de l'analyse. */
function dayWindow(businessDate: string) {
  const start = new Date(`${businessDate}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}

export function DayClosing() {
  const {
    state, closing, closingCtx, openClosing, submitClosingStep, revertClosingStep,
    policy, operatingMode,
  } = useBuna();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  /* Ouvrir la clôture écrit dans l'état : le faire pendant le rendu ferait
     réagir le store au milieu d'un rendu d'un autre composant. */
  useEffect(() => { if (!closing) openClosing(); }, [closing, openClosing]);

  const session = closing;
  const ctx = closingCtx();
  const steps = session ? closingProgress(session, ctx) : [];
  const current = steps.find((s) => s.state === 'CURRENT')?.step ?? null;

  /* L'analyse de la journée écoulée, recalculée à chaque étape franchie : le
     comptage du stock change ce qu'elle a à dire. */
  const findings = useMemo(
    () => coherenceFindings({
      items: state.items,
      movements: state.movements,
      sales: state.sales,
      purchases: state.purchases,
      window: dayWindow(session?.businessDate ?? businessDateOf(new Date().toISOString())),
      mode: operatingMode,
      siteId: ctx.siteId,
    }),
    [state.items, state.movements, state.sales, state.purchases, session?.businessDate, operatingMode, ctx.siteId],
  );

  const submit = (declaration: Parameters<typeof submitClosingStep>[0]) => {
    setError(submitClosingStep(declaration));
  };

  return (
    <div className="flex min-h-full flex-1 flex-col bg-ivoire">
      <ScreenHeader
        title="Clôture de la journée"
        subtitle={session?.status === 'VALIDATED' ? 'Journée signée' : 'Cinq étapes, dans l’ordre'}
        onBack={() => navigate('/finance')}
      />

      <main className="flex-1 space-y-3 px-4 pb-32 pt-4">
        {/* Le chemin, toujours visible : on sait où on en est et ce qu'il reste. */}
        <Card padded={false} className="px-4 py-1">
          {steps.map((s) => (
            <div
              key={s.step}
              className="flex items-center justify-between gap-3 border-b border-ink-100 py-2.5 last:border-0"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  className={clsx(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px]',
                    s.state === 'DONE'
                      ? 'bg-conforme-pale text-conforme-deep'
                      : s.state === 'CURRENT'
                        ? 'bg-cafe text-sable-pale'
                        : 'bg-ink-100 text-ink-500',
                  )}
                >
                  {s.state === 'DONE' ? <IconCheck size={13} /> : CLOSING_STEPS.indexOf(s.step) + 1}
                </span>
                <span
                  className={clsx(
                    'truncate text-[14px]',
                    s.state === 'CURRENT' ? 'font-medium text-ink-900' : 'text-ink-600',
                  )}
                >
                  {s.label}
                </span>
              </div>
              {s.state === 'DONE' && s.revertable && (
                <button
                  type="button"
                  onClick={() => setError(revertClosingStep(s.step))}
                  className="shrink-0 text-[12.5px] text-ink-500 underline underline-offset-2 hover:text-cafe"
                >
                  Revenir dessus
                </button>
              )}
            </div>
          ))}
        </Card>

        {error && (
          <Card className="border border-critique bg-critique-pale">
            <p className="text-[13.5px] leading-relaxed text-critique-deep">{error}</p>
          </Card>
        )}

        {!session ? null : session.status === 'VALIDATED' ? (
          <Card className="space-y-3">
            <Badge tone="conforme">Journée clôturée</Badge>
            <p className="text-[13.5px] leading-relaxed text-ink-700">
              Plus aucune saisie ne peut être datée de cette journée. Un propriétaire peut la
              rouvrir avec un motif, et la réouverture restera inscrite au journal.
            </p>
            <Button variant="primary" full onClick={() => navigate('/pilotage')}>
              Voir le tableau de bord
            </Button>
          </Card>
        ) : (
          <StepPanel
            step={current}
            ctx={ctx}
            session={session}
            onSubmit={submit}
            countFinished={policy.countFinishedGoodsAtClosing}
            findings={findings}
          />
        )}
      </main>
    </div>
  );
}

type Ctx = ReturnType<ReturnType<typeof useBuna>['closingCtx']>;
type Session = NonNullable<ReturnType<typeof useBuna>['closing']>;
type Submit = (d: Parameters<ReturnType<typeof useBuna>['submitClosingStep']>[0]) => void;

function StepPanel({
  step, ctx, session, onSubmit, countFinished, findings,
}: {
  step: ClosingStepId | null;
  ctx: Ctx;
  session: Session;
  onSubmit: Submit;
  countFinished: boolean;
  findings: CoherenceFinding[];
}) {
  if (!step) return null;
  switch (step) {
    case 'CASH_COUNT': return <CashStep ctx={ctx} onSubmit={onSubmit} />;
    case 'SALES_RECONCILIATION': return <SalesStep ctx={ctx} onSubmit={onSubmit} />;
    case 'STOCK_VARIANCE': return <StockStep ctx={ctx} onSubmit={onSubmit} countFinished={countFinished} />;
    case 'EXPENSES': return <ExpensesStep ctx={ctx} onSubmit={onSubmit} />;
    case 'FINAL_VALIDATION':
      return <FinalStep ctx={ctx} session={session} onSubmit={onSubmit} findings={findings} />;
  }
}

/* ------------------------------------------- Ce qui ne colle pas, dit avant */

const TONE: Record<CoherenceFinding['severity'], string> = {
  CRITIQUE: 'border-critique bg-critique-pale text-critique-deep',
  ATTENTION: 'border-surveiller bg-surveiller-pale text-or-ink',
  INFO: 'border-ink-200 bg-surface text-ink-600',
};

/**
 * Les incohérences de la journée, avant la signature.
 *
 * Le suivi simple ne refuse plus rien au comptoir : vendre au-delà de ce qu'on
 * a déclaré préparé passe. Ce panneau est ce qui remplace le refus — pas un
 * blocage, une lucidité. Chaque ligne dit ce qu'on observe, ce que ça fausse,
 * et ce qu'on peut y faire : un avertissement qui tait la conséquence se lit
 * comme une pinaillerie, et on apprend à le fermer sans le lire.
 */
function Coherence({ findings }: { findings: CoherenceFinding[] }) {
  if (!findings.length) {
    return (
      <Card className="border border-conforme bg-conforme-pale">
        <p className="text-[13px] leading-relaxed text-conforme-deep">
          Les chiffres de la journée se tiennent : ce qui a été vendu tient dans ce qui a été
          déclaré, et le coût matière repose sur un comptage.
        </p>
      </Card>
    );
  }

  return (
    <Card className="space-y-3">
      <SectionLabel>Ce qui ne colle pas</SectionLabel>
      <p className="text-[13px] leading-relaxed text-ink-600">
        Rien ici n'empêche de clôturer. Mais ces écarts changent la lecture des chiffres, et il
        vaut mieux les connaître maintenant que dans trois semaines.
      </p>
      {findings.map((f) => (
        <div key={f.id} className={clsx('space-y-1 rounded-[6px] border px-3.5 py-2.5', TONE[f.severity])}>
          <div className="text-[13.5px] font-medium leading-snug">{f.statement}</div>
          <p className="text-[12.5px] leading-relaxed opacity-90">{f.consequence}</p>
          <p className="text-[12.5px] leading-relaxed opacity-80">{f.suggestion}</p>
        </div>
      ))}
    </Card>
  );
}

/* ------------------------------------------------------ 1. Comptage caisse */

function CashStep({ ctx, onSubmit }: { ctx: Ctx; onSubmit: Submit }) {
  const [raw, setRaw] = useState('');
  const [reason, setReason] = useState('');
  const [revealed, setRevealed] = useState(false);

  const declaration = filled(raw) ? { step: 'CASH_COUNT' as const, countedCash: num(raw) } : null;
  const view = cashCountView(ctx, revealed ? declaration : null);

  return (
    <Card className="space-y-3">
      <SectionLabel>{CLOSING_STEP_LABEL.CASH_COUNT}</SectionLabel>
      <p className="text-[13px] leading-relaxed text-ink-600">
        Comptez les espèces réellement présentes dans le tiroir. L'attendu reste masqué jusqu'à
        votre chiffre — sinon on ne compte pas, on recopie.
      </p>

      <Field
        label="Espèces comptées"
        type="number"
        inputMode="numeric"
        suffix="FCFA"
        value={raw}
        onChange={(e) => { setRaw(e.target.value); setRevealed(false); }}
      />

      {!view.revealed ? (
        <Button variant="primary" full disabled={!filled(raw)} onClick={() => setRevealed(true)}>
          Comparer à l'attendu
        </Button>
      ) : (
        <>
          <div className="derived">
            <Card padded={false} className="px-4 py-1">
              <Row label="Fond d'ouverture" value={fcfaFull(view.breakdown.openingCash)} />
              <Row label="Ventes en espèces" value={fcfaFull(view.breakdown.cashSales)} />
              <Row label="Dépenses en espèces" value={`−${fcfaFull(view.breakdown.cashExpenses)}`} />
              <Row label="Attendu" value={fcfaFull(view.expected)} strong />
              <Row
                label="Écart"
                value={`${view.variance > 0 ? '+' : ''}${fcfaFull(view.variance)}`}
                tone={view.variance === 0 ? 'conforme' : view.withinTolerance ? 'surveiller' : 'critique'}
                strong
              />
            </Card>
          </div>

          {view.requiresReason && (
            <Field
              label="Motif de l'écart"
              placeholder="ex. rendu de monnaie"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              hint="L'écart dépasse la tolérance : dites ce qui s'est passé."
            />
          )}

          <div className="flex gap-2.5">
            <Button className="flex-1" onClick={() => setRevealed(false)}>Recompter</Button>
            <Button
              variant="primary"
              className="flex-[1.4]"
              onClick={() => onSubmit({ step: 'CASH_COUNT', countedCash: num(raw), reason: reason || undefined })}
            >
              Valider le comptage
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

/* ------------------------------------------------ 2. Rapprochement ventes */

function SalesStep({ ctx, onSubmit }: { ctx: Ctx; onSubmit: Submit }) {
  const methods = useMemo(() => reconcilableMethods(ctx), [ctx]);
  const [totals, setTotals] = useState<Partial<Record<PaymentMethod, string>>>({});
  const [reason, setReason] = useState('');
  const [revealed, setRevealed] = useState(methods.length === 0);

  const declared = Object.fromEntries(
    methods.filter((m) => filled(totals[m] ?? '')).map((m) => [m, num(totals[m]!)]),
  ) as Partial<Record<PaymentMethod, number>>;
  const complete = methods.every((m) => declared[m] !== undefined);
  const view = salesReconciliationView(
    ctx,
    revealed && complete ? { step: 'SALES_RECONCILIATION', declaredTotals: declared } : null,
  );

  return (
    <Card className="space-y-3">
      <SectionLabel>{CLOSING_STEP_LABEL.SALES_RECONCILIATION}</SectionLabel>

      {methods.length === 0 ? (
        <p className="text-[13px] leading-relaxed text-ink-600">
          Aucune vente hors espèces aujourd'hui : il n'y a rien à rapprocher.
        </p>
      ) : (
        <>
          <p className="text-[13px] leading-relaxed text-ink-600">
            Relevez le total affiché par chaque canal, sur le téléphone ou le terminal.
          </p>
          {methods.map((m) => (
            <Field
              key={m}
              label={PAYMENT_LABEL[m]}
              type="number"
              inputMode="numeric"
              suffix="FCFA"
              value={totals[m] ?? ''}
              onChange={(e) => { setTotals((t) => ({ ...t, [m]: e.target.value })); setRevealed(false); }}
            />
          ))}
        </>
      )}

      {!view.revealed ? (
        <Button variant="primary" full disabled={!complete} onClick={() => setRevealed(true)}>
          Comparer au système
        </Button>
      ) : (
        <>
          {view.lines.length > 0 && (
            <div className="derived">
              <Card padded={false} className="px-4 py-1">
                {view.lines.map((l) => (
                  <Row
                    key={l.method}
                    label={`${l.label} · ${l.count} vente${l.count > 1 ? 's' : ''}`}
                    value={`${l.variance > 0 ? '+' : ''}${fcfaFull(l.variance)}`}
                    tone={l.variance === 0 ? 'conforme' : l.requiresReason ? 'critique' : 'surveiller'}
                  />
                ))}
              </Card>
            </div>
          )}

          {view.voided.length > 0 && (
            <p className="text-[12.5px] leading-relaxed text-ink-500">
              {view.voided.length} vente{view.voided.length > 1 ? 's' : ''} annulée
              {view.voided.length > 1 ? 's' : ''} aujourd'hui, hors du total.
            </p>
          )}

          {view.pendingEventCount > 0 && (
            <p className="text-[12.5px] leading-relaxed text-or-ink">
              {view.pendingEventCount} fait{view.pendingEventCount > 1 ? 's' : ''} en attente d'envoi.
              La clôture n'attend pas le réseau — c'est une information, pas un obstacle.
            </p>
          )}

          {view.requiresReason && (
            <Field
              label="Motif de l'écart"
              placeholder="ex. transfert non enregistré"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}

          <Button
            variant="primary"
            full
            onClick={() => onSubmit({
              step: 'SALES_RECONCILIATION',
              declaredTotals: declared,
              reason: reason || undefined,
            })}
          >
            Valider le rapprochement
          </Button>
        </>
      )}
    </Card>
  );
}

/* --------------------------------------------------- 3. Comptage du stock */

function StockStep({
  ctx, onSubmit, countFinished,
}: { ctx: Ctx; onSubmit: Submit; countFinished: boolean }) {
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, WasteReason>>({});
  const [revealed, setRevealed] = useState(false);

  const key = (itemId: string, locationId: string) => `${itemId}@${locationId}`;
  const scope = ctx.countScope;
  const byId = new Map(ctx.items.map((i) => [i.id, i]));

  const entries: StockCountEntry[] = scope
    .filter((s) => filled(counts[key(s.itemId, s.locationId)] ?? ''))
    .map((s) => ({
      itemId: s.itemId,
      locationId: s.locationId,
      counted: num(counts[key(s.itemId, s.locationId)]!),
      reason: reasons[key(s.itemId, s.locationId)],
    }));

  const complete = entries.length === scope.length;
  const view = stockVarianceView(ctx, revealed && complete ? { step: 'STOCK_VARIANCE', counts: entries } : null);

  return (
    <Card className="space-y-3">
      <SectionLabel>{CLOSING_STEP_LABEL.STOCK_VARIANCE}</SectionLabel>

      {scope.length === 0 ? (
        <p className="text-[13px] leading-relaxed text-ink-600">
          Rien à compter ce soir.
          {!countFinished && " En suivi précis, le comptage des produits finis n'est pas exigé."}
        </p>
      ) : (
        <>
          <p className="text-[13px] leading-relaxed text-ink-600">
            Comptez ce qu'il reste vraiment. C'est ce comptage qui referme l'équation — préparé,
            vendu, restant — et qui explique les écarts de la journée.
          </p>

          {scope.map((s) => {
            const k = key(s.itemId, s.locationId);
            const item = byId.get(s.itemId);
            const place = LOCATIONS.find((l) => l.id === s.locationId);
            return (
              <div key={k} className="space-y-1.5">
                <Field
                  label={`${item?.name ?? 'Article'}${place ? ` · ${place.name}` : ''}`}
                  type="number"
                  inputMode="decimal"
                  suffix={item?.unit === 'unite' ? 'unités' : item?.unit}
                  value={counts[k] ?? ''}
                  onChange={(e) => { setCounts((c) => ({ ...c, [k]: e.target.value })); setRevealed(false); }}
                />
              </div>
            );
          })}
        </>
      )}

      {!view.revealed ? (
        <Button variant="primary" full disabled={!complete} onClick={() => setRevealed(true)}>
          Comparer au théorique
        </Button>
      ) : (
        <>
          {view.lines.length > 0 && (
            <div className="derived">
              <Card padded={false} className="px-4 py-1">
                {view.lines.map((l) => (
                  <Row
                    key={key(l.itemId, l.locationId)}
                    label={`${l.name} · théorique ${formatQty(l.theoretical, l.unit)}`}
                    value={`${l.delta > 0 ? '+' : ''}${formatQty(l.delta, l.unit)}`}
                    tone={l.delta === 0 ? 'conforme' : l.requiresReason ? 'critique' : 'surveiller'}
                  />
                ))}
              </Card>
            </div>
          )}

          {view.lines.filter((l) => l.requiresReason).map((l) => {
            const k = key(l.itemId, l.locationId);
            return (
              <div key={k}>
                <span className="mb-1.5 block text-[13px] font-medium text-ink-800">
                  {l.name} — {fcfa(Math.abs(l.value))} FCFA d'écart. Que s'est-il passé ?
                </span>
                <div className="flex flex-wrap gap-2">
                  {REASONS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setReasons((x) => ({ ...x, [k]: r }))}
                      className={clsx(
                        'no-select min-h-[40px] rounded-[6px] px-3 text-[13px] transition-colors',
                        reasons[k] === r
                          ? 'border-2 border-brun bg-sable-pale text-cafe'
                          : 'border border-ink-200 bg-surface text-ink-700',
                      )}
                    >
                      {WASTE_LABEL[r]}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}

          <div className="flex gap-2.5">
            <Button className="flex-1" onClick={() => setRevealed(false)}>Recompter</Button>
            <Button
              variant="primary"
              className="flex-[1.4]"
              onClick={() => onSubmit({ step: 'STOCK_VARIANCE', counts: entries })}
            >
              Valider le comptage
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------ 4. Dépenses */

function ExpensesStep({ ctx, onSubmit }: { ctx: Ctx; onSubmit: Submit }) {
  const view = expensesView(ctx);
  return (
    <Card className="space-y-3">
      <SectionLabel>{CLOSING_STEP_LABEL.EXPENSES}</SectionLabel>
      <p className="text-[13px] leading-relaxed text-ink-600">
        Rien n'est masqué ici : ces dépenses sont déjà déclarées. On les reconnaît, ce sont elles
        qui expliquent l'argent sorti du tiroir.
      </p>

      <Card padded={false} className="px-4 py-1">
        <Row label={`${view.count} dépense${view.count > 1 ? 's' : ''}`} value={fcfaFull(view.total)} strong />
        <Row label="dont espèces" value={fcfaFull(view.cashTotal)} />
        {view.byCategory.map((c) => (
          <Row key={c.category} label={c.label} value={fcfaFull(c.total)} />
        ))}
      </Card>

      {view.warnings.map((w) => (
        <p key={w} className="text-[12.5px] leading-relaxed text-or-ink">{w}</p>
      ))}

      <Button variant="primary" full onClick={() => onSubmit({ step: 'EXPENSES', confirmed: true })}>
        Confirmer les dépenses
      </Button>
    </Card>
  );
}

/* ---------------------------------------------------------- 5. Validation */

function FinalStep({
  ctx, session, onSubmit, findings,
}: { ctx: Ctx; session: Session; onSubmit: Submit; findings: CoherenceFinding[] }) {
  const view = finalValidationView(session, ctx);

  if (!view.ready) {
    return (
      <Card className="space-y-2">
        <SectionLabel>{CLOSING_STEP_LABEL.FINAL_VALIDATION}</SectionLabel>
        {view.blockers.map((b) => (
          <p key={b} className="text-[13px] leading-relaxed text-ink-600">{b}</p>
        ))}
      </Card>
    );
  }

  const { recap } = view;
  return (
    <>
      <Coherence findings={findings} />

      <Card className="space-y-3">
      <SectionLabel>{CLOSING_STEP_LABEL.FINAL_VALIDATION}</SectionLabel>

      <div className="derived">
        <Card padded={false} className="px-4 py-1">
          <Row label="Chiffre d'affaires" value={fcfaFull(recap.revenue)} strong />
          <Row label={`${recap.salesCount} vente${recap.salesCount > 1 ? 's' : ''}`} value="" />
          <Row label="Dépenses" value={fcfaFull(recap.expensesTotal)} />
          <Row label="Espèces comptées" value={fcfaFull(recap.countedCash)} />
          <Row
            label="Écart de caisse"
            value={`${recap.cashVariance > 0 ? '+' : ''}${fcfaFull(recap.cashVariance)}`}
            tone={recap.cashVariance === 0 ? 'conforme' : 'surveiller'}
          />
          <Row
            label="Écart de stock"
            value={`${recap.stockVarianceValue > 0 ? '+' : ''}${fcfaFull(recap.stockVarianceValue)}`}
            tone={recap.stockVarianceValue === 0 ? 'conforme' : 'surveiller'}
          />
        </Card>
      </div>

      <p className="text-[13px] leading-relaxed text-ink-600">
        Après validation, plus aucune saisie ne pourra être datée de cette journée. Un propriétaire
        pourra la rouvrir avec un motif, et la réouverture restera inscrite.
      </p>

      <Button
        variant="primary"
        size="counter"
        full
        onClick={() => onSubmit({ step: 'FINAL_VALIDATION', confirmed: true })}
      >
        Clôturer la journée
      </Button>
      </Card>
    </>
  );
}

/* ------------------------------------------------------------- Une ligne */

function Row({
  label, value, strong, tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: 'conforme' | 'surveiller' | 'critique';
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-ink-100 py-2.5 last:border-0">
      <span className={clsx('text-[13.5px]', strong ? 'font-medium text-ink-900' : 'text-ink-700')}>
        {label}
      </span>
      <span
        className={clsx(
          'num shrink-0 text-[14.5px]',
          tone === 'conforme' ? 'text-conforme-deep'
            : tone === 'critique' ? 'text-critique'
              : tone === 'surveiller' ? 'text-or-ink'
                : 'text-ink-900',
        )}
      >
        {value}
      </span>
    </div>
  );
}
