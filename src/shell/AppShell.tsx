import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useBuna } from '../store/BunaStore';
import { useAdaptive } from '../design-system/hooks/useAdaptive';
import { BunaLockup } from '../design-system/components/BunaLogo';
import { SyncIndicator } from '../design-system/components/SyncIndicator';
import { POST_LABEL } from '../domain/capabilities';
import { Login } from './Login';
import { OperationSheet } from './OperationSheet';
import { railFor, tabsFor, type NavItem } from './navigation';

/**
 * Écrans en plein flux : la barre disparaît, l'utilisateur va au bout de son
 * geste. Un onglet visible pendant un encaissement est une invitation à
 * abandonner à mi-chemin.
 */
const IMMERSIVE = [
  '/vente/panier', '/vente/encaissement', '/vente/recu',
  '/production/preparation', '/stock/perte', '/stock/inventaire', '/stock/transfert',
  '/finance/caisse', '/appro/commande', '/appro/reception', '/finance/depense',
];

export function AppShell() {
  const { user, logout } = useBuna();
  const { pathname } = useLocation();
  const { isMobile } = useAdaptive();
  const navigate = useNavigate();
  const [sheetOpen, setSheetOpen] = useState(false);

  if (!user) return <Login />;

  const firstName = user.name.split(' ')[0];
  const immersive = IMMERSIVE.includes(pathname);
  const tabs = tabsFor(user.capabilities, firstName);
  const rail = railFor(user.capabilities, firstName);

  return (
    <div className="flex min-h-dvh bg-shell">
      {!isMobile && (
        <aside
          className="sticky top-0 flex h-screen shrink-0 flex-col gap-8 overflow-y-auto bg-cafe px-5 py-8 text-sable-pale"
          style={{ width: 'var(--nav-rail)' }}
        >
          <BunaLockup subtitle="OPERATIONS · OS" surface="cafe" size={42} />

          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="flex min-h-[46px] items-center justify-center gap-2 rounded-[6px] bg-brun px-3 text-[14px] font-medium text-sable-pale transition-colors hover:bg-brun-deep"
          >
            <span className="text-[17px] leading-none">+</span> Déclarer
          </button>

          <nav className="flex flex-col gap-0.5">
            {rail.map((item) => <RailLink key={item.to} item={item} />)}
          </nav>

          <div className="mt-auto flex flex-col gap-4">
            <div className="flex items-center justify-between border-t border-[#4A362A] pt-4">
              <button type="button" onClick={() => navigate('/moi')} className="group text-left">
                <div className="text-[13.5px] font-medium text-sable-pale group-hover:text-white">{user.name}</div>
                <div className="num mt-0.5 text-[10.5px] tracking-[0.14em] text-[#9E8B77]">
                  {POST_LABEL[user.post].toUpperCase()} · {user.capabilities.length} ACCÈS
                </div>
              </button>
              <button
                type="button"
                onClick={logout}
                className="rounded px-2 py-1 text-[12px] font-medium text-[#B9A895] transition-colors hover:bg-cafe-soft hover:text-sable-pale"
              >
                Déconnexion
              </button>
            </div>
            <SyncIndicator compact />
          </div>
        </aside>
      )}

      <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
        <div
          className="shell-canvas flex flex-1 flex-col"
          style={isMobile && !immersive ? { paddingBottom: 'var(--tabbar-h)' } : undefined}
        >
          <Outlet />
        </div>

        {isMobile && !immersive && (
          <nav className="safe-b fixed inset-x-0 bottom-0 z-40 border-t border-ink-200 bg-surface/97 backdrop-blur">
            <div className="flex">
              {tabs.map((item, i) =>
                item.opensSheet
                  ? <SheetTab key={`sheet-${i}`} item={item} onOpen={() => setSheetOpen(true)} />
                  : <Tab key={`${item.to}-${i}`} item={item} />,
              )}
            </div>
          </nav>
        )}
      </div>

      <OperationSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </div>
  );
}

/** L'onglet actif porte un filet doré court : la couleur seule ne dit jamais un état. */
function Tab({ item }: { item: NavItem }) {
  const { to, label, Icon } = item;
  return (
    <NavLink
      to={to}
      end={to === '/production' || to === '/vente'}
      className={({ isActive }) =>
        clsx(
          'no-select relative flex min-h-[60px] flex-1 flex-col items-center justify-center gap-1 py-2',
          'transition-colors duration-100',
          isActive ? 'text-cafe' : 'text-ink-400',
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && <span className="absolute inset-x-0 top-0 mx-auto h-[2px] w-8 rounded-b-full bg-or" />}
          <Icon size={21} strokeWidth={isActive ? 1.8 : 1.6} />
          <span className={clsx('text-[10.5px]', isActive ? 'font-semibold' : 'font-medium')}>{label}</span>
        </>
      )}
    </NavLink>
  );
}

/**
 * L'emplacement central. Il ne navigue pas, il ouvre — et sa forme le dit :
 * c'est le seul onglet plein, pour qu'on le trouve sans le lire.
 */
function SheetTab({ item, onOpen }: { item: NavItem; onOpen: () => void }) {
  const { label } = item;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="no-select flex min-h-[60px] flex-1 flex-col items-center justify-center gap-1 py-2 text-ink-500"
    >
      <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-cafe text-[20px] leading-none text-sable-pale"
        style={{ boxShadow: 'var(--shadow-key)' }}>
        +
      </span>
      <span className="text-[10.5px] font-medium">{label}</span>
    </button>
  );
}

function RailLink({ item }: { item: NavItem }) {
  const { to, label, Icon } = item;
  return (
    <NavLink
      to={to}
      end={to === '/production' || to === '/vente'}
      className={({ isActive }) =>
        clsx(
          'relative flex min-h-[46px] items-center gap-3 rounded-[6px] px-3 text-[14px]',
          'transition-colors duration-100',
          isActive
            ? 'bg-cafe-soft font-medium text-sable-pale'
            : 'text-[#B9A895] hover:bg-cafe-soft/50 hover:text-sable-pale',
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && <span className="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r-full bg-or" />}
          <Icon size={19} strokeWidth={isActive ? 1.8 : 1.6} />
          {label}
        </>
      )}
    </NavLink>
  );
}
