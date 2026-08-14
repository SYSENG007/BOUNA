import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBuna } from '../../../store/BunaStore';
import { POST_LABEL } from '../../../domain/capabilities';
import { clearState } from '../../../store/persist';
import { operationsByFeature } from '../../registry';
import { SyncIndicator } from '../../../design-system/components/SyncIndicator';
import { Badge, Button, Card, SectionLabel } from '../../../design-system/components/primitives';
import { BunaLogo } from '../../../design-system/components/BunaLogo';

/**
 * Le profil.
 *
 * Il répond à « qui suis-je dans cette équipe ? » et donne les raccourcis vers
 * ce qu'on fait le plus souvent.
 *
 * Il ne liste plus les droits : la navigation les exprime déjà, puisqu'on n'y
 * voit que ce qu'on peut faire. Énumérer en plus des libellés que personne ne
 * peut s'accorder soi-même n'ajoutait qu'une page à lire.
 */
export function Profil() {
  const { user, state, logout, pending, online, lastSyncAt, syncNow, can, outboxDurable } = useBuna();
  const navigate = useNavigate();
  const [showAdvanced, setShowAdvanced] = useState(false);

  /* Les raccourcis parlent de gestes, la liste des accès parle de droits. */
  const shortcutGroups = useMemo(
    () => operationsByFeature(user?.capabilities ?? [], true, true),
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

        {/*
          La liste des accès a été retirée : elle énumérait des droits que la
          personne ne peut de toute façon pas s'accorder, et que la navigation
          exprime déjà — ce qu'on peut faire est ce qu'on voit. Reste le seul
          cas où le silence serait cruel : un compte sans aucun accès, qui doit
          savoir quoi demander et à qui.
        */}
        {shortcuts.length === 0 && (
          <Card>
            <p className="text-[13.5px] leading-relaxed text-ink-600">
              Aucun accès ne vous a encore été accordé. Votre manager peut vous en donner
              depuis l'écran Équipe.
            </p>
          </Card>
        )}

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
          {!online && outboxDurable && (
            <p className="text-[12px] leading-relaxed text-ink-500">
              Mode hors ligne — vos opérations partiront au retour du réseau. Rien n'est perdu.
            </p>
          )}

          {/* Le seul cas où l'on ne peut PAS promettre que rien n'est perdu.
              Le taire serait pire que tout : quelqu'un continuerait à encaisser
              hors ligne en croyant que l'appareil retient ses ventes. */}
          {!outboxDurable && (
            <p className="text-[12px] leading-relaxed text-critique">
              Cet appareil n'arrive plus à mettre vos opérations de côté. Synchronisez maintenant,
              tant que le réseau est là — et évitez d'encaisser hors ligne jusqu'à ce que ce message
              disparaisse.
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
