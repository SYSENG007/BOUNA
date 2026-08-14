/**
 * Primitives graphiques — SVG écrit à la main, sur les tokens de la charte.
 *
 * Aucune dépendance : sur une PWA hors-ligne, 90 Ko de librairie de graphes se
 * paient au premier chargement, sur un réseau qu'on ne maîtrise pas.
 *
 * Une règle traverse le fichier : **une absence de donnée n'est pas un zéro.**
 * `analytics.ts` distingue déjà « journée sans vente » de « journée jamais
 * saisie » ; un graphique qui traçerait un point à zéro pour la seconde
 * fabriquerait une information fausse. Une absence se rend en hachure, jamais
 * en valeur.
 *
 * L'or reste un accent rare : il porte le filet `.derived`, jamais une série.
 */

import type { ReactNode } from 'react';

/** Une valeur qui peut ne pas exister. `null` = pas de donnée, pas « zéro ». */
export type Point = number | null;

const INK = 'var(--color-ink-300)';
const AXIS = 'var(--color-ink-200)';

/** Hachure grise : la marque visuelle d'une absence de saisie. */
function Hatch({ id }: { id: string }) {
  return (
    <defs>
      <pattern id={id} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="5" height="5" fill="var(--color-ink-100)" />
        <line x1="0" y1="0" x2="0" y2="5" stroke="var(--color-ink-200)" strokeWidth="1.6" />
      </pattern>
    </defs>
  );
}

function extent(values: Point[]): { min: number; max: number } {
  const known = values.filter((v): v is number => v !== null);
  if (!known.length) return { min: 0, max: 1 };
  const min = Math.min(0, ...known);
  const max = Math.max(...known);
  return { min, max: max === min ? min + 1 : max };
}

/* ==================================================================== 1 */

/**
 * Tendance dans une tuile de KPI. Volontairement sans axe ni valeur : elle dit
 * une direction, pas une quantité — le chiffre est juste à côté.
 */
export function Sparkline({
  points, width = 64, height = 20, tone = 'brun',
}: {
  points: Point[];
  width?: number;
  height?: number;
  tone?: 'brun' | 'conforme' | 'critique';
}) {
  const known = points.filter((v): v is number => v !== null);
  if (known.length < 2) return null;

  const { min, max } = extent(points);
  const step = width / Math.max(1, points.length - 1);
  const y = (v: number) => height - 1 - ((v - min) / (max - min)) * (height - 2);

  // Les trous coupent le trait : relier deux points de part et d'autre d'une
  // journée non saisie inventerait une continuité qui n'a pas été observée.
  const segments: string[] = [];
  let current: string[] = [];
  points.forEach((v, i) => {
    if (v === null) {
      if (current.length > 1) segments.push(current.join(' '));
      current = [];
      return;
    }
    current.push(`${current.length ? 'L' : 'M'}${(i * step).toFixed(1)} ${y(v).toFixed(1)}`);
  });
  if (current.length > 1) segments.push(current.join(' '));

  const last = points[points.length - 1];

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="overflow-visible">
      {segments.map((d, i) => (
        <path key={i} d={d} fill="none" stroke={`var(--color-${tone})`} strokeWidth="1.5"
          strokeLinecap="round" strokeLinejoin="round" />
      ))}
      {last !== null && last !== undefined && (
        <circle cx={width} cy={y(last)} r="2" fill={`var(--color-${tone})`} />
      )}
    </svg>
  );
}

/* ==================================================================== 2 */

export interface SeriesBar {
  label: string;
  value: Point;
  /** Même période, cran précédent — tracé en fantôme derrière. */
  compare?: Point;
}

/**
 * Série temporelle. La période précédente est un fantôme gris derrière la
 * barre : la comparaison doit se lire sans changer d'écran, et sans qu'on
 * puisse confondre les deux.
 */
export function BarSeries({
  data, height = 132, format, label,
}: {
  data: SeriesBar[];
  height?: number;
  format: (n: number) => string;
  label?: string;
}) {
  const { max } = extent([...data.map((d) => d.value), ...data.map((d) => d.compare ?? null)]);
  const hatchId = 'hatch-bars';
  const hasAny = data.some((d) => d.value !== null);

  if (!hasAny) {
    return <EmptyChart height={height} message="Aucune journée saisie sur cette période." />;
  }

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${data.length * 10} ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
        role="img"
        aria-label={label ?? 'Série temporelle'}
      >
        <Hatch id={hatchId} />
        {data.map((d, i) => {
          const x = i * 10;
          const cmp = d.compare ?? null;
          const h = d.value === null ? height - 16 : ((d.value / max) * (height - 16)) || 1;
          const ch = cmp === null ? 0 : ((cmp / max) * (height - 16)) || 0;
          return (
            <g key={d.label}>
              {ch > 0 && (
                <rect x={x + 1.4} y={height - 16 - ch} width="7.2" height={ch}
                  fill={INK} opacity="0.42" rx="0.6" />
              )}
              <rect
                x={x + 2.6} y={height - 16 - h} width="4.8" height={h} rx="0.6"
                fill={d.value === null ? `url(#${hatchId})` : 'var(--color-cafe)'}
              />
            </g>
          );
        })}
        <line x1="0" y1={height - 16} x2={data.length * 10} y2={height - 16} stroke={AXIS} strokeWidth="0.4" />
      </svg>
      <figcaption className="mt-1.5 flex justify-between text-[10.5px] text-ink-500">
        <span>{data[0]?.label}</span>
        <span className="num">max {format(max)}</span>
        <span>{data[data.length - 1]?.label}</span>
      </figcaption>
    </figure>
  );
}

/* ==================================================================== 3 */

export type BarTone = 'cafe' | 'conforme' | 'surveiller' | 'critique' | 'info';

export interface HBarRow {
  label: string;
  value: number;
  tone?: BarTone;
  /** Texte à droite — souvent le montant formaté. */
  right?: ReactNode;
}

/** Classement. Les barres partent toutes de la même gauche : on compare des longueurs. */
export function HBars({ rows, max: forcedMax }: { rows: HBarRow[]; max?: number }) {
  const max = forcedMax ?? Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {rows.map((r) => (
        <li key={r.label} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="truncate text-ink-800">{r.label}</span>
            <span className="num shrink-0 text-[12.5px] text-ink-600">{r.right}</span>
          </div>
          <div className="h-[6px] w-full overflow-hidden rounded-full bg-ink-100">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max(2, (Math.abs(r.value) / max) * 100)}%`,
                background: `var(--color-${r.tone ?? 'cafe'})`,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ==================================================================== 4 */

export interface Slice {
  label: string;
  value: number;
  tone?: BarTone;
}

const DONUT_TONES: BarTone[] = ['cafe', 'info', 'conforme', 'surveiller', 'critique'];

/**
 * Répartition. Cinq parts au maximum, le reste devient « Autres » : au-delà,
 * l'œil ne compare plus des angles, il regarde un camembert.
 */
export function Donut({
  slices, size = 132, center,
}: {
  slices: Slice[];
  size?: number;
  center?: ReactNode;
}) {
  const sorted = [...slices].filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  const head = sorted.slice(0, 5);
  const tail = sorted.slice(5);
  const rows: Slice[] = tail.length
    ? [...head, { label: 'Autres', value: tail.reduce((s, x) => s + x.value, 0), tone: 'info' as BarTone }]
    : head;

  const total = rows.reduce((s, x) => s + x.value, 0);
  if (total <= 0) return <EmptyChart height={size} message="Rien à répartir sur cette période." />;

  const r = size / 2 - 11;
  const circumference = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Répartition">
          <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
            {rows.map((s, i) => {
              const length = (s.value / total) * circumference;
              const el = (
                <circle
                  key={s.label}
                  cx={size / 2} cy={size / 2} r={r}
                  fill="none"
                  stroke={`var(--color-${s.tone ?? DONUT_TONES[i % DONUT_TONES.length]})`}
                  strokeWidth="14"
                  strokeDasharray={`${length} ${circumference - length}`}
                  strokeDashoffset={-offset}
                />
              );
              offset += length;
              return el;
            })}
          </g>
        </svg>
        {center && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            {center}
          </div>
        )}
      </div>
      <ul className="m-0 flex min-w-[8rem] flex-1 list-none flex-col gap-1.5 p-0">
        {rows.map((s, i) => (
          <li key={s.label} className="flex items-center gap-2 text-[12.5px]">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
              style={{ background: `var(--color-${s.tone ?? DONUT_TONES[i % DONUT_TONES.length]})` }}
            />
            <span className="flex-1 truncate text-ink-700">{s.label}</span>
            <span className="num text-ink-900">{Math.round((s.value / total) * 100)} %</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ==================================================================== 5 */

export interface HourCell {
  hour: number;
  /** Marge nette de l'heure. Négative : l'heure ne couvre pas ses charges. */
  value: number;
  /** Absente du tableau = heure fermée. On la laisse en hachure. */
  open: boolean;
}

/**
 * Rentabilité heure par heure, de 6 h à 23 h.
 *
 * Une heure fermée n'est pas une heure à zéro : elle est hachurée. C'est la
 * différence entre « on n'a rien gagné » et « on n'était pas là ».
 */
export function HourStrip({ hours, format }: { hours: HourCell[]; format: (n: number) => string }) {
  const from = 6;
  const to = 23;
  const cells = Array.from({ length: to - from + 1 }, (_, i) => {
    const hour = from + i;
    return hours.find((h) => h.hour === hour) ?? { hour, value: 0, open: false };
  });
  const max = Math.max(1, ...cells.map((c) => Math.abs(c.value)));
  const best = cells.filter((c) => c.open).sort((a, b) => b.value - a.value)[0];
  const worst = cells.filter((c) => c.open).sort((a, b) => a.value - b.value)[0];

  return (
    <figure className="m-0">
      <div className="flex items-end gap-[3px]" style={{ height: 96 }}>
        {cells.map((c) => {
          const h = c.open ? Math.max(3, (Math.abs(c.value) / max) * 84) : 84;
          const negative = c.value < 0;
          return (
            <div key={c.hour} className="flex flex-1 flex-col items-center justify-end gap-1">
              <div
                className="w-full rounded-[2px]"
                style={{
                  height: h,
                  background: !c.open
                    ? 'repeating-linear-gradient(45deg, var(--color-ink-100) 0 3px, var(--color-ink-200) 3px 4px)'
                    : negative
                      ? 'var(--color-critique)'
                      : 'var(--color-conforme)',
                }}
                title={c.open ? `${c.hour} h · ${format(c.value)}` : `${c.hour} h · fermé`}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[10.5px] text-ink-500">
        <span className="num">{from} h</span>
        <span className="num">{to} h</span>
      </div>
      {best && worst && best.hour !== worst.hour && (
        <figcaption className="mt-2 text-[12.5px] leading-relaxed text-ink-600">
          Meilleure heure <strong className="num text-ink-900">{best.hour} h</strong> ({format(best.value)}) ·
          {' '}la plus faible <strong className="num text-ink-900">{worst.hour} h</strong> ({format(worst.value)}).
        </figcaption>
      )}
    </figure>
  );
}

/* ==================================================================== 6 */

/**
 * Écart signé autour de zéro. Le zéro est au centre et il est marqué : un
 * écart se lit par rapport à lui, pas par rapport au bord du composant.
 */
export function VarianceBar({
  value, max, format,
}: {
  value: number;
  max: number;
  /** Formate une MAGNITUDE : le signe est rendu par le composant. */
  format: (n: number) => string;
}) {
  const bound = Math.max(1, max);
  const ratio = Math.min(1, Math.abs(value) / bound);
  const negative = value < 0;
  const tone = value === 0 ? 'conforme' : negative ? 'critique' : 'surveiller';

  return (
    <div className="flex items-center gap-3">
      <div className="relative h-[10px] flex-1 rounded-full bg-ink-100">
        <span className="absolute left-1/2 top-[-3px] h-[16px] w-px -translate-x-1/2 bg-ink-300" />
        <div
          className="absolute top-0 h-full rounded-full"
          style={{
            width: `${ratio * 50}%`,
            [negative ? 'right' : 'left']: '50%',
            background: `var(--color-${tone})`,
          }}
        />
      </div>
      <span className={`num shrink-0 text-[13px] text-${tone}`}>
        {/* Un écart négatif doit se lire négatif : sans le signe, « il manque
            2,1 kg » et « il y en a 2,1 de trop » s'écrivent pareil. */}
        {value > 0 ? '+' : value < 0 ? '−' : ''}{format(Math.abs(value))}
      </span>
    </div>
  );
}

/* ================================================================ Vide */

export function EmptyChart({ height = 120, message }: { height?: number; message: string }) {
  return (
    <div
      className="flex items-center justify-center rounded-[6px] px-4 text-center text-[12.5px] leading-relaxed text-ink-500"
      style={{
        height,
        background: 'repeating-linear-gradient(45deg, var(--color-ink-100) 0 5px, transparent 5px 10px)',
      }}
    >
      {message}
    </div>
  );
}
