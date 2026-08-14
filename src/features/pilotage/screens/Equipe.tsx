import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBuna } from '../../../store/BunaStore';
import type { Capability } from '../../../domain/capabilities';
import { CAPABILITY_LABEL, POST_LABEL, POST_PRESET, effectiveCapabilities } from '../../../domain/capabilities';
import { capabilitiesByFeature } from '../../registry';
import { ScreenHeader } from '../../../design-system/components/patterns';
import { Badge, Button, Card, SectionLabel } from '../../../design-system/components/primitives';
import { IconCheck } from '../../../design-system/icons';

/**
 * L'écran où le manager accorde et retire les accès.
 *
 * Il lit le même registre que le tiroir d'opérations, et affiche les mêmes
 * libellés : le manager coche « Réceptionner une livraison », exactement ce que
 * l'utilisateur lira. C'est ce qui rend la délégation compréhensible sans
 * notice — et vérifiable après coup, puisque chaque accord est daté et signé.
 *
 * Le poste n'est plus un droit : il n'est ici qu'une étiquette, et un bouton
 * pour repartir de son préréglage quand on s'est perdu dans les cases.
 */
export function Equipe() {
  const { users, user, grants, grantCapabilities, revokeCapabilities } = useBuna();
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState<string>(users[0]?.id ?? '');

  const member = users.find((u) => u.id === selectedId) ?? users[0];
  const held = useMemo(
    () => new Set(effectiveCapabilities(grants, member?.id ?? '')),
    [grants, member?.id],
  );

  const journal = useMemo(
    () => grants
      .filter((g) => g.userId === member?.id)
      .sort((a, b) => (b.revokedAt ?? b.grantedAt).localeCompare(a.revokedAt ?? a.grantedAt))
      .slice(0, 12),
    [grants, member?.id],
  );

  if (!member) return null;

  const toggle = (capability: Capability) => {
    if (held.has(capability)) revokeCapabilities(member.id, [capability]);
    else grantCapabilities(member.id, [capability]);
  };

  const applyPreset = () => {
    const preset = POST_PRESET[member.post];
    const missing = preset.filter((c) => !held.has(c));
    if (missing.length) grantCapabilities(member.id, [...missing]);
  };

  const isSelf = member.id === user?.id;

  return (
    <div className="flex min-h-full flex-1 flex-col bg-ivoire">
      <ScreenHeader title="Équipe" subtitle="Qui peut faire quoi" onBack={() => navigate(-1)} />

      <main className="flex-1 space-y-5 px-4 pb-28 pt-4 lg:mx-auto lg:max-w-3xl lg:px-0">
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:px-0">
          {users.map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => setSelectedId(u.id)}
              className={`flex min-h-[var(--spacing-touch)] shrink-0 items-center gap-2 rounded-[6px] border px-3 text-[13.5px] transition-colors ${
                u.id === member.id
                  ? 'border-cafe bg-cafe text-sable-pale'
                  : 'border-ink-200 bg-surface text-ink-700 hover:bg-sable-pale/40'
              }`}
            >
              <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] ${
                u.id === member.id ? 'bg-cafe-soft' : 'bg-sable-pale text-cafe'
              }`}>
                {u.name.charAt(0)}
              </span>
              {u.name.split(' ')[0]}
            </button>
          ))}
        </div>

        <Card className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-display text-[20px] leading-tight text-cafe">{member.name}</div>
              <div className="text-[12.5px] text-ink-500">
                {POST_LABEL[member.post]} · {held.size} accès accordé{held.size > 1 ? 's' : ''}
              </div>
            </div>
            <Badge tone={member.status === 'ACTIVE' ? 'conforme' : 'critique'}>
              {member.status === 'ACTIVE' ? 'Actif' : 'Désactivé'}
            </Badge>
          </div>
          <p className="text-[12.5px] leading-relaxed text-ink-500">
            Le poste ne décide pas des accès : il en propose un jeu de départ. Tout ce qui est
            coché ci-dessous a été accordé par quelqu'un, et peut être retiré.
          </p>
          <Button onClick={applyPreset}>
            Repartir du préréglage {POST_LABEL[member.post].toLowerCase()}
          </Button>
        </Card>

        {capabilitiesByFeature().map(({ feature, rows }) => (
          <section key={feature.id}>
            <SectionLabel className="mb-2">{feature.label}</SectionLabel>
            <Card padded={false}>
              {rows.map((row) => {
                const on = held.has(row.capability);
                const locked = isSelf && row.capability === 'MANAGE_TEAM';
                return (
                  <button
                    key={row.capability}
                    type="button"
                    disabled={locked}
                    onClick={() => toggle(row.capability)}
                    className={`flex w-full items-start gap-3 border-b border-ink-100 px-4 py-3 text-left last:border-b-0 transition-colors ${
                      locked ? 'cursor-not-allowed opacity-60' : 'hover:bg-sable-pale/40'
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[4px] border transition-colors ${
                        on ? 'border-cafe bg-cafe text-sable-pale' : 'border-ink-300 bg-surface'
                      }`}
                    >
                      {on && <IconCheck size={14} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14.5px] text-ink-900">{row.label}</span>
                      <span className="block text-[12px] leading-snug text-ink-500">{row.hint}</span>
                      {locked && (
                        <span className="mt-1 block text-[11.5px] text-surveiller">
                          On ne se retire pas ce droit à soi-même : plus personne ne pourrait le redonner.
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </Card>
          </section>
        ))}

        <section>
          <SectionLabel className="mb-2">Journal des accès</SectionLabel>
          <Card padded={false}>
            {journal.length === 0 ? (
              <p className="px-4 py-4 text-[13.5px] text-ink-500">Aucun accord enregistré.</p>
            ) : (
              journal.map((g) => (
                <div key={g.id} className="border-b border-ink-100 px-4 py-2.5 last:border-b-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[13.5px] text-ink-900">{CAPABILITY_LABEL[g.capability]}</span>
                    <Badge tone={g.revokedAt ? 'critique' : 'conforme'}>
                      {g.revokedAt ? 'retiré' : 'accordé'}
                    </Badge>
                  </div>
                  <div className="text-[11.5px] text-ink-500">
                    {g.revokedAt
                      ? `par ${g.revokedByName ?? '—'} le ${new Date(g.revokedAt).toLocaleDateString('fr-FR')}`
                      : `par ${g.grantedByName} le ${new Date(g.grantedAt).toLocaleDateString('fr-FR')}`}
                  </div>
                </div>
              ))
            )}
          </Card>
        </section>
      </main>
    </div>
  );
}
