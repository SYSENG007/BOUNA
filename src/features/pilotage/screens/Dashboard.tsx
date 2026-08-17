import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBuna } from '../../../store/BunaStore';
import { fcfa, fcfaFull, percent } from '../../../domain/money';
import {
  hourlyProfitability, periodOf, periodReport, periodSeries, productMargins,
  type Granularity,
} from '../../../domain/analytics';
import { cashFlowReport, cashPositions } from '../../../domain/cashflow';
import { materialBalance, productFlows } from '../../../domain/period-balance';
import { openVariances, unresolvedAmount, VARIANCE_SOURCE_LABEL } from '../../../domain/variance';
import { EXPENSE_LABEL, type ExpenseCategory } from '../../../domain/types';
import { useAnalyticsInput, useCashFlowInput } from '../useAnalytics';
import { SyncIndicator } from '../../../design-system/components/SyncIndicator';
import { ActorStamp } from '../../../design-system/components/ActorStamp';
import { Badge, Button, Card, SectionLabel, Segmented } from '../../../design-system/components/primitives';
import { KpiTile } from '../../../design-system/components/patterns';
import {
  BarSeries, Donut, EmptyChart, HBars, HourStrip, Sparkline, VarianceBar,
} from '../../../design-system/charts';

/**
 * Le tableau de bord — un seul écran, composé de blocs conditionnés par une
 * capacité.
 *
 * Il remplace `Today` (manager) et `Cockpit` (owner), qui recalculaient chacun
 * les mêmes agrégats à la main. Un vendeur y voit ses ventes et son stock ; un
 * manager y voit tout. Même écran, même vocabulaire — c'est ce qui permet d'en
 * parler à deux au comptoir.
 *
 * Le filet doré marque les inférences (marge, rentabilité, écart, autonomie),
 * jamais les sommes (chiffre d'affaires, nombre de commandes). Le mettre
 * partout en ferait de la décoration.
 */
export function Dashboard() {
  const { state, user, can, variances, policy } = useBuna();
  const navigate = useNavigate();
  const input = useAnalyticsInput();
  const cashInput = useCashFlowInput();
  const [grain, setGrain] = useState<Granularity>('DAY');

  const now = Date.now();
  const seeFinances = can('VIEW_FINANCES');

  const report = useMemo(() => periodReport(input, now, grain), [input, grain, now]);
  const series = useMemo(
    () => periodSeries(input, now, grain, grain === 'DAY' ? 14 : grain === 'WEEK' ? 8 : 6),
    [input, grain, now],
  );
  const hourly = useMemo(
    () => hourlyProfitability(input, periodOf(now, 'DAY')),
    [input, now],
  );
  const margins = useMemo(() => productMargins(input, report.period), [input, report.period]);

  /*
   * Le coût matière de la période, quand le coût par produit n'existe pas.
   *
   * En suivi simple, le COGS figé sur chaque vente vaut zéro : le coût moyen
   * pondéré d'un produit fini n'est écrit par aucune réception, et la
   * production ne le calcule pas. « Marge brute 100 % » n'est donc pas une
   * bonne nouvelle, c'est une soustraction de zéro. On mesure ce qu'on sait
   * mesurer — ce qui est entré en matières, moins ce qui reste.
   */
  const balance = useMemo(
    () => materialBalance({
      items: state.items,
      movements: state.movements,
      sales: state.sales,
      purchases: state.purchases,
      /* `Period` porte des bornes en millisecondes ; le bilan compare des
         instants ISO, comme les faits eux-mêmes les portent. */
      window: {
        from: new Date(report.period.start).toISOString(),
        to: new Date(report.period.end).toISOString(),
      },
    }),
    [state.items, state.movements, state.sales, state.purchases, report.period],
  );
  const marginKnown = policy.productMarginKnown;

  /* L'équation que la déclaration de préparation rend possible, sans recette :
     préparé + reste de la veille − vendu − jeté = ce qu'il devrait rester. */
  const flows = useMemo(
    () => productFlows({
      items: state.items,
      movements: state.movements,
      window: {
        from: new Date(report.period.start).toISOString(),
        to: new Date(report.period.end).toISOString(),
      },
    }),
    [state.items, state.movements, report.period],
  );
  const cash = useMemo(() => cashFlowReport(cashInput, now, 14), [cashInput, now]);

  const open = openVariances(variances);
  const openAmount = unresolvedAmount(variances);

  const expensesByCategory = useMemo(() => {
    const map = new Map<ExpenseCategory, number>();
    for (const e of state.expenses) {
      if (Date.parse(e.createdAt) < report.period.start) continue;
      map.set(e.category, (map.get(e.category) ?? 0) + e.amount);
    }
    return [...map.entries()].map(([category, value]) => ({ label: EXPENSE_LABEL[category], value }));
  }, [state.expenses, report.period.start]);

  const totals = report.current.hasData ? report.current.value : null;
  const change = report.change.hasData ? report.change.value : null;

  return (
    <div className="flex-1 bg-shell">
      <div className="lg:hidden"><SyncIndicator /></div>

      <div className="mx-auto max-w-5xl px-4 py-6 lg:px-10 lg:py-10">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="t-h1 text-cafe lg:text-[40px] lg:leading-[46px]">
              Bonjour {user?.name.split(' ')[0]}
            </h1>
            <p className="text-[13px] text-ink-500">{report.period.label}</p>
          </div>
          <Segmented
            value={grain}
            onChange={setGrain}
            options={[
              { value: 'DAY', label: 'Jour' },
              { value: 'WEEK', label: 'Semaine' },
              { value: 'MONTH', label: 'Mois' },
            ]}
          />
        </header>

        {/* ------------------------------------------------ Bandeau du jour */}
        {!totals ? (
          <Card>
            <p className="text-[14px] leading-relaxed text-ink-600">
              Rien n'a encore été saisi sur cette période. Ce n'est pas une journée à zéro —
              c'est une journée dont personne n'a rien dit.
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiTile
              label="Chiffre d'affaires"
              value={fcfa(totals.revenue)}
              unit="FCFA"
              caption={
                change?.revenuePct != null
                  ? `${change.revenuePct > 0 ? '+' : ''}${percent(change.revenuePct)} vs ${report.previous.label}`
                  : 'Pas de période précédente comparable'
              }
            />
            <KpiTile label="Commandes" value={String(totals.orders)}
              caption={totals.averageBasket !== null ? `panier ${fcfa(totals.averageBasket)} FCFA` : undefined} />
            {/*
              La marge se lit là où elle existe.
              En suivi précis, elle vient des recettes, vente par vente. En suivi
              simple, ce COGS vaut zéro — aucune réception n'écrit le coût d'un
              produit fini, et la production ne le calcule pas — donc « marge
              100 % » ne dirait pas que tout va bien, mais que la soustraction
              portait sur rien. On montre alors le coût matière de la période,
              qui est mesuré et non supposé.
            */}
            {seeFinances && marginKnown && (
              <div className="derived">
                <KpiTile
                  label="Marge brute"
                  value={totals.marginPct !== null ? percent(totals.marginPct) : '—'}
                  caption={`${fcfa(totals.grossMargin)} FCFA déduits des ventes`}
                  tone={(totals.marginPct ?? 0) >= 50 ? 'positive' : 'negative'}
                />
              </div>
            )}
            {seeFinances && marginKnown && (
              <div className="derived">
                <KpiTile
                  label="Marge nette"
                  value={fcfa(totals.netMargin)}
                  unit="FCFA"
                  caption={`après ${fcfa(totals.operatingExpenses)} de charges et ${fcfa(totals.wasteCost)} de pertes`}
                  tone={totals.netMargin >= 0 ? 'positive' : 'negative'}
                />
              </div>
            )}
            {seeFinances && !marginKnown && (
              <div className="derived">
                <KpiTile
                  label="Part matière"
                  value={balance.materialSharePct !== null ? percent(balance.materialSharePct) : '—'}
                  caption={`${fcfa(balance.consumed)} FCFA de matières consommées`}
                  tone={(balance.materialSharePct ?? 0) <= 35 ? 'positive' : 'negative'}
                />
              </div>
            )}
            {seeFinances && !marginKnown && (
              <div className="derived">
                <KpiTile
                  label="Marge de période"
                  value={fcfa(balance.grossMargin)}
                  unit="FCFA"
                  caption={
                    balance.uncounted
                      ? 'stock final théorique — personne n’a compté'
                      : `stock initial ${fcfa(balance.openingValue)} + achats ${fcfa(balance.purchases)} − reste ${fcfa(balance.closingValue)}`
                  }
                  tone={balance.grossMargin >= 0 ? 'positive' : 'negative'}
                />
              </div>
            )}
          </div>
        )}

        {/* ------------------------------------------------------ Écarts */}
        {can('RESOLVE_VARIANCE') && open.length > 0 && (
          <Card className="mt-4 space-y-3 border-surveiller/40">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <SectionLabel>À expliquer</SectionLabel>
              <Badge tone="surveiller">{open.length} écart{open.length > 1 ? 's' : ''} ouvert{open.length > 1 ? 's' : ''}</Badge>
            </div>
            <p className="text-[13.5px] leading-relaxed text-ink-600">
              <strong className="num text-ink-900">{fcfaFull(openAmount)}</strong> attendent un motif.
              Tant qu'ils n'en ont pas, on ne sait pas si c'est une perte, une erreur ou un vol.
            </p>
            <div className="space-y-2.5">
              {open.slice(0, 3).map((v) => (
                <div key={v.id} className="derived space-y-1">
                  <div className="flex items-baseline justify-between gap-2 text-[13px]">
                    <span className="text-ink-800">{v.subject}</span>
                    <span className="text-[11.5px] text-ink-500">{VARIANCE_SOURCE_LABEL[v.source]}</span>
                  </div>
                  <VarianceBar value={v.delta} max={Math.max(...open.map((x) => Math.abs(x.delta)))} format={fcfa} />
                  <ActorStamp actor={v.actor} />
                </div>
              ))}
            </div>
            <Button full onClick={() => navigate('/stock/ecarts')}>Solder les écarts</Button>
          </Card>
        )}

        {/* ------------------------------------------------------ Courbe */}
        <section className="mt-6">
          <SectionLabel className="mb-2">
            Chiffre d'affaires · {series.length} dernières périodes
          </SectionLabel>
          <Card>
            <BarSeries
              data={series.map((s) => ({
                label: s.period.label,
                value: s.totals.hasData ? s.totals.value.revenue : null,
              }))}
              format={(n) => `${fcfa(n)} FCFA`}
              label="Chiffre d'affaires par période"
            />
            <p className="mt-3 text-[12px] leading-relaxed text-ink-500">
              Les périodes hachurées n'ont jamais été saisies. Elles ne valent pas zéro.
            </p>
          </Card>
        </section>

        {/* -------------------------------------------------- Trésorerie */}
        {seeFinances && (
          <section className="mt-6">
            <div className="mb-2 flex items-center justify-between">
              <SectionLabel>Trésorerie</SectionLabel>
              <button
                type="button"
                onClick={() => navigate('/finance/tresorerie')}
                className="text-[12.5px] text-brun underline-offset-2 hover:underline"
              >
                Tout voir
              </button>
            </div>
            <Card className="space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <div className="label-section">Disponible</div>
                  <div className="num text-[32px] leading-none text-ink-900">{fcfa(cash.closingBalance)}</div>
                  <div className="text-[12px] text-ink-500">FCFA, tous moyens confondus</div>
                </div>
                <Sparkline points={cash.points.map((p) => p.balance)} width={96} height={30} />
              </div>

              <div className="derived space-y-1">
                <div className="text-[13px] text-ink-700">
                  {cash.runway.hasData
                    ? <>Au rythme actuel, la trésorerie tient <strong className="num text-ink-900">{cash.runway.value} jour{cash.runway.value > 1 ? 's' : ''}</strong>.</>
                    : <>Aucune sortie enregistrée : l'autonomie ne se calcule pas.</>}
                </div>
                {cash.averageBurn.hasData && (
                  <div className="text-[12px] text-ink-500">
                    Sortie moyenne {fcfa(cash.averageBurn.value)} FCFA par jour ouvré
                  </div>
                )}
              </div>

              <div className="space-y-2 border-t border-ink-100 pt-3">
                <div className="label-section">Où est l'argent</div>
                {cashPositions(cash).length === 0 ? (
                  <p className="text-[13px] text-ink-500">Aucun mouvement d'argent sur la période.</p>
                ) : (
                  <HBars
                    rows={cashPositions(cash).map((p) => ({
                      label: p.label,
                      value: Math.max(0, p.balance),
                      tone: p.balance < 0 ? 'critique' : 'cafe',
                      right: `${fcfa(p.balance)} FCFA`,
                    }))}
                  />
                )}
              </div>
            </Card>
          </section>
        )}

        {/* ------------------------------------------- Rentabilité horaire */}
        {seeFinances && (
          <section className="mt-6">
            <SectionLabel className="mb-2">Rentabilité par heure · aujourd'hui</SectionLabel>
            <Card className="derived">
              {hourly.hasData ? (
                <>
                  <HourStrip
                    hours={hourly.value.hours.map((h) => ({ hour: h.hour, value: h.netMargin, open: true }))}
                    format={(n) => `${fcfa(n)} FCFA`}
                  />
                  <p className="mt-3 text-[12px] leading-relaxed text-ink-500">
                    Charges réparties {hourly.value.allocation === 'PART_EGALE' ? 'à parts égales' : 'au prorata du chiffre d\'affaires'}
                    {' '}sur {hourly.value.openHours} heure{hourly.value.openHours > 1 ? 's' : ''} ouverte{hourly.value.openHours > 1 ? 's' : ''}.
                    {hourly.value.excludedFromAllocation > 0 && (
                      <> {fcfa(hourly.value.excludedFromAllocation)} FCFA d'achats de marchandise sont exclus : ils sont déjà comptés dans le coût des ventes.</>
                    )}
                  </p>
                </>
              ) : (
                <EmptyChart height={96} message="Aucune vente enregistrée aujourd'hui." />
              )}
            </Card>
          </section>
        )}

        {/* -------------------------------------------------- Répartitions */}
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <section>
            <SectionLabel className="mb-2">Ce qui rapporte</SectionLabel>
            <Card className={seeFinances && marginKnown ? 'derived' : undefined}>
              {margins.hasData && margins.value.length > 0 ? (
                <>
                  <HBars
                    rows={margins.value.slice(0, 6).map((m) => ({
                      label: m.name,
                      value: seeFinances && marginKnown ? m.grossMargin : m.unitsSold,
                      tone: m.soldAtLoss && marginKnown ? 'critique' : 'cafe',
                      right: seeFinances && marginKnown
                        ? `${fcfa(m.grossMargin)} · ${m.marginPct !== null ? percent(m.marginPct) : '—'}`
                        : `${m.unitsSold} vendus`,
                    }))}
                  />
                  {seeFinances && !marginKnown && (
                    <p className="mt-3 text-[12.5px] leading-relaxed text-ink-500">
                      Les quantités, pas la marge : sans recette, ce que coûte une unité reste
                      inconnu. La rentabilité se lit sur la période, au-dessus.
                    </p>
                  )}
                </>
              ) : (
                <EmptyChart message="Aucune vente sur la période." />
              )}
            </Card>
          </section>

          {/*
            Préparé, vendu, restant — l'équation du suivi simple.
            Elle ne demande aucune recette : elle compare des faits que la
            maison connaît déjà. L'écart n'accuse personne, il ouvre une
            question, et il ne veut rien dire tant que personne n'a compté.
          */}
          {!marginKnown && flows.length > 0 && (
            <section>
              <SectionLabel className="mb-2">Préparé, vendu, restant</SectionLabel>
              <Card padded={false} className="px-4 py-1">
                {flows.slice(0, 8).map((f) => (
                  <div
                    key={f.itemId}
                    className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-ink-100 py-2.5 last:border-0"
                  >
                    <span className="text-[14px] text-ink-900">{f.name}</span>
                    <span className="num text-[12.5px] text-ink-500">
                      {f.produced > 0 && `préparé ${f.produced} · `}
                      vendu {f.sold} · reste {f.closing}
                      {f.counted && f.gap !== 0 && (
                        <span className={f.gap < 0 ? 'text-critique' : 'text-or-ink'}>
                          {' '}· écart {f.gap > 0 ? '+' : ''}{f.gap}
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </Card>
              {flows.every((f) => !f.counted) && (
                <p className="mt-2 px-1 text-[12.5px] leading-relaxed text-ink-500">
                  Personne n'a compté sur cette période : « reste » est ce que le système déduit,
                  pas ce qu'il y a sur l'étagère. Le comptage du soir referme l'équation.
                </p>
              )}
            </section>
          )}

          {seeFinances && (
            <section>
              <SectionLabel className="mb-2">Où part l'argent</SectionLabel>
              <Card>
                <Donut
                  slices={expensesByCategory}
                  center={
                    <>
                      <span className="num text-[19px] leading-none text-ink-900">
                        {fcfa(expensesByCategory.reduce((s, x) => s + x.value, 0))}
                      </span>
                      <span className="text-[11px] text-ink-500">FCFA</span>
                    </>
                  }
                />
              </Card>
            </section>
          )}
        </div>

        {/* -------------------------------------------- Activité de l'équipe */}
        {can('VIEW_AUDIT_LOG') && (
          <section className="mt-6">
            <div className="mb-2 flex items-center justify-between">
              <SectionLabel>Ce que l'équipe a fait</SectionLabel>
              <button
                type="button"
                onClick={() => navigate('/pilotage/journal')}
                className="text-[12.5px] text-brun underline-offset-2 hover:underline"
              >
                Tout le journal
              </button>
            </div>
            <Card padded={false}>
              {state.audit.slice(0, 6).map((a) => (
                <div key={a.id} className="border-b border-ink-100 px-4 py-3 last:border-b-0">
                  <div className="text-[14px] text-ink-900">{a.action}</div>
                  {a.detail && <div className="text-[12.5px] text-ink-500">{a.detail}</div>}
                  <ActorStamp actor={a.actor} showCapability className="mt-1" />
                </div>
              ))}
            </Card>
          </section>
        )}
      </div>
    </div>
  );
}
