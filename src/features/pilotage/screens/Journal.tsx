import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBuna } from '../../../store/BunaStore';
import { actorDate } from '../../../domain/actor';
import { ScreenHeader } from '../../../design-system/components/patterns';
import { ActorStamp } from '../../../design-system/components/ActorStamp';
import { Card, SectionLabel } from '../../../design-system/components/primitives';

/**
 * Le journal — chaque opération, son auteur, et sous quelle autorisation.
 *
 * Le filtre par personne est le point : « qui a réceptionné mardi matin ? » est
 * une question qu'on pose vraiment, et à laquelle il fallait jusqu'ici répondre
 * de mémoire. Rien ne s'y supprime.
 */
export function Journal() {
  const { state } = useBuna();
  const navigate = useNavigate();
  const [who, setWho] = useState<string>('ALL');

  const people = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of state.audit) map.set(a.actor.userId, a.actor.userName);
    return [...map.entries()];
  }, [state.audit]);

  const rows = useMemo(
    () => state.audit.filter((a) => who === 'ALL' || a.actor.userId === who),
    [state.audit, who],
  );

  /* Regroupé par jour : une liste plate de 200 lignes ne se lit pas. */
  const byDay = useMemo(() => {
    const groups = new Map<string, typeof rows>();
    for (const a of rows) {
      const key = actorDate(a.actor) || '—';
      groups.set(key, [...(groups.get(key) ?? []), a]);
    }
    return [...groups.entries()];
  }, [rows]);

  return (
    <div className="flex min-h-full flex-1 flex-col bg-ivoire">
      <ScreenHeader title="Journal" subtitle={`${rows.length} opération${rows.length > 1 ? 's' : ''}`} onBack={() => navigate(-1)} />

      <main className="flex-1 space-y-4 px-4 pb-28 pt-4 lg:mx-auto lg:max-w-3xl lg:px-0">
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:px-0">
          <Chip label="Toute l'équipe" on={who === 'ALL'} onClick={() => setWho('ALL')} />
          {people.map(([id, name]) => (
            <Chip key={id} label={name.split(' ')[0]} on={who === id} onClick={() => setWho(id)} />
          ))}
        </div>

        {byDay.length === 0 ? (
          <Card>
            <p className="text-[14px] text-ink-500">Aucune opération enregistrée pour ce filtre.</p>
          </Card>
        ) : (
          byDay.map(([day, items]) => (
            <section key={day}>
              <SectionLabel className="mb-2">{day}</SectionLabel>
              <Card padded={false}>
                {items.map((a) => (
                  <div key={a.id} className="border-b border-ink-100 px-4 py-3 last:border-b-0">
                    <div className="text-[14px] text-ink-900">{a.action}</div>
                    {a.detail && <div className="text-[12.5px] leading-snug text-ink-500">{a.detail}</div>}
                    <ActorStamp actor={a.actor} showCapability className="mt-1" />
                  </div>
                ))}
              </Card>
            </section>
          ))
        )}
      </main>
    </div>
  );
}

function Chip({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-[var(--spacing-touch)] shrink-0 rounded-[6px] border px-3 text-[13.5px] transition-colors ${
        on ? 'border-cafe bg-cafe text-sable-pale' : 'border-ink-200 bg-surface text-ink-700 hover:bg-sable-pale/40'
      }`}
    >
      {label}
    </button>
  );
}
