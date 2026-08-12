import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { BunaProvider, useBuna } from './store/BunaStore';
import { CartProvider } from './screens/CartContext';
import { NAV_BY_ROLE, Sidebar, TabBar } from './design-system/components/navigation';
import { BunaLockup } from './design-system/components/BunaLogo';
import { SyncIndicator } from './design-system/components/SyncIndicator';

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
import { Alerts } from './screens/Alerts';
import { Catalogue } from './screens/catalogue/Catalogue';
import { InventoryCount } from './screens/shared/InventoryCount';
import { Flow } from './screens/Flow';
import { Profile } from './screens/Profile';

/** Écrans en plein flux : pas de barre d'onglets, l'utilisateur va au bout de son geste. */
const FULLSCREEN = [
  '/vendre/panier', '/vendre/encaissement', '/vendre/recu',
  '/production/batch', '/stock/perte', '/stock/inventaire', '/cloture',
  '/achats/nouveau', '/achats/reception',
];

function Shell() {
  const { user } = useBuna();
  const { pathname } = useLocation();

  if (!user) return <Login />;

  const items = NAV_BY_ROLE[user.role];
  const immersive = FULLSCREEN.includes(pathname);
  /* Owner et Finance travaillent assis : rail latéral dès le desktop. */
  const desktopRail = user.role === 'OWNER' || user.role === 'FINANCE';

  return (
    <div className={desktopRail ? 'flex min-h-dvh bg-shell' : 'min-h-dvh bg-ivoire'}>
      {desktopRail && (
        <Sidebar items={items}>
          <BunaLockup subtitle="OPERATIONS · OS" surface="cafe" size={42} />
          <div className="mt-auto">
            <SyncIndicator compact />
          </div>
        </Sidebar>
      )}

      <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
        <div className="flex flex-1 flex-col">
          <Outlet />
        </div>
        {!immersive && (
          <div className={desktopRail ? 'lg:hidden' : undefined}>
            <TabBar items={items} />
          </div>
        )}
      </div>
    </div>
  );
}

/** Redirige chaque rôle vers son écran d'accueil naturel (§90). */
function Home() {
  const { user } = useBuna();
  if (!user) return <Login />;
  return <Navigate to={NAV_BY_ROLE[user.role][0].to} replace />;
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
              <Route path="/catalogue" element={<Catalogue />} />
              <Route path="/parcours" element={<Flow />} />

              <Route path="/aujourdhui" element={<Today />} />
              <Route path="/cloture" element={<Closing />} />
              <Route path="/alertes" element={<Alerts />} />

              <Route path="/cockpit" element={<Cockpit />} />
              <Route path="/finance" element={<Finance />} />

              <Route path="/approvisionnement" element={<Replenishment />} />
              <Route path="/achats" element={<Replenishment />} />
              <Route path="/achats/nouveau" element={<Purchase />} />
              <Route path="/achats/reception" element={<GoodsReceipt />} />

              <Route path="/moi" element={<Profile />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </CartProvider>
    </BunaProvider>
  );
}
