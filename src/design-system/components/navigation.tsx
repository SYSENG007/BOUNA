import type { ComponentType, ReactNode, SVGProps } from 'react';
import { NavLink } from 'react-router-dom';
import clsx from 'clsx';
import type { Role } from '../../domain/types';
import {
  IconAlert, IconAnalytics, IconCart, IconCash, IconDay, IconHome, IconMore,
  IconProduction, IconReceive, IconSell, IconStock, IconUser,
} from '../icons';

type IconType = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

/** §90 — la navigation dépend du rôle. Quatre à cinq destinations, jamais plus. */
export interface NavItem { to: string; label: string; Icon: IconType }

export const NAV_BY_ROLE: Record<Role, NavItem[]> = {
  SELLER: [
    { to: '/vendre', label: 'Vendre', Icon: IconSell },
    { to: '/commandes', label: 'Commandes', Icon: IconCart },
    { to: '/stock', label: 'Stock', Icon: IconStock },
    { to: '/moi', label: 'Moi', Icon: IconUser },
  ],
  PREPARER: [
    { to: '/production', label: 'À préparer', Icon: IconProduction },
    { to: '/stock', label: 'Stock', Icon: IconStock },
    { to: '/catalogue', label: 'Catalogue', Icon: IconHome },
    { to: '/moi', label: 'Moi', Icon: IconUser },
  ],
  PROCUREMENT: [
    { to: '/approvisionnement', label: 'À acheter', Icon: IconReceive },
    { to: '/stock', label: 'Stock', Icon: IconStock },
    { to: '/catalogue', label: 'Catalogue', Icon: IconHome },
    { to: '/moi', label: 'Moi', Icon: IconUser },
  ],
  MANAGER: [
    { to: '/aujourdhui', label: "Aujourd'hui", Icon: IconDay },
    { to: '/stock', label: 'Opérations', Icon: IconStock },
    { to: '/alertes', label: 'Alertes', Icon: IconAlert },
    { to: '/parcours', label: 'Parcours', Icon: IconAnalytics },
    { to: '/moi', label: 'Plus', Icon: IconMore },
  ],
  OWNER: [
    { to: '/cockpit', label: 'Cockpit', Icon: IconAnalytics },
    { to: '/aujourdhui', label: 'Ventes', Icon: IconDay },
    { to: '/finance', label: 'Finance', Icon: IconCash },
    { to: '/stock', label: 'Stock', Icon: IconStock },
    { to: '/moi', label: 'Plus', Icon: IconMore },
  ],
  FINANCE: [
    { to: '/finance', label: 'Dépenses', Icon: IconCash },
    { to: '/cockpit', label: 'Analyses', Icon: IconAnalytics },
    { to: '/stock', label: 'Stock', Icon: IconStock },
    { to: '/moi', label: 'Plus', Icon: IconMore },
  ],
};

/**
 * Barre d'onglets terrain.
 * L'onglet actif est signalé par un filet doré court en haut : la couleur seule
 * ne porte jamais un état.
 */
export function TabBar({ items }: { items: NavItem[] }) {
  return (
    <nav className="safe-b fixed inset-x-0 bottom-0 z-40 border-t border-ink-200 bg-surface/97 backdrop-blur lg:sticky">
      <div className="flex">
        {items.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/production'}
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
                {isActive && (
                  <span className="absolute inset-x-0 top-0 mx-auto h-[2px] w-8 rounded-b-full bg-or" />
                )}
                <Icon size={21} strokeWidth={isActive ? 1.8 : 1.6} />
                <span className={clsx('text-[10.5px]', isActive ? 'font-semibold' : 'font-medium')}>
                  {label}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

/** Rail desktop — registre « brand » : fond café, respiration large. */
export function Sidebar({ items, children }: { items: NavItem[]; children?: ReactNode }) {
  return (
    <aside className="sticky top-0 hidden h-screen w-[268px] shrink-0 flex-col gap-8 overflow-y-auto bg-cafe px-5 py-8 text-sable-pale lg:flex">
      {children}
      <nav className="flex flex-col gap-0.5">
        {items.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
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
                {isActive && (
                  <span className="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r-full bg-or" />
                )}
                <Icon size={19} />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
