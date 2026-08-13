import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { BunaProvider, useBuna } from './store/BunaStore';
import { CartProvider } from './screens/CartContext';
import { getNavForRoles, Sidebar, TabBar } from './design-system/components/navigation';
import { BunaLockup } from './design-system/components/BunaLogo';
import { SyncIndicator } from './design-system/components/SyncIndicator';
import { ROLE_LABEL } from './domain/types';

import { Login } from './screens/Login';
import { Pos } from './screens/seller/Pos';
import { Cart } from './screens/seller/Cart';
import { Payment } from './screens/seller/Payment';
import { Receipt } from './screens/seller/Receipt';
import { Orders } from './screens/seller/Orders';
import { Production } from './screens/preparer/Production';
import { NewBatch } from './screens/preparer/NewBatch';
import { Stock } from './screens/shared/Stock';
import { Waste } from './screens/shared/Waste';
import { Today } from './screens/manager/Today';
import { Closing } from './screens/manager/Closing';
import { Cockpit } from './screens/owner/Cockpit';
import { Replenishment } from './screens/procurement/Replenishment';
import { Purchase } from './screens/procurement/Purchase';
import { GoodsReceipt } from './screens/procurement/GoodsReceipt';
import { Finance } from './screens/finance/Finance';
import { NewExpense } from './screens/finance/NewExpense';
import { LocationManager } from './screens/manager/LocationManager';
import { CatalogManager } from './screens/manager/CatalogManager';
import { RecipeManager } from './screens/manager/RecipeManager';
import { Transfer } from './screens/shared/Transfer';
import { Alerts } from './screens/Alerts';
import { Catalogue } from './screens/catalogue/Catalogue';
import { InventoryCount } from './screens/shared/InventoryCount';
import { Flow } from './screens/Flow';
import { Profile } from './screens/Profile';

/** Écrans en plein flux : pas de barre d'onglets, l'utilisateur va au bout de son geste. */
const FULLSCREEN = [
  '/vendre/panier', '/vendre/encaissement', '/vendre/recu',
  '/production/batch', '/stock/perte', '/stock/inventaire', '/stock/transfert',
  '/cloture', '/achats/nouveau', '/achats/reception', '/finance/nouvelle-depense',
];

import { useAdaptive } from './design-system/hooks/useAdaptive';

function Shell() {
  const { user, logout } = useBuna();
  const { pathname } = useLocation();
  const { isMobile } = useAdaptive();

  if (!user) return <Login />;

  const items = getNavForRoles(user);
  const immersive = FULLSCREEN.includes(pathname);

  return (
    <div className="flex min-h-dvh bg-shell">
      {/* Sidebar is rendered dynamically for desktop only */}
      {!isMobile && (
        <Sidebar
          items={items}
          brand={<BunaLockup subtitle="OPERATIONS · OS" surface="cafe" size={42} />}
          footer={
            <>
              <div className="border-t border-[#4A362A] pt-4 flex items-center justify-between">
                <div>
                  <div className="text-[13.5px] font-medium text-sable-pale">{user.name}</div>
                  <div className="num mt-0.5 text-[10.5px] tracking-[0.14em] text-[#9E8B77]">
                    {user.roles.map((r) => ROLE_LABEL[r]).join(' · ').toUpperCase()}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={logout}
                  className="rounded px-2 py-1 text-[12px] font-medium text-[#B9A895] hover:bg-cafe-soft hover:text-sable-pale transition-colors"
                >
                  Déconnexion
                </button>
              </div>
              <SyncIndicator compact />
            </>
          }
        />
      )}

      <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
        <div
          className="shell-canvas flex flex-1 flex-col"
          style={isMobile && !immersive ? { paddingBottom: 'var(--tabbar-h)' } : undefined}
        >
          <Outlet />
        </div>
        {/* TabBar is rendered dynamically for mobile only, and hidden in immersive mode */}
        {isMobile && !immersive && <TabBar items={items} />}
      </div>
    </div>
  );
}

/** Redirige chaque rôle vers son écran d'accueil naturel (§90). */
function Home() {
  const { user } = useBuna();
  if (!user) return <Login />;
  return <Navigate to={getNavForRoles(user)[0].to} replace />;
}

export default function App() {
  return (
    <BunaProvider>
      <CartProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Shell />}>
              <Route path="/" element={<Home />} />

              <Route path="/vendre" element={<Pos />} />
              <Route path="/vendre/panier" element={<Cart />} />
              <Route path="/vendre/encaissement" element={<Payment />} />
              <Route path="/vendre/recu" element={<Receipt />} />
              <Route path="/commandes" element={<Orders />} />

              <Route path="/production" element={<Production />} />
              <Route path="/production/batch" element={<NewBatch />} />

              <Route path="/stock" element={<Stock />} />
              <Route path="/stock/perte" element={<Waste />} />
              <Route path="/stock/inventaire" element={<InventoryCount />} />
              <Route path="/stock/transfert" element={<Transfer />} />
              <Route path="/catalogue" element={<Catalogue />} />
              <Route path="/parcours" element={<Flow />} />

              <Route path="/aujourdhui" element={<Today />} />
              <Route path="/cloture" element={<Closing />} />
              <Route path="/alertes" element={<Alerts />} />

              <Route path="/cockpit" element={<Cockpit />} />
              <Route path="/finance" element={<Finance />} />
              <Route path="/finance/nouvelle-depense" element={<NewExpense />} />

              <Route path="/approvisionnement" element={<Replenishment />} />
              <Route path="/achats" element={<Replenishment />} />
              <Route path="/achats/nouveau" element={<Purchase />} />
              <Route path="/achats/reception" element={<GoodsReceipt />} />

              <Route path="/manager/emplacements" element={<LocationManager />} />
              <Route path="/manager/catalogue" element={<CatalogManager />} />
              <Route path="/manager/recettes" element={<RecipeManager />} />

              <Route path="/moi" element={<Profile />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </CartProvider>
    </BunaProvider>
  );
}
