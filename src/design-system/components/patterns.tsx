import type { ReactNode } from 'react';
import clsx from 'clsx';
import { Badge, Card, type Tone } from './primitives';
import { fcfa } from '../../domain/money';
import type { StockHealth } from '../../domain/stock';

/* =================================================================
   Motifs composés — KPI, stock, alertes.
   « Les chiffres en mono, alignés à droite. FCFA en petit, à côté. »
   ================================================================= */

export const HEALTH_TONE: Record<StockHealth, Tone> = {
  OK: 'conforme',
  SURVEILLER: 'surveiller',
  CRITIQUE: 'critique',
  RUPTURE: 'critique',
};

export const HEALTH_LABEL: Record<StockHealth, string> = {
  OK: 'OK',
  SURVEILLER: 'À surveiller',
  CRITIQUE: 'Critique',
  RUPTURE: 'Rupture',
};

/* ---------------------------------------------------------- Tuile KPI */

export function KpiTile({
  label, value, unit, caption, tone = 'neutral', hero = false,
}: {
  label: string;
  value: string;
  unit?: string;
  caption?: string;
  tone?: 'neutral' | 'positive' | 'negative';
  hero?: boolean;
}) {
  const valueColor =
    tone === 'negative' ? 'text-critique' : tone === 'positive' ? 'text-conforme-deep' : 'text-ink-900';
  return (
    <Card className="flex flex-col gap-1.5">
      <div className="label-section">{label}</div>
      <div className="flex items-baseline gap-1.5">
        <span
          className={clsx(
            'num leading-none',
            hero ? 'text-[38px]' : 'text-[26px]',
            valueColor,
          )}
        >
          {value}
        </span>
        {unit && <span className="text-[12px] text-ink-500">{unit}</span>}
      </div>
      {caption && <div className="text-[12px] leading-snug text-ink-500">{caption}</div>}
    </Card>
  );
}

/* ------------------------------------------------------ Ligne de stock */

export function StockRow({
  name, location, quantity, health, onClick,
}: {
  name: string;
  location: string;
  quantity: string;
  health: StockHealth;
  onClick?: () => void;
}) {
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Wrapper
      onClick={onClick}
      className={clsx(
        'flex w-full min-h-[64px] items-center gap-3 border-b border-ink-100 px-4 py-3 text-left last:border-0',
        onClick && 'transition-colors active:bg-sable-pale',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-medium text-ink-900">{name}</div>
        <div className="truncate text-[12px] text-ink-500">{location}</div>
      </div>
      <div className="num shrink-0 text-[15px] text-ink-900">{quantity}</div>
      <div className="w-[92px] shrink-0 text-right">
        <Badge tone={HEALTH_TONE[health]}>{HEALTH_LABEL[health]}</Badge>
      </div>
    </Wrapper>
  );
}

/* --------------------------------------------------- Ligne « à traiter »

   §94 — Préférer « Vanilla bientôt épuisé · [Préparer 20] » à « Stock faible ».
   Une alerte porte toujours son action.                                     */

export function ActionRow({
  title, detail, tone = 'surveiller', onClick, actionLabel,
}: {
  title: string;
  detail: string;
  tone?: Tone;
  onClick?: () => void;
  actionLabel?: string;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full min-h-[64px] items-center gap-3 border-b border-ink-100 px-4 py-3 text-left transition-colors last:border-0 active:bg-sable-pale"
    >
      <span
        className={clsx(
          'mt-1 h-2 w-2 shrink-0 self-start rounded-full',
          tone === 'critique' ? 'bg-critique' : tone === 'info' ? 'bg-info' : 'bg-surveiller',
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium text-ink-900">{title}</span>
        <span className="block text-[13px] leading-snug text-ink-500">{detail}</span>
        {actionLabel && (
          <span className="mt-1.5 inline-block text-[13px] font-medium text-brun underline underline-offset-4">
            {actionLabel}
          </span>
        )}
      </span>
      <span className="shrink-0 text-[18px] text-ink-300">›</span>
    </button>
  );
}

/* ------------------------------------------------------ Ligne montant */

export function AmountRow({
  label, sub, amount, unit = 'FCFA', strong = false, tone,
}: {
  label: string;
  sub?: string;
  amount: number | string;
  unit?: string;
  strong?: boolean;
  tone?: 'negative' | 'positive';
}) {
  const text = typeof amount === 'number' ? fcfa(amount) : amount;
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <div className={clsx('text-[14px]', strong ? 'font-semibold text-ink-900' : 'text-ink-700')}>
          {label}
        </div>
        {sub && <div className="text-[12px] text-ink-500">{sub}</div>}
      </div>
      <div className="flex shrink-0 items-baseline gap-1">
        <span
          className={clsx(
            'num',
            strong ? 'text-[18px] font-medium' : 'text-[15px]',
            tone === 'negative' ? 'text-critique' : tone === 'positive' ? 'text-conforme-deep' : 'text-ink-900',
          )}
        >
          {text}
        </span>
        {unit && <span className="text-[11px] text-ink-500">{unit}</span>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------- Barre de titre */

export function ScreenHeader({
  title, subtitle, onBack, action,
}: { title: string; subtitle?: string; onBack?: () => void; action?: ReactNode }) {
  return (
    <header className="safe-t sticky top-0 z-20 border-b border-ink-200 bg-ivoire/95 backdrop-blur">
      <div className="flex min-h-[56px] items-center gap-2 px-3">
        {onBack && (
          <button
            onClick={onBack}
            aria-label="Retour"
            className="no-select -ml-1 flex h-11 w-11 shrink-0 items-center justify-center text-[24px] text-cafe"
          >
            ‹
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-[21px] leading-tight text-cafe">{title}</h1>
          {subtitle && <p className="truncate text-[12px] text-ink-500">{subtitle}</p>}
        </div>
        {action}
      </div>
    </header>
  );
}
