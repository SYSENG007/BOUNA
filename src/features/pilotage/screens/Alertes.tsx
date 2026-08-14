import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBuna } from '../../../store/BunaStore';
import type { NotificationStatus, Severity } from '../../../domain/types';
import { SyncIndicator } from '../../../design-system/components/SyncIndicator';
import {
  Badge, Button, Card, EmptyState, Segmented, type Tone,
} from '../../../design-system/components/primitives';

const SEVERITY_TONE: Record<Severity, Tone> = {
  INFO: 'info',
  ATTENTION: 'surveiller',
  ACTION_REQUIRED: 'surveiller',
  CRITICAL: 'critique',
};

const SEVERITY_LABEL: Record<Severity, string> = {
  INFO: 'Info',
  ATTENTION: 'À surveiller',
  ACTION_REQUIRED: 'Action requise',
  CRITICAL: 'Critique',
};

type Tab = 'ALL' | 'TODO' | 'CRITICAL' | 'DONE';

/** Notification Center (§47) — Toutes · À traiter · Critiques · Terminées. */
export function Alertes() {
  const { state, user, setNotificationStatus } = useBuna();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('TODO');

  /*
   * Une alerte s'adresse à ceux qui peuvent y répondre, pas à un rôle. « Stock
   * de lait faible » va à qui peut commander ; l'envoyer à qui ne le peut pas
   * transforme une action en angoisse.
   */
  const mine = state.notifications.filter((n) =>
    user ? n.recipientCapabilities.some((c) => user.capabilities.includes(c)) : true,
  );

  const visible = mine.filter((n) => {
    if (tab === 'ALL') return true;
    if (tab === 'TODO') return n.status === 'UNREAD' || n.status === 'READ';
    if (tab === 'CRITICAL') return n.severity === 'CRITICAL' || n.severity === 'ACTION_REQUIRED';
    return n.status === 'RESOLVED';
  });

  const act = (id: string, status: NotificationStatus) => setNotificationStatus(id, status);

  return (
    <div className="flex min-h-full flex-1 flex-col bg-ivoire">
      <SyncIndicator />

      <header className="px-4 pb-3 pt-4">
        <h1 className="t-h1 text-cafe">Alertes</h1>
        <p className="text-[12px] text-ink-500">Adressées à votre rôle · action proposée, pas seulement un constat</p>
      </header>

      <div className="-mx-0 overflow-x-auto px-4 pb-3">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'TODO', label: 'À traiter' },
            { value: 'CRITICAL', label: 'Critiques' },
            { value: 'ALL', label: 'Toutes' },
            { value: 'DONE', label: 'Terminées' },
          ]}
        />
      </div>

      <main className="flex-1 space-y-3 px-4 pb-28">
        {visible.length === 0 ? (
          <EmptyState title="Rien à traiter" body="Aucune alerte ne vous est adressée pour le moment." />
        ) : (
          visible.map((n) => (
            <Card key={n.id} className="space-y-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[15px] font-medium text-ink-900">{n.title}</div>
                  <div className="mt-0.5 text-[13px] leading-snug text-ink-500">{n.body}</div>
                </div>
                <Badge tone={SEVERITY_TONE[n.severity]}>{SEVERITY_LABEL[n.severity]}</Badge>
              </div>

              <div className="flex flex-wrap gap-2 border-t border-ink-100 pt-2.5">
                {n.actionLabel && n.status !== 'RESOLVED' && (
                  <Button
                    variant="primary"
                    size="compact"
                    onClick={() => {
                      act(n.id, 'ACKNOWLEDGED');
                      if (n.actionTarget) navigate(n.actionTarget);
                    }}
                  >
                    {n.actionLabel}
                  </Button>
                )}
                {n.status !== 'RESOLVED' && (
                  <Button size="compact" onClick={() => act(n.id, 'RESOLVED')}>
                    Marquer traitée
                  </Button>
                )}
                {n.status === 'RESOLVED' && <Badge tone="conforme">Traitée</Badge>}
              </div>
            </Card>
          ))
        )}
      </main>
    </div>
  );
}
