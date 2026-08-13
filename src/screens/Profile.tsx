import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBuna } from '../store/BunaStore';
import { ROLE_LABEL } from '../domain/types';
import { clearState } from '../store/persist';
import { SyncIndicator } from '../design-system/components/SyncIndicator';
import { Badge, Button, Card, SectionLabel } from '../design-system/components/primitives';
import { BunaLogo } from '../design-system/components/BunaLogo';

/**
 * Profile page — redesigned for clarity.
 * Shows the user's identity, roles, and clean shortcuts.
 * Technical debug info is tucked behind an expandable section.
 */
export function Profile() {
  const { user, state, logout, pending, online, lastSyncAt, syncNow } = useBuna();
  const navigate = useNavigate();
  const [showAdvanced, setShowAdvanced] = useState(false);

  if (!user) return null;

  return (
    <div className="flex min-h-full flex-1 flex-col bg-ivoire">
      <SyncIndicator />

      <main className="flex-1 space-y-5 px-4 pb-28 pt-4">
        {/* Header */}
        <div className="flex items-center justify-end">
          <BunaLogo size={38} />
        </div>

        {/* Identity */}
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-cafe font-display text-[22px] text-sable-pale">
            {user.name.charAt(0)}
          </span>
          <div>
            <h1 className="font-display text-[24px] leading-tight text-cafe">{user.name}</h1>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {user.roles.map((r) => (
                <Badge key={r} tone="conforme">{ROLE_LABEL[r]}</Badge>
              ))}
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <Card className="space-y-3">
          <SectionLabel>Raccourcis</SectionLabel>
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={() => navigate('/stock/perte')}>Déclarer une perte</Button>
            <Button onClick={() => navigate('/stock')}>Consulter le stock</Button>
            <Button onClick={() => navigate('/alertes')}>Alertes</Button>
            <Button onClick={() => navigate('/cloture')}>Clôture de caisse</Button>
            <Button onClick={() => navigate('/achats')}>Liste des courses</Button>
            <Button onClick={() => navigate('/stock/inventaire')}>Inventaire</Button>
          </div>
        </Card>

        {/* Management (Manager / Owner) */}
        {(user.roles.includes('MANAGER') || user.roles.includes('OWNER')) && (
          <Card className="space-y-3">
            <SectionLabel>Administration</SectionLabel>
            <div className="grid grid-cols-1 gap-2">
              <Button variant="secondary" onClick={() => navigate('/manager/catalogue')}>Catalogue Produits</Button>
              <Button variant="secondary" onClick={() => navigate('/manager/recettes')}>Gérer les Recettes</Button>
              <Button variant="secondary" onClick={() => navigate('/manager/emplacements')}>Lieux de Stockage</Button>
            </div>
          </Card>
        )}

        {/* Sync Status — simple */}
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
              Mode hors ligne — vos opérations seront envoyées au retour du réseau.
            </p>
          )}
        </Card>

        {/* Advanced / Debug — hidden by default */}
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
            {Object.entries(
              state.events.reduce<Record<string, number>>((acc, e) => {
                acc[e.syncStatus] = (acc[e.syncStatus] ?? 0) + 1;
                return acc;
              }, {}),
            ).length > 0 && (
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
            )}
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
