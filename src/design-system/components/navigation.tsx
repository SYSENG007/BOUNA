import { NavLink } from 'react-router-dom';
import clsx from 'clsx';
import type { Role } from '../../domain/types';

/** §90 — la navigation dépend du rôle. Quatre à cinq destinations, jamais plus. */
export interface NavItem { to: string; label: string; icon: string }

export const NAV_BY_ROLE: Record<Role, NavItem[]> = {
  SELLER: [
    { to: '/vendre', label: 'Vendre', icon: '◧' },
    { to: '/commandes', label: 'Commandes', icon: '≡' },
    { to: '/stock', label: 'Stock', icon: '▤' },
    { to: '/moi', label: 'Moi', icon: '◍' },
  ],
  PREPARER: [
    { to: '/production', label: 'À préparer', icon: '◔' },
    { to: '/production/batch', label: 'Produire', icon: '◉' },
    { to: '/stock', label: 'Stock', icon: '▤' },
    { to: '/moi', label: 'Moi', icon: '◍' },
  ],
  PROCUREMENT: [
    { to: '/approvisionnement', label: 'À acheter', icon: '◫' },
    { to: '/achats', label: 'Achats', icon: '≡' },
    { to: '/stock', label: 'Stock', icon: '▤' },
    { to: '/moi', label: 'Moi', icon: '◍' },
  ],
  MANAGER: [
    { to: '/aujourdhui', label: "Aujourd'hui", icon: '◐' },
    { to: '/stock', label: 'Opérations', icon: '▤' },
    { to: '/alertes', label: 'Alertes', icon: '△' },
    { to: '/moi', label: 'Plus', icon: '⋯' },
  ],
  OWNER: [
    { to: '/cockpit', label: 'Cockpit', icon: '◈' },
    { to: '/aujourdhui', label: 'Ventes', icon: '◐' },
    { to: '/finance', label: 'Finance', icon: '◇' },
    { to: '/stock', label: 'Stock', icon: '▤' },
    { to: '/moi', label: 'Plus', icon: '⋯' },
  ],
  FINANCE: [
    { to: '/finance', label: 'Dépenses', icon: '◇' },
    { to: '/cockpit', label: 'Analyses', icon: '◈' },
    { to: '/stock', label: 'Stock', icon: '▤' },
    { to: '/moi', label: 'Plus', icon: '⋯' },
  ],
};

/** Barre d'onglets terrain : 56 px de haut, un icône jamais seul — toujours un mot. */
export function TabBar({ items }: { items: NavItem[] }) {
  return (
    <nav className="safe-b sticky bottom-0 z-30 border-t border-ink-200 bg-surface">
      <div className="flex">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/production'}
            className={({ isActive }) =>
              clsx(
                'no-select flex min-h-[58px] flex-1 flex-col items-center justify-center gap-1 py-2',
                isActive ? 'text-brun' : 'text-ink-500',
              )
            }
          >
            {({ isActive }) => (
              <>
                <span className={clsx('text-[17px] leading-none', isActive && 'text-brun')}>{item.icon}</span>
                <span className="text-[11px] font-medium">{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

/** Rail desktop — registre « brand » : fond café, respiration large. */
export function Sidebar({ items, children }: { items: NavItem[]; children?: React.ReactNode }) {
  return (
    <aside className="sticky top-0 hidden h-screen w-[268px] shrink-0 flex-col gap-7 overflow-y-auto bg-cafe px-5 py-7 text-sable-pale lg:flex">
      {children}
      <nav className="flex flex-col gap-1">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              clsx(
                'flex min-h-[44px] items-center gap-3 rounded-[6px] px-3 text-[14px] transition-colors',
                isActive ? 'bg-cafe-soft text-sable-pale' : 'text-[#C4B5A4] hover:text-sable-pale',
              )
            }
          >
            <span className="w-4 text-[15px]">{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
