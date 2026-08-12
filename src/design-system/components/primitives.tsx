import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import clsx from 'clsx';

/* =================================================================
   BUNA — primitives d'interface
   « Une seule action pleine par écran. Elle dit ce qu'elle fait —
     "Encaisser", jamais "Valider". »
   ================================================================= */

/* ------------------------------------------------------------ Marque */

export function BunaMark({ size = 34, gold = true }: { size?: number; gold?: boolean }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-brun"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <div
        className={clsx('rounded-full', gold ? 'bg-or' : 'bg-sable')}
        style={{ width: size * 0.3, height: size * 0.3 }}
      />
    </div>
  );
}

export function BunaWordmark({ subtitle, light = false }: { subtitle?: string; light?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <BunaMark />
      <div>
        <div
          className={clsx('font-display text-[17px] tracking-[0.3em]', light ? 'text-sable-pale' : 'text-cafe')}
        >
          BUNA
        </div>
        {subtitle && (
          <div className="num mt-0.5 text-[10px] tracking-[0.14em] text-ink-400">{subtitle}</div>
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- Boutons */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'counter' | 'base' | 'compact';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  full?: boolean;
}

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-cafe text-sable-pale hover:bg-brun active:bg-brun-deep disabled:bg-ink-200 disabled:text-ink-400',
  secondary: 'bg-surface text-cafe border border-ink-200 hover:border-brun active:bg-sable-pale',
  ghost: 'bg-transparent text-brun hover:text-or-ink underline-offset-4 hover:underline',
  danger: 'bg-surface text-critique border border-critique/40 hover:bg-critique-pale',
};

/* Cibles tactiles : 44 px minimum, 56 px pour les actions du comptoir. */
const SIZE: Record<ButtonSize, string> = {
  counter: 'min-h-[56px] px-6 text-[16px] font-medium',
  base: 'min-h-[44px] px-5 text-[15px] font-medium',
  compact: 'min-h-[36px] px-3 text-[13px]',
};

export function Button({
  variant = 'secondary', size = 'base', full, className, children, ...rest
}: ButtonProps) {
  return (
    <button
      className={clsx(
        'no-select inline-flex items-center justify-center gap-2 rounded-[6px]',
        'transition-colors duration-100 disabled:cursor-not-allowed',
        VARIANT[variant], SIZE[size], full && 'w-full', className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------ Champs */

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('label-section', className)}>{children}</div>;
}

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
  suffix?: string;
}

export function Field({ label, hint, error, suffix, className, ...rest }: FieldProps) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-ink-700">{label}</span>
      <span className="relative block">
        <input
          className={clsx(
            'min-h-[48px] w-full rounded-[4px] border bg-surface px-3.5 text-[15px] text-ink-900',
            'placeholder:text-ink-400 focus:outline-none focus:ring-0',
            error ? 'border-critique' : 'border-ink-200 focus:border-brun',
            suffix && 'pr-14',
            className,
          )}
          {...rest}
        />
        {suffix && (
          <span className="num absolute right-3.5 top-1/2 -translate-y-1/2 text-[13px] text-ink-500">
            {suffix}
          </span>
        )}
      </span>
      {/* Un état n'est jamais porté par la couleur seule — toujours doublé d'un mot. */}
      {error ? (
        <span className="mt-1 block text-[12px] text-critique">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-[12px] text-ink-500">{hint}</span>
      ) : null}
    </label>
  );
}

export function SelectField({
  label, value, onChange, options, hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-ink-700">{label}</span>
      <span className="relative block">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-[48px] w-full appearance-none rounded-[4px] border border-ink-200 bg-surface px-3.5 pr-10 text-[15px] text-ink-900 focus:border-brun focus:outline-none"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-ink-500">▾</span>
      </span>
      {hint && <span className="mt-1 block text-[12px] text-ink-500">{hint}</span>}
    </label>
  );
}

/* ---------------------------------------------- Quantité — un geste */

export function NumberStepper({
  value, onChange, unit = 'unités', min = 0, max = 9999,
}: {
  value: number;
  onChange: (v: number) => void;
  unit?: string;
  min?: number;
  max?: number;
}) {
  const step = (delta: number) => onChange(Math.min(max, Math.max(min, value + delta)));
  return (
    <div className="flex items-stretch overflow-hidden rounded-[6px] border border-ink-200 bg-surface">
      <button
        type="button"
        onClick={() => step(-1)}
        aria-label="Diminuer"
        className="no-select w-[56px] shrink-0 text-[22px] text-cafe transition-colors active:bg-sable-pale"
      >
        −
      </button>
      <div className="flex flex-1 items-baseline justify-center gap-1.5 border-x border-ink-100 py-3">
        <span className="num text-[30px] leading-none text-ink-900">{value}</span>
        <span className="text-[13px] text-ink-500">{unit}</span>
      </div>
      <button
        type="button"
        onClick={() => step(1)}
        aria-label="Augmenter"
        className="no-select w-[56px] shrink-0 text-[22px] text-cafe transition-colors active:bg-sable-pale"
      >
        +
      </button>
    </div>
  );
}

/* ------------------------------------------------------ États & badges */

export type Tone = 'neutral' | 'conforme' | 'surveiller' | 'critique' | 'info' | 'brouillon';

const TONE: Record<Tone, string> = {
  neutral: 'bg-ink-100 text-ink-700',
  conforme: 'bg-conforme-pale text-conforme-deep',
  surveiller: 'bg-surveiller-pale text-or-ink',
  critique: 'bg-critique-pale text-critique-deep',
  info: 'bg-info-pale text-info-deep',
  brouillon: 'bg-transparent text-ink-500 border border-dashed border-ink-300',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-[4px] px-2 py-1 text-[12px] font-medium whitespace-nowrap',
        TONE[tone],
      )}
    >
      {children}
    </span>
  );
}

/* --------------------------------------------------------- Surfaces */

export function Card({
  children, className, padded = true,
}: { children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <div
      className={clsx(
        'rounded-[8px] border border-ink-200 bg-surface',
        padded && 'p-4',
        className,
      )}
      style={{ boxShadow: 'var(--shadow-e1)' }}
    >
      {children}
    </div>
  );
}

export function Divider() {
  return <div className="h-px w-full bg-ink-100" />;
}

/* ------------------------------------------------- Onglets segmentés */

export function Segmented<T extends string>({
  value, onChange, options,
}: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="no-select inline-flex rounded-[6px] border border-ink-200 bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={clsx(
            'min-h-[36px] rounded-[4px] px-3.5 text-[13px] font-medium transition-colors',
            value === o.value ? 'bg-cafe text-sable-pale' : 'text-ink-600 hover:text-cafe',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------- États vides */

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <BunaMark size={40} gold={false} />
      <div className="font-display text-[20px] text-cafe">{title}</div>
      <p className="max-w-xs text-[14px] leading-relaxed text-ink-500">{body}</p>
      {action}
    </div>
  );
}
