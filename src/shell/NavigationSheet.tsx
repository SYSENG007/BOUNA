import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useBuna } from '../store/BunaStore';
import { POST_LABEL } from '../domain/capabilities';
import { IconClose } from '../design-system/icons';
import { overflowFor, type NavItem } from './navigation';

/**
 * Le menu de navigation du mobile.
 *
 * La barre d'onglets ne porte que trois features — au-delà, les libellés
 * deviennent illisibles sur un téléphone. Ce menu porte tout le reste : les
 * features qui n'ont pas tenu dans la barre, les alertes, le profil et la
 * déconnexion.
 *
 * C'est ce qui rend la règle vraie sur mobile comme sur bureau : on voit tout
 * ce à quoi on a droit, et rien d'autre. Une feature accordée qui resterait
 * hors d'atteinte serait un accès accordé pour rien.
 */
export function NavigationSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, logout } = useBuna();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !user) return null;

  const items = overflowFor(user.capabilities);

  const go = (item: NavItem) => {
    onClose();
    navigate(item.to);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Fermer"
        onClick={onClose}
        className="absolute inset-0 bg-cafe/45 backdrop-blur-[2px]"
      />
      <div
        className="safe-b relative flex max-h-[85dvh] w-full max-w-lg flex-col rounded-t-[16px] bg-ivoire sm:rounded-[16px]"
        style={{ boxShadow: 'var(--shadow-e2)' }}
      >
        <header className="flex items-center justify-between border-b border-ink-200 px-4 py-3.5">
          <div className="min-w-0">
            <h2 className="truncate font-display text-[20px] leading-tight text-cafe">{user.name}</h2>
            <p className="num text-[11px] tracking-[0.12em] text-ink-500">
              {POST_LABEL[user.post].toUpperCase()}
            </p>
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
          <nav className="flex flex-col gap-1">
            {items.map((item) => {
              const active = item.match ? pathname.startsWith(item.match) : false;
              return (
                <button
                  key={item.to}
                  type="button"
                  onClick={() => go(item)}
                  className={clsx(
                    'flex min-h-[var(--spacing-touch)] items-center gap-3 rounded-[6px] px-3 py-2.5 text-left text-[15px]',
                    'transition-colors duration-100',
                    active
                      ? 'bg-sable-pale font-medium text-cafe'
                      : 'text-ink-800 hover:bg-sable-pale/60',
                  )}
                >
                  <item.Icon size={20} strokeWidth={active ? 1.8 : 1.6} />
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="mt-4 border-t border-ink-200 pt-3">
            <button
              type="button"
              onClick={() => { onClose(); logout(); }}
              className="flex min-h-[var(--spacing-touch)] w-full items-center rounded-[6px] px-3 text-left text-[14px] font-medium text-ink-500 transition-colors hover:bg-critique-pale hover:text-critique"
            >
              Déconnexion
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
