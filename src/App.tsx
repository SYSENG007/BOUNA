import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { BunaProvider, useBuna } from './store/BunaStore';
import { CartProvider } from './features/vente/CartContext';
import { AppShell } from './shell/AppShell';
import { Login } from './shell/Login';
import { homeFor } from './shell/navigation';
import type { Capability } from './domain/capabilities';

import { Pos } from './features/vente/screens/Pos';
import { Cart } from './features/vente/screens/Cart';
import { Payment } from './features/vente/screens/Payment';
import { Receipt } from './features/vente/screens/Receipt';
import { Orders } from './features/vente/screens/Orders';

import { Stock } from './features/stock/screens/Stock';
import { Waste } from './features/stock/screens/Waste';
import { Transfer } from './features/stock/screens/Transfer';
import { InventoryCount } from './features/stock/screens/InventoryCount';
import { Ecarts } from './features/stock/screens/Ecarts';

import { Production } from './features/production/screens/Production';
import { NewBatch } from './features/production/screens/NewBatch';
import { RecipeManager } from './features/production/screens/RecipeManager';

import { Replenishment } from './features/appro/screens/Replenishment';
import { Purchase } from './features/appro/screens/Purchase';
import { GoodsReceipt } from './features/appro/screens/GoodsReceipt';

import { Finance } from './features/finance/screens/Finance';
import { NewExpense } from './features/finance/screens/NewExpense';
import { Tresorerie } from './features/finance/screens/Tresorerie';
import { Closing } from './features/finance/screens/Closing';

import { Dashboard } from './features/pilotage/screens/Dashboard';
import { Equipe } from './features/pilotage/screens/Equipe';
import { Journal } from './features/pilotage/screens/Journal';
import { CatalogManager } from './features/pilotage/screens/CatalogManager';
import { LocationManager } from './features/pilotage/screens/LocationManager';
import { Catalogue } from './features/pilotage/screens/Catalogue';
import { Alertes } from './features/pilotage/screens/Alertes';
import { Profil } from './features/pilotage/screens/Profil';

/**
 * Garde de route.
 *
 * Ce qu'on ne peut pas faire n'existe pas : la navigation ne le propose pas, et
 * l'URL n'y mène pas non plus — elle ramène chez soi, sans commentaire.
 * Annoncer « vous n'avez pas accès » nomme une porte que la personne ne peut
 * pas ouvrir ; elle repart avec une question au lieu d'un écran utile.
 *
 * La garde ne protège rien par elle-même : c'est RLS qui protège. Elle décide
 * seulement de ce qu'on montre.
 */
function Guard({ need, children }: { need: Capability[]; children: React.ReactNode }) {
  const { user } = useBuna();
  if (!user) return <Login />;
  if (need.some((c) => user.capabilities.includes(c))) return <>{children}</>;
  return <Navigate to={homeFor(user.capabilities)} replace />;
}

const guard = (need: Capability[], element: React.ReactNode) => <Guard need={need}>{element}</Guard>;

/** Chacun atterrit sur ce que ses capacités rendent utile (§ registre). */
function Home() {
  const { user } = useBuna();
  if (!user) return <Login />;
  return <Navigate to={homeFor(user.capabilities)} replace />;
}

export default function App() {
  return (
    <BunaProvider>
      <CartProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/" element={<Home />} />

              {/* Vente */}
              <Route path="/vente" element={guard(['SELL'], <Pos />)} />
              <Route path="/vente/panier" element={guard(['SELL'], <Cart />)} />
              <Route path="/vente/encaissement" element={guard(['SELL'], <Payment />)} />
              <Route path="/vente/recu" element={guard(['SELL'], <Receipt />)} />
              <Route path="/vente/historique" element={guard(['SELL', 'VIEW_ALL_SALES'], <Orders />)} />

              {/* Stock */}
              <Route path="/stock" element={guard(['VIEW_STOCK'], <Stock />)} />
              <Route path="/stock/perte" element={guard(['RECORD_WASTE'], <Waste />)} />
              <Route path="/stock/transfert" element={guard(['TRANSFER_STOCK'], <Transfer />)} />
              <Route path="/stock/inventaire" element={guard(['COUNT_INVENTORY'], <InventoryCount />)} />
              <Route path="/stock/ecarts" element={guard(['RESOLVE_VARIANCE'], <Ecarts />)} />

              {/* Production */}
              <Route path="/production" element={guard(['PRODUCE'], <Production />)} />
              <Route path="/production/preparation" element={guard(['PRODUCE'], <NewBatch />)} />
              <Route path="/production/recettes" element={guard(['EDIT_RECIPE'], <RecipeManager />)} />

              {/* Approvisionnement */}
              <Route path="/appro" element={guard(['REQUEST_PURCHASE', 'PLACE_ORDER'], <Replenishment />)} />
              <Route path="/appro/commande" element={guard(['PLACE_ORDER'], <Purchase />)} />
              <Route path="/appro/reception" element={guard(['RECEIVE_GOODS'], <GoodsReceipt />)} />

              {/* Finance */}
              <Route path="/finance" element={guard(['RECORD_EXPENSE', 'VIEW_FINANCES'], <Finance />)} />
              <Route path="/finance/depense" element={guard(['RECORD_EXPENSE'], <NewExpense />)} />
              <Route path="/finance/tresorerie" element={guard(['VIEW_FINANCES'], <Tresorerie />)} />
              <Route path="/finance/caisse" element={guard(['MANAGE_CASH_SESSION', 'CLOSE_DAY'], <Closing />)} />

              {/* Pilotage */}
              <Route path="/pilotage" element={guard(['VIEW_DASHBOARD'], <Dashboard />)} />
              <Route path="/pilotage/equipe" element={guard(['MANAGE_TEAM'], <Equipe />)} />
              <Route path="/pilotage/journal" element={guard(['VIEW_AUDIT_LOG'], <Journal />)} />
              <Route path="/pilotage/catalogue" element={guard(['MANAGE_CATALOG'], <CatalogManager />)} />
              <Route path="/pilotage/emplacements" element={guard(['MANAGE_LOCATIONS'], <LocationManager />)} />

              <Route path="/catalogue" element={guard(['VIEW_STOCK'], <Catalogue />)} />
              <Route path="/alertes" element={<Alertes />} />
              <Route path="/moi" element={<Profil />} />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </CartProvider>
    </BunaProvider>
  );
}
