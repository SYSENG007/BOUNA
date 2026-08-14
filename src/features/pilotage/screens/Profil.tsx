import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBuna } from '../../../store/BunaStore';
import { POST_LABEL } from '../../../domain/capabilities';
import { clearState } from '../../../store/persist';
import { capabilitiesByFeature, operationsByFeature } from '../../registry';
import { SyncIndicator } from '../../../design-system/components/SyncIndicator';
import { Badge, Button, Card, SectionLabel } from '../../../design-system/components/primitives';
import { BunaLogo } from '../../../design-system/components/BunaLogo';

/**
 * Le profil.
 *
 * Il répond à deux questions : « qui suis-je dans cette équipe ? » et
 * « qu'est-ce que je peux faire ? ». La seconde était invisible jusqu'ici —
 * quelqu'un qui ne trouvait pas un écran ne pouvait pas savoir s'il ne l'avait
 * pas ou s'il cherchait mal. Les accès sont donc listés, avec de quoi les
 * réclamer.
 */
export function Profil() {
  const { user, state, logout, pending, online, lastSyncAt, syncNow, can } = useBuna();
  const navigate = useNavigate();
  const [showAdvanced, setShowAdvanced] = useState(false);

  /* Les raccourcis parlent de gestes, la liste des accès parle de droits. */
  const shortcutGroups = useMemo(
    () => operationsByFeature(user?.capabilities ?? [], true, true),
    [user?.capabilities],
  );
  const accessGroups = useMemo(
    () => capabilitiesByFeature(user?.capabilities ?? []),
    [user?.capabilities],
  );

  if (!user) return null;

  const shortcuts = shortcutGroups.flatMap((g) => g.operations).slice(0, 6);

  return (
    <div className="flex min-h-full flex-1 flex-col bg-ivoire">
      <SyncIndicator />

      <main className="flex-1 space-y-5 px-4 pb-28 pt-4 lg:mx-auto lg:max-w-2xl lg:px-0">
        <div className="flex items-center justify-end">
          <BunaLogo size={38} />
        </div>

        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-cafe font-display text-[22px] text-sable-pale">
            {user.name.charAt(0)}
          </span>
          <div>
            <h1 className="font-display text-[24px] leading-tight text-cafe">{user.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge tone="conforme">{POST_LABEL[user.post]}</Badge>
              <span className="text-[12px] text-ink-500">
                {user.capabilities.length} accès accordé{user.capabilities.length > 1 ? 's' : ''}
              </span>
            </div>
          </div>
        </div>

        {shortcuts.length > 0 && (
          <Card className="space-y-3">
            <SectionLabel>Ce que vous faites le plus</SectionLabel>
            <div className="grid grid-cols-2 gap-2">
              {shortcuts.map((op) => (
                <Button key={op.id} onClick={() => navigate(op.to!)}>{op.label}</Button>
              ))}
            </div>
          </Card>
        )}

        <Card className="space-y-3">
          <SectionLabel>Vos accès</SectionLabel>
          {accessGroups.length === 0 ? (
            <p className="text-[13.5px] leading-relaxed text-ink-600">
              Aucun accès ne vous a encore été accordé. Votre manager peut vous en donner
              depuis l'écran Équipe.
            </p>
          ) : (
            <div className="space-y-3">
              {accessGroups.map(({ feature, rows }) => (
                <div key={feature.id}>
                  <div className="label-section mb-1 text-ink-500">{feature.label}</div>
                  <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                    {rows.map((r) => (
                      <li key={r.capability}>
                        <Badge>{r.label}</Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
          <p className="text-[12px] leading-relaxed text-ink-500">
            Votre poste ne décide pas de vos accès : chacun vous a été accordé par quelqu'un,
            et reste consultable dans le journal.
          </p>
        </Card>

        {can('MANAGE_TEAM') && (
          <Card className="space-y-3">
            <SectionLabel>Administration</SectionLabel>
            <div className="grid grid-cols-1 gap-2">
              <Button variant="secondary" onClick={() => navigate('/pilotage/equipe')}>
                Équipe et accès
              </Button>
              {can('MANAGE_CATALOG') && (
                <Button variant="secondary" onClick={() => navigate('/pilotage/catalogue')}>Catalogue</Button>
              )}
              {can('EDIT_RECIPE') && (
                <Button variant="secondary" onClick={() => navigate('/production/recettes')}>Recettes</Button>
              )}
              {can('MANAGE_LOCATIONS') && (
                <Button variant="secondary" onClick={() => navigate('/pilotage/emplacements')}>Emplacements</Button>
              )}
            </div>
          </Card>
        )}

        <Card className="space-y-3">
          <SectionLabel>Synchronisation</SectionLabel>
          <div className="flex items-center justify-between text-[14px]">
            <span className="text-ink-700">État</span>
            <Badge tone={online ? 'conforme' : 'info'}>{online ? 'En ligne' : 'Hors ligne'}</Badge>
          </div>
          {pending > 0 && (
            <div className="flex items-center justify-between text-[14px]">
              <span className="text-ink-700">En attente</span>
              <span className="num text-ink-900">{pending} opération{pending > 1 ? 's' : ''}</span>
            </div>
          )}
          {lastSyncAt && (
            <div className="flex items-center justify-between text-[14px]">
              <span className="text-ink-700">Dernière sync</span>
              <span className="num text-ink-900">
                {new Date(lastSyncAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          )}
          <Button full onClick={() => void syncNow()} disabled={!online || pending === 0}>
            Synchroniser maintenant
          </Button>
          {!online && (
            <p className="text-[12px] leading-relaxed text-ink-500">
              Mode hors ligne — vos opérations partiront au retour du réseau. Rien n'est perdu.
            </p>
          )}
        </Card>

        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex w-full items-center justify-between px-1 text-[13px] text-ink-500"
        >
          <span>Paramètres avancés</span>
          <span className="text-[16px]">{showAdvanced ? '▴' : '▾'}</span>
        </button>

        {showAdvanced && (
          <Card className="space-y-3">
            <SectionLabel>Avancé</SectionLabel>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(
                state.events.reduce<Record<string, number>>((acc, e) => {
                  acc[e.syncStatus] = (acc[e.syncStatus] ?? 0) + 1;
                  return acc;
                }, {}),
              ).map(([status, n]) => (
                <Badge key={status} tone={status === 'SYNCED' ? 'conforme' : status === 'FAILED' ? 'critique' : 'info'}>
                  {status} · {n}
                </Badge>
              ))}
            </div>
            <Button
              variant="danger"
              full
              onClick={() => {
                if (confirm("Effacer l'état local de cet appareil ? Les opérations non synchronisées seront perdues.")) {
                  clearState();
                  location.reload();
                }
              }}
            >
              Réinitialiser les données locales
            </Button>
          </Card>
        )}

        <Button full onClick={logout}>Déconnexion</Button>
      </main>
    </div>
  );
}
