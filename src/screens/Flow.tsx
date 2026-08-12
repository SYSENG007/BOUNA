import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { FLOW, STAGE_LABEL, type FlowStep } from '../domain/flow';
import { ROLE_LABEL, type Role, type Severity } from '../domain/types';
import { SyncIndicator } from '../design-system/components/SyncIndicator';
import { Badge, Card, SectionLabel, type Tone } from '../design-system/components/primitives';
import { IconChevronRight } from '../design-system/icons';

const SEVERITY_TONE: Record<Severity, Tone> = {
  INFO: 'info', ATTENTION: 'surveiller', ACTION_REQUIRED: 'surveiller', CRITICAL: 'critique',
};
const SEVERITY_LABEL: Record<Severity, string> = {
  INFO: 'Info', ATTENTION: 'À surveiller', ACTION_REQUIRED: 'Action requise', CRITICAL: 'Critique',
};

const ROLE_INITIAL: Record<Role, string> = {
  OWNER: 'O', MANAGER: 'M', PROCUREMENT: 'A', PREPARER: 'P', SELLER: 'V', FINANCE: 'F',
};

/**
 * Parcours — qui déclare quoi, ce que le système en déduit, et qui est réveillé.
 *
 * C'est la carte de lecture du produit : chaque étape montre le geste terrain,
 * la déduction automatique (marquée du filet doré) et les règles de notification
 * qui en découlent.
 */
export function Flow() {
  const navigate = useNavigate();
  const [open, setOpen] = useState<string | null>(FLOW[0].id);

  return (
    <div className="flex min-h-full flex-1 flex-col bg-ivoire">
      <SyncIndicator />

      <div className="mx-auto w-full max-w-3xl px-4 pb-28 pt-5">
        <header className="mb-5">
          <h1 className="t-h1 text-cafe">Parcours</h1>
          <p className="t-small mt-1 text-ink-500">
            Argent → achat → matière → transformation → produit → client → argent.
            Chaque geste déclaré déclenche une déduction et, parfois, quelqu'un d'autre.
          </p>
        </header>

        <ol className="relative space-y-3">
          {/* Le fil du continuum : il relie physiquement les étapes entre elles. */}
          <span
            className="absolute left-[19px] top-3 bottom-3 w-px bg-gradient-to-b from-sable via-ink-200 to-sable"
            aria-hidden
          />

          {FLOW.map((step) => (
            <FlowRow
              key={step.id}
              step={step}
              open={open === step.id}
              onToggle={() => setOpen(open === step.id ? null : step.id)}
              onGo={() => navigate(step.route)}
            />
          ))}
        </ol>
      </div>
    </div>
  );
}

function FlowRow({
  step, open, onToggle, onGo,
}: { step: FlowStep; open: boolean; onToggle: () => void; onGo: () => void }) {
  return (
    <li className="relative pl-11">
      {/* Pastille de rôle : c'est une personne qui agit, jamais « le système ». */}
      <span
        className={clsx(
          'absolute left-0 top-3 flex h-[38px] w-[38px] items-center justify-center rounded-full',
          'font-display text-[15px] transition-colors',
          open ? 'bg-cafe text-sable-pale' : 'bg-sable-pale text-brun ring-1 ring-sable',
        )}
        title={ROLE_LABEL[step.actor]}
      >
        {ROLE_INITIAL[step.actor]}
      </span>

      <Card padded={false} className={clsx('overflow-hidden', open && 'border-sable')}>
        <button
          onClick={onToggle}
          aria-expanded={open}
          className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors active:bg-sable-pale"
        >
          <span className="min-w-0 flex-1">
            <span className="label-section block">
              {STAGE_LABEL[step.stage]} · {ROLE_LABEL[step.actor]}
            </span>
            {/* Le geste, à la première personne — c'est la philosophie du produit. */}
            <span className="mt-1 block font-display text-[17px] leading-snug text-ink-900">
              « {step.declares} »
            </span>
          </span>
          <IconChevronRight
            size={18}
            className={clsx('mt-1 shrink-0 text-ink-300 transition-transform', open && 'rotate-90')}
          />
        </button>

        {open && (
          <div className="space-y-4 border-t border-ink-100 px-4 py-4">
            <div>
              <SectionLabel className="mb-1.5">Événement émis</SectionLabel>
              <span className="num inline-block rounded-[4px] bg-ink-100 px-2 py-1 text-[12px] text-ink-700">
                {step.event}
              </span>
            </div>

            {/* Filet doré : tout ce bloc est déduit, jamais saisi. */}
            <div className="derived">
              <SectionLabel className="mb-1.5">Ce que le système déduit</SectionLabel>
              <ul className="space-y-1">
                {step.derives.map((d) => (
                  <li key={d} className="t-small text-ink-700">{d}</li>
                ))}
              </ul>
            </div>

            <div>
              <SectionLabel className="mb-2">Qui est réveillé</SectionLabel>
              <div className="space-y-2">
                {step.triggers.map((t) => (
                  <div key={t.condition} className="rounded-[6px] border border-ink-100 bg-ivoire px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={SEVERITY_TONE[t.severity]}>{SEVERITY_LABEL[t.severity]}</Badge>
                      <span className="num text-[12px] text-ink-500">si {t.condition}</span>
                    </div>
                    <p className="mt-1.5 t-small text-ink-800">{t.action}</p>
                    <p className="mt-1 text-[12px] text-ink-500">
                      → {t.recipients.map((r) => ROLE_LABEL[r]).join(', ')}
                      {t.cooldownMinutes > 0 && ` · pas de rappel avant ${t.cooldownMinutes} min`}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <button
              onClick={onGo}
              className="t-small font-medium text-brun underline underline-offset-4"
            >
              Ouvrir l'écran
            </button>
          </div>
        )}
      </Card>
    </li>
  );
}
