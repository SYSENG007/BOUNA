import clsx from 'clsx';
import { useBuna } from '../../store/BunaStore';

/**
 * §52 — « Hors ligne n'est pas une erreur : c'est un état neutre, informatif,
 * jamais alarmant. » On n'écrit jamais « Connexion Internet requise ».
 */
export function SyncIndicator({ compact = false }: { compact?: boolean }) {
  const { online, pending, syncing, lastSyncAt, syncNow } = useBuna();

  const label = syncing
    ? 'Synchronisation…'
    : !online
      ? pending > 0
        ? `Hors ligne — ${pending} opération${pending > 1 ? 's' : ''} en attente`
        : 'Mode hors ligne — vous pouvez continuer'
      : pending > 0
        ? `${pending} en attente`
        : lastSyncAt
          ? `Synchronisé · ${new Date(lastSyncAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
          : 'Synchronisé';

  const tone = !online ? 'info' : pending > 0 ? 'surveiller' : 'conforme';

  if (compact) {
    return (
      <button
        onClick={() => void syncNow()}
        title={label}
        className="no-select flex h-9 items-center gap-1.5 rounded-[4px] px-2 text-[12px] text-ink-600"
      >
        <span
          className={clsx(
            'h-2 w-2 rounded-full',
            tone === 'conforme' ? 'bg-conforme' : tone === 'surveiller' ? 'bg-surveiller' : 'bg-info',
            syncing && 'animate-pulse',
          )}
        />
        <span className="num">{pending > 0 ? `☁ ${pending}` : '☁'}</span>
      </button>
    );
  }

  return (
    <button
      onClick={() => void syncNow()}
      className={clsx(
        'flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[13px]',
        tone === 'conforme' && 'bg-conforme-pale text-conforme-deep',
        tone === 'surveiller' && 'bg-surveiller-pale text-or-ink',
        tone === 'info' && 'bg-info-pale text-info-deep',
      )}
    >
      <span
        className={clsx(
          'h-2 w-2 shrink-0 rounded-full',
          tone === 'conforme' ? 'bg-conforme' : tone === 'surveiller' ? 'bg-surveiller' : 'bg-info',
          syncing && 'animate-pulse',
        )}
      />
      <span className="flex-1">{label}</span>
      {online && pending > 0 && !syncing && (
        <span className="font-medium underline underline-offset-4">Synchroniser maintenant</span>
      )}
    </button>
  );
}
