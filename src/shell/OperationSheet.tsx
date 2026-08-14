import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useBuna } from '../store/BunaStore';
import { operationsByFeature, type Operation } from '../features/registry';
import { IconClose } from '../design-system/icons';

const RECENT_KEY = 'buna.recent-operations';

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function rememberOperation(id: string) {
  try {
    const next = [id, ...readRecent().filter((x) => x !== id)].slice(0, 3);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* Un stockage indisponible ne doit pas empêcher de travailler. */
  }
}

/**
 * Le tiroir d'opérations — le point d'entrée unique de toute déclaration.
 *
 * C'est ici que la polyvalence se résout. Quelqu'un qui tient trois capacités
 * et quelqu'un qui en tient quinze appuient sur le même bouton, au même
 * endroit ; seule la liste change. Les trois derniers gestes remontent en tête,
 * parce qu'au comptoir on refait souvent la même chose.
 *
 * Les consultations sont dans un second groupe, plus bas : on ouvre ce tiroir
 * pour déclarer quelque chose, pas pour regarder.
 */
export function OperationSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useBuna();
  const navigate = useNavigate();
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    if (open) setRecent(readRecent());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const capabilities = user?.capabilities ?? [];
  const declareGroups = useMemo(() => operationsByFeature(capabilities, true, true), [capabilities]);
  const consultGroups = useMemo(() => operationsByFeature(capabilities, false, true), [capabilities]);

  const recentOps = useMemo(() => {
    const all = declareGroups.flatMap((g) => g.operations);
    return recent.map((id) => all.find((o) => o.id === id)).filter((o): o is Operation => !!o);
  }, [recent, declareGroups]);

  if (!open) return null;

  const go = (op: Operation) => {
    if (!op.to) return;
    rememberOperation(op.id);
    onClose();
    navigate(op.to);
  };

  const empty = declareGroups.length === 0 && consultGroups.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Fermer"
        onClick={onClose}
        className="absolute inset-0 bg-cafe/45 backdrop-blur-[2px]"
      />
      <div className="safe-b relative flex max-h-[85dvh] w-full max-w-lg flex-col rounded-t-[16px] bg-ivoire sm:rounded-[16px]"
        style={{ boxShadow: 'var(--shadow-e2)' }}>
        <header className="flex items-center justify-between border-b border-ink-200 px-4 py-3.5">
          <div>
            <h2 className="font-display text-[20px] leading-tight text-cafe">Déclarer</h2>
            <p className="text-[12px] text-ink-500">Tout ce que vous pouvez enregistrer</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-[var(--spacing-touch)] w-[var(--spacing-touch)] items-center justify-center rounded-[6px] text-ink-500 hover:bg-ink-100"
          >
            <IconClose size={20} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {empty && (
            <p className="py-8 text-center text-[14px] leading-relaxed text-ink-500">
              Aucune opération ne vous est encore ouverte.<br />
              Demandez à votre manager de vous accorder des accès.
            </p>
          )}

          {recentOps.length > 0 && (
            <Group title="Vos derniers gestes">
              {recentOps.map((op) => <Row key={`recent-${op.id}`} op={op} onPick={go} />)}
            </Group>
          )}

          {declareGroups.map(({ feature, operations }) => (
            <Group key={feature.id} title={feature.label}>
              {operations.map((op) => <Row key={op.id} op={op} onPick={go} />)}
            </Group>
          ))}

          {consultGroups.length > 0 && (
            <>
              <div className="mb-2 mt-6 border-t border-ink-200 pt-4">
                <span className="label-section text-ink-500">Consulter</span>
              </div>
              {consultGroups.map(({ feature, operations }) => (
                <Group key={`c-${feature.id}`} title={feature.label}>
                  {operations.map((op) => <Row key={op.id} op={op} onPick={go} />)}
                </Group>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-4 last:mb-0">
      <h3 className="label-section mb-1.5 text-ink-500">{title}</h3>
      <div className="overflow-hidden rounded-[8px] border border-ink-200 bg-surface">{children}</div>
    </section>
  );
}

function Row({ op, onPick }: { op: Operation; onPick: (op: Operation) => void }) {
  const { Icon } = op;
  return (
    <button
      type="button"
      onClick={() => onPick(op)}
      className={clsx(
        'flex w-full items-center gap-3 border-b border-ink-100 px-3.5 text-left last:border-b-0',
        'min-h-[var(--spacing-counter)] py-2.5 transition-colors hover:bg-sable-pale/50',
      )}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] bg-sable-pale text-brun">
        <Icon size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px] font-medium text-ink-900">{op.label}</span>
        <span className="block truncate text-[12px] text-ink-500">{op.hint}</span>
      </span>
    </button>
  );
}
