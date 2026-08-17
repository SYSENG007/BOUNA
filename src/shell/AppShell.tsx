import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useBuna } from '../store/BunaStore';
import { useAdaptive } from '../design-system/hooks/useAdaptive';
import { BunaLockup, BunaLogo } from '../design-system/components/BunaLogo';
import { SyncIndicator } from '../design-system/components/SyncIndicator';
import { IconChevronLeft, IconChevronRight } from '../design-system/icons';
import { POST_LABEL } from '../domain/capabilities';
import { SIMULATION_NOTICE, isSimulation } from '../domain/simulation';
import { ErrorBoundary } from './ErrorBoundary';
import { Login } from './Login';
import { OperationSheet } from './OperationSheet';
import { NavigationSheet } from './NavigationSheet';
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

/**
 * Le mode boutique.
 *
 * Au comptoir, on ne navigue pas : on vend, et on recommence. La coque
 * s'efface donc entièrement — rail replié, onglets masqués — et on n'en sort
 * que par un geste explicite, « Sortir de la boutique ». Laisser la navigation
 * à portée de pouce pendant un service, c'est inviter à la quitter par erreur
 * entre deux clients.
 *
 * L'historique des ventes n'en fait pas partie : on le consulte, on ne vend
 * pas dedans.
 */
function isShopMode(pathname: string): boolean {
  return pathname.startsWith('/vente') && pathname !== '/vente/historique';
}

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
  const [menuOpen, setMenuOpen] = useState(false);

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

  /* En boutique, le rail est replié quoi qu'en dise la préférence — mais la
     préférence n'est pas écrasée : on la retrouve intacte en sortant. */
  const shopMode = isShopMode(pathname);
  const railShut = collapsed || shopMode;

  /* Le rail porte la largeur que `.rail-bar` lit pour se caler : toute barre
     d'action ancrée en bas doit suivre le repli, sinon elle passe dessous. */
  useEffect(() => {
    if (isMobile) return;
    const root = document.documentElement;
    root.style.setProperty('--nav-rail', railShut ? RAIL_SHUT : RAIL_OPEN);
    return () => { root.style.removeProperty('--nav-rail'); };
  }, [railShut, isMobile]);

  if (!user) return <Login />;

  const initials = user.name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase();
  /* La barre d'onglets disparaît aussi en boutique : c'est le même principe
     que les écrans en plein flux, appliqué à tout le geste de vente. */
  const immersive = IMMERSIVE.includes(pathname) || shopMode;
  const tabs = tabsFor(user.capabilities);
  const rail = railFor(user.capabilities);

  return (
    <div className="flex min-h-dvh bg-shell">
      {!isMobile && (
        <aside
          className={clsx(
            'sticky top-0 flex h-screen shrink-0 flex-col overflow-y-auto overflow-x-hidden bg-cafe py-8 text-sable-pale',
            'transition-[width,padding] duration-200 ease-out',
            railShut ? 'items-center gap-6 px-3' : 'gap-8 px-5',
          )}
          style={{ width: 'var(--nav-rail)' }}
        >
          {railShut
            ? <BunaLogo size={38} />
            : <BunaLockup subtitle="OPERATIONS · OS" surface="cafe" size={42} />}

          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            title={railShut ? 'Déclarer' : undefined}
            className={clsx(
              'flex min-h-[46px] items-center justify-center gap-2 rounded-[6px] bg-brun text-[14px] font-medium text-sable-pale transition-colors hover:bg-brun-deep',
              railShut ? 'w-[46px]' : 'w-full px-3',
            )}
          >
            <span className="text-[17px] leading-none">+</span>
            {!railShut && 'Déclarer'}
          </button>

          <nav className="flex w-full flex-col gap-0.5">
            {rail.map((item) => <RailLink key={item.to} item={item} collapsed={railShut} />)}
          </nav>

          <div className="mt-auto flex w-full flex-col gap-4">
            {/*
              Le pied du rail porte deux gestes de nature différente : entrer
              chez soi, et sortir de l'application. Ils ne se ressemblent donc
              pas — le profil est une destination pleine, la déconnexion une
              sortie discrète. Le survol le confirme avant le clic : le profil
              s'éclaire et sa pastille avance, la déconnexion vire au critique
              et sa flèche glisse vers la sortie.
            */}
            <div className="flex flex-col gap-1 border-t border-[#4A362A] pt-3">
              <button
                type="button"
                onClick={() => navigate('/moi')}
                title={railShut ? `${user.name} · ${POST_LABEL[user.post]}` : undefined}
                className={clsx(
                  'group flex min-h-[48px] items-center rounded-[6px] text-left',
                  'transition-colors duration-150 hover:bg-cafe-soft',
                  railShut ? 'justify-center px-0' : 'gap-3 px-2',
                )}
              >
                <span
                  className={clsx(
                    'num flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-full',
                    'bg-cafe-soft text-[12.5px] tracking-[0.04em] text-sable-pale',
                    'transition-[background-color,transform] duration-150',
                    'group-hover:bg-brun motion-safe:group-hover:-translate-y-px',
                  )}
                >
                  {initials}
                </span>
                {!railShut && (
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium text-sable-pale transition-colors group-hover:text-white">
                      {user.name}
                    </span>
                    <span className="num mt-0.5 block text-[10.5px] tracking-[0.14em] text-[#9E8B77]">
                      {POST_LABEL[user.post].toUpperCase()}
                    </span>
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={logout}
                title={railShut ? 'Déconnexion' : undefined}
                aria-label="Déconnexion"
                className={clsx(
                  'group flex min-h-[40px] items-center rounded-[6px] text-[12.5px] font-medium',
                  'text-[#9E8B77] transition-colors duration-150',
                  'hover:bg-critique-deep/25 hover:text-sable-pale',
                  railShut ? 'justify-center px-0' : 'gap-2 px-2',
                )}
              >
                <IconChevronRight
                  size={17}
                  className="shrink-0 transition-transform duration-150 motion-safe:group-hover:translate-x-0.5"
                />
                {!railShut && 'Déconnexion'}
              </button>
            </div>

            {!railShut && <SyncIndicator compact />}

            {/* Le repli est une préférence, donc il se commande depuis le rail
                lui-même — pas depuis un réglage enfoui trois écrans plus loin.
                En boutique il disparaît : le rail y est replié d'office, et
                proposer de le déplier promettrait un geste sans effet. */}
            {!shopMode && (
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
            )}
          </div>
        </aside>
      )}

      <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
        {isSimulation(user.organizationId) && <SimulationBanner />}
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
                  : item.opensMenu
                    ? <MenuTab key={`menu-${i}`} item={item} onOpen={() => setMenuOpen(true)} />
                    : <Tab key={`${item.to}-${i}`} item={item} />,
              )}
            </div>
          </nav>
        )}
      </div>

      <OperationSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
      <NavigationSheet open={menuOpen} onClose={() => setMenuOpen(false)} />
    </div>
  );
}

/**
 * Le bandeau de simulation.
 *
 * Il est rendu AVANT la toile et en dehors de la limite d'erreur, donc il
 * survit à un écran qui tombe, et il ne disparaît pas sur les écrans en plein
 * flux — encaissement compris. C'est voulu : le seul moment où confondre une
 * journée d'essai avec une vraie journée coûte quelque chose, c'est celui où
 * l'on encaisse.
 *
 * Il ne porte pas le filet doré `.derived` : ce filet marque ce que le système
 * DÉDUIT, et ceci n'est pas une déduction — c'est l'état de la maison dans
 * laquelle on travaille.
 */
function SimulationBanner() {
  return (
    <div
      role="status"
      className="flex items-center gap-2.5 border-b border-info/25 bg-info-pale px-4 py-2 text-info-deep"
    >
      <span
        aria-hidden
        className="inline-block size-1.5 shrink-0 rounded-full bg-info"
      />
      <p className="text-[12.5px] leading-snug">
        <span className="font-semibold">{SIMULATION_NOTICE.title}</span>
        <span className="mx-1.5 opacity-40">·</span>
        {SIMULATION_NOTICE.body}
      </p>
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

/**
 * Le dernier emplacement. Il ouvre le menu — c'est par lui qu'on atteint tout
 * ce que la barre n'a pas pu porter, donc il ne doit jamais disparaître.
 */
function MenuTab({ item, onOpen }: { item: NavItem; onOpen: () => void }) {
  const { label, Icon } = item;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="no-select flex min-h-[60px] flex-1 flex-col items-center justify-center gap-1 py-2 text-ink-400 transition-colors hover:text-cafe"
    >
      <Icon size={21} strokeWidth={1.6} />
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
