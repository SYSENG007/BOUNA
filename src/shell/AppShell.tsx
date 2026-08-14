import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useBuna } from '../store/BunaStore';
import { useAdaptive } from '../design-system/hooks/useAdaptive';
import { BunaLockup, BunaLogo } from '../design-system/components/BunaLogo';
import { SyncIndicator } from '../design-system/components/SyncIndicator';
import { IconChevronLeft, IconChevronRight } from '../design-system/icons';
import { POST_LABEL } from '../domain/capabilities';
import { ErrorBoundary } from './ErrorBoundary';
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

/** Largeurs du rail. Replié, il garde 44 px de cible tactile plus ses marges. */
const RAIL_OPEN = '268px';
const RAIL_SHUT = '76px';
const RAIL_PREF = 'buna.rail-collapsed';

export function AppShell() {
  const { user, logout } = useBuna();
  const { pathname } = useLocation();
  const { isMobile } = useAdaptive();
  const navigate = useNavigate();
  const [sheetOpen, setSheetOpen] = useState(false);

  /* Le choix de repli suit la personne d'une session à l'autre : c'est une
     préférence d'espace de travail, pas un état d'écran. */
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(RAIL_PREF) === '1'; } catch { return false; }
  });

  const toggleRail = useCallback(() => {
    setCollapsed((was) => {
      const next = !was;
      try { localStorage.setItem(RAIL_PREF, next ? '1' : '0'); } catch { /* mode privé */ }
      return next;
    });
  }, []);

  /* Le rail porte la largeur que `.rail-bar` lit pour se caler : toute barre
     d'action ancrée en bas doit suivre le repli, sinon elle passe dessous. */
  useEffect(() => {
    if (isMobile) return;
    const root = document.documentElement;
    root.style.setProperty('--nav-rail', collapsed ? RAIL_SHUT : RAIL_OPEN);
    return () => { root.style.removeProperty('--nav-rail'); };
  }, [collapsed, isMobile]);

  if (!user) return <Login />;

  const firstName = user.name.split(' ')[0];
  const initials = user.name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase();
  const immersive = IMMERSIVE.includes(pathname);
  const tabs = tabsFor(user.capabilities, firstName);
  const rail = railFor(user.capabilities);

  return (
    <div className="flex min-h-dvh bg-shell">
      {!isMobile && (
        <aside
          className={clsx(
            'sticky top-0 flex h-screen shrink-0 flex-col overflow-y-auto overflow-x-hidden bg-cafe py-8 text-sable-pale',
            'transition-[width,padding] duration-200 ease-out',
            collapsed ? 'items-center gap-6 px-3' : 'gap-8 px-5',
          )}
          style={{ width: 'var(--nav-rail)' }}
        >
          {collapsed
            ? <BunaLogo size={38} />
            : <BunaLockup subtitle="OPERATIONS · OS" surface="cafe" size={42} />}

          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            title={collapsed ? 'Déclarer' : undefined}
            className={clsx(
              'flex min-h-[46px] items-center justify-center gap-2 rounded-[6px] bg-brun text-[14px] font-medium text-sable-pale transition-colors hover:bg-brun-deep',
              collapsed ? 'w-[46px]' : 'w-full px-3',
            )}
          >
            <span className="text-[17px] leading-none">+</span>
            {!collapsed && 'Déclarer'}
          </button>

          <nav className="flex w-full flex-col gap-0.5">
            {rail.map((item) => <RailLink key={item.to} item={item} collapsed={collapsed} />)}
          </nav>

          <div className="mt-auto flex w-full flex-col gap-4">
            <div
              className={clsx(
                'border-t border-[#4A362A] pt-4',
                collapsed ? 'flex flex-col items-center gap-3' : 'flex items-center justify-between',
              )}
            >
              <button
                type="button"
                onClick={() => navigate('/moi')}
                title={collapsed ? `${user.name} · ${POST_LABEL[user.post]}` : undefined}
                className="group text-left"
              >
                {collapsed ? (
                  <span className="num flex h-[38px] w-[38px] items-center justify-center rounded-full bg-cafe-soft text-[13px] tracking-[0.04em] text-sable-pale transition-colors group-hover:bg-brun">
                    {initials}
                  </span>
                ) : (
                  <>
                    <div className="text-[13.5px] font-medium text-sable-pale group-hover:text-white">{user.name}</div>
                    <div className="num mt-0.5 text-[10.5px] tracking-[0.14em] text-[#9E8B77]">
                      {POST_LABEL[user.post].toUpperCase()} · {user.capabilities.length} ACCÈS
                    </div>
                  </>
                )}
              </button>
              {!collapsed && (
                <button
                  type="button"
                  onClick={logout}
                  className="rounded px-2 py-1 text-[12px] font-medium text-[#B9A895] transition-colors hover:bg-cafe-soft hover:text-sable-pale"
                >
                  Déconnexion
                </button>
              )}
            </div>

            {!collapsed && <SyncIndicator compact />}

            {/* Le repli est une préférence, donc il se commande depuis le rail
                lui-même — pas depuis un réglage enfoui trois écrans plus loin. */}
            <button
              type="button"
              onClick={toggleRail}
              aria-expanded={!collapsed}
              title={collapsed ? 'Déplier le menu' : 'Replier le menu'}
              className={clsx(
                'flex min-h-[38px] items-center gap-2 rounded-[6px] text-[12.5px] font-medium text-[#9E8B77]',
                'transition-colors hover:bg-cafe-soft hover:text-sable-pale',
                collapsed ? 'w-[46px] justify-center' : 'w-full px-3',
              )}
            >
              {collapsed ? <IconChevronRight size={18} /> : <IconChevronLeft size={18} />}
              {!collapsed && 'Replier le menu'}
            </button>
          </div>
        </aside>
      )}

      <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
        <div
          className="shell-canvas flex flex-1 flex-col"
          style={isMobile && !immersive ? { paddingBottom: 'var(--tabbar-h)' } : undefined}
        >
          {/*
            La limite est posée ici, et pas plus haut, parce que c'est le seul
            endroit où la coque survit à l'écran : le rail et la barre d'onglets
            sont rendus en dehors, donc un écran qui tombe laisse la navigation
            debout. La personne change d'onglet et continue de travailler.

            `key={pathname}` fait le reste : sans lui, une limite passée en
            erreur y resterait, et tous les écrans suivants hériteraient du
            repli d'un écran qu'on vient de quitter. Changer d'onglet doit
            suffire à repartir — c'est le geste qu'on prend naturellement.
          */}
          <ErrorBoundary key={pathname} zone={`écran ${pathname}`} shellIntact>
            <Outlet />
          </ErrorBoundary>
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

function RailLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const { to, label, Icon } = item;
  return (
    <NavLink
      to={to}
      end={to === '/production' || to === '/vente'}
      /* Replié, le libellé disparaît de l'écran mais pas de l'accessibilité :
         l'icône seule ne dit rien à un lecteur d'écran. */
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
      className={({ isActive }) =>
        clsx(
          'relative flex min-h-[46px] items-center rounded-[6px] text-[14px]',
          'transition-colors duration-100',
          collapsed ? 'justify-center px-0' : 'gap-3 px-3',
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
          {!collapsed && label}
        </>
      )}
    </NavLink>
  );
}
