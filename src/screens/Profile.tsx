import { useNavigate } from 'react-router-dom';
import { useBuna } from '../store/BunaStore';
import { ROLE_LABEL } from '../domain/types';
import { ROLE_PERMISSIONS } from '../domain/permissions';
import { clearState } from '../store/persist';
import { SyncIndicator } from '../design-system/components/SyncIndicator';
import { Badge, Button, Card, SectionLabel } from '../design-system/components/primitives';
import { BunaLogo } from '../design-system/components/BunaLogo';
import { deviceId } from '../domain/ids';

/** Profil, état de synchronisation, permissions effectives, raccourcis. */
export function Profile() {
  const { user, state, logout, pending, online, lastSyncAt, syncNow } = useBuna();
  const navigate = useNavigate();

  if (!user) return null;

  const byStatus = state.events.reduce<Record<string, number>>((acc, e) => {
    acc[e.syncStatus] = (acc[e.syncStatus] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="flex min-h-full flex-1 flex-col bg-ivoire">
      <SyncIndicator />

      <main className="flex-1 space-y-4 px-4 pb-28 pt-4">
        <div className="flex items-center justify-end">
          <BunaLogo size={38} />
        </div>
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-cafe font-display text-[22px] text-sable-pale">
            {user.name.charAt(0)}
          </span>
          <div>
            <h1 className="font-display text-[24px] leading-tight text-cafe">{user.name}</h1>
            <p className="num text-[11px] tracking-[0.1em] text-ink-500">
              {ROLE_LABEL[user.role].toUpperCase()} · COFFEE BAR AUCHAN
            </p>
          </div>
        </div>

        <Card className="space-y-3">
          <SectionLabel>Synchronisation</SectionLabel>
          <div className="flex items-center justify-between text-[14px]">
            <span className="text-ink-700">Réseau</span>
            <Badge tone={online ? 'conforme' : 'info'}>{online ? 'En ligne' : 'Hors ligne'}</Badge>
          </div>
          <div className="flex items-center justify-between text-[14px]">
            <span className="text-ink-700">Opérations en attente</span>
            <span className="num text-ink-900">{pending}</span>
          </div>
          <div className="flex items-center justify-between text-[14px]">
            <span className="text-ink-700">Dernière synchronisation</span>
            <span className="num text-ink-900">
              {lastSyncAt
                ? new Date(lastSyncAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
                : '—'}
            </span>
          </div>
          {Object.entries(byStatus).length > 0 && (
            <div className="flex flex-wrap gap-1.5 border-t border-ink-100 pt-3">
              {Object.entries(byStatus).map(([status, n]) => (
                <Badge key={status} tone={status === 'SYNCED' ? 'conforme' : status === 'FAILED' ? 'critique' : 'info'}>
                  {status} · {n}
                </Badge>
              ))}
            </div>
          )}
          <Button full onClick={() => void syncNow()} disabled={!online || pending === 0}>
            Synchroniser maintenant
          </Button>
          {!online && (
            <p className="text-[12px] leading-relaxed text-ink-500">
              Mode hors ligne. Vous pouvez continuer à travailler — tout sera envoyé au retour du réseau.
            </p>
          )}
        </Card>

        <Card className="space-y-2">
          <SectionLabel>Raccourcis</SectionLabel>
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={() => navigate('/stock/perte')}>Déclarer une perte</Button>
            <Button onClick={() => navigate('/stock')}>Consulter le stock</Button>
            <Button onClick={() => navigate('/alertes')}>Alertes</Button>
            <Button onClick={() => navigate('/cloture')}>Clôture de caisse</Button>
          </div>
        </Card>

        <Card className="space-y-2">
          <SectionLabel>Permissions effectives</SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {ROLE_PERMISSIONS[user.role].map((p) => (
              <Badge key={p}>{p}</Badge>
            ))}
          </div>
          <p className="text-[12px] leading-relaxed text-ink-500">
            Ces permissions sont également appliquées côté serveur (RLS PostgreSQL + Edge Functions).
          </p>
        </Card>

        <Card className="space-y-2">
          <SectionLabel>Appareil</SectionLabel>
          <div className="num break-all text-[12px] text-ink-500">{deviceId()}</div>
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

        <Button full onClick={logout}>Changer de profil</Button>
      </main>
    </div>
  );
}
