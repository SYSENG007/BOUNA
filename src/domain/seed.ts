import type {
  CashSession, Expense, Item, Purchase, Recipe, RecipeVersion, Site,
  StockLocation, StockMovement, Supplier, User, AuditEvent, Notification,
} from './types';
import type { Capability, Post } from './capabilities';
import { POST_PRESET } from './capabilities';
import type { CapabilityGrant } from './capabilities';

export const ORG_ID = 'org-buna';
export const SITE: Site = { id: 'site-auchan', organizationId: ORG_ID, name: 'Coffee Bar Auchan' };

export const LOC = {
  CENTRAL: 'loc-central',
  KITCHEN: 'loc-kitchen',
  FRIDGE: 'loc-fridge',
  POS: 'loc-pos',
} as const;

export const LOCATIONS: StockLocation[] = [
  { id: LOC.CENTRAL, siteId: SITE.id, name: 'Stock principal', type: 'CENTRAL' },
  { id: LOC.KITCHEN, siteId: SITE.id, name: 'Cuisine', type: 'KITCHEN' },
  { id: LOC.FRIDGE, siteId: SITE.id, name: 'Frigo', type: 'FRIDGE' },
  { id: LOC.POS, siteId: SITE.id, name: 'Coffee Bar Auchan', type: 'POS' },
];

const seedUser = (
  id: string, name: string, post: Post, extra: Capability[] = [],
): User => ({
  id, organizationId: ORG_ID, name, post,
  capabilities: [...new Set<Capability>([...POST_PRESET[post], ...extra])],
  siteId: SITE.id, status: 'ACTIVE',
});

export const USERS: User[] = [
  seedUser('u-bouna', 'Bouna', 'OWNER'),
  seedUser('u-baboy', 'Baboy', 'MANAGER'),
  seedUser('u-matel', 'Matel', 'MANAGER'),
  seedUser('u-maty', 'Maty', 'FINANCE'),
  seedUser('u-ibrahima', 'Ibrahima', 'PREPARER'),
];

export const SUPPLIERS: Supplier[] = [
  { id: 'sup-laiterie', name: 'Laiterie du Terroir', phone: '77 812 44 10', contact: 'M. Sarr' },
  { id: 'sup-cafe', name: 'Torréfaction Dakar', phone: '76 330 09 55', contact: 'Mme Faye' },
  { id: 'sup-emballage', name: 'Emballages Plus', phone: '78 221 76 03' },
];

export const ITEMS: Item[] = [
  { id: '55555555-0000-0000-0000-000000000001', name: 'Cacao', kind: 'RAW_MATERIAL', unit: 'kg', minimumStock: 1, targetStock: 5, weightedAvgCost: 1825 },
  { id: '55555555-0000-0000-0000-000000000002', name: 'Lait concentré', kind: 'RAW_MATERIAL', unit: 'unite', minimumStock: 5, targetStock: 20 },
  { id: '55555555-0000-0000-0000-000000000003', name: 'Nutella', kind: 'RAW_MATERIAL', unit: 'unite', minimumStock: 2, targetStock: 10, weightedAvgCost: 6475 },
  { id: '55555555-0000-0000-0000-000000000004', name: 'Essence vanille', kind: 'RAW_MATERIAL', unit: 'L', minimumStock: 1, targetStock: 5 },
  { id: '55555555-0000-0000-0000-000000000005', name: 'Essence caramel', kind: 'RAW_MATERIAL', unit: 'L', minimumStock: 1, targetStock: 5 },
  { id: '55555555-0000-0000-0000-000000000006', name: 'Bouteille miel', kind: 'RAW_MATERIAL', unit: 'unite', minimumStock: 2, targetStock: 10 },
  { id: '55555555-0000-0000-0000-000000000007', name: 'Sucre 5Kg', kind: 'RAW_MATERIAL', unit: 'unite', minimumStock: 1, targetStock: 5 },
  { id: '55555555-0000-0000-0000-000000000008', name: 'Chantilly', kind: 'RAW_MATERIAL', unit: 'unite', minimumStock: 5, targetStock: 20, weightedAvgCost: 2790 },
  { id: '55555555-0000-0000-0000-000000000009', name: 'Lait Dano', kind: 'RAW_MATERIAL', unit: 'unite', minimumStock: 5, targetStock: 20, weightedAvgCost: 1550 },
  { id: '55555555-0000-0000-0000-000000000010', name: 'Pack paille', kind: 'PACKAGING', unit: 'unite', minimumStock: 2, targetStock: 10 },
  { id: '55555555-0000-0000-0000-000000000011', name: 'Pack gobelet PM', kind: 'PACKAGING', unit: 'unite', minimumStock: 5, targetStock: 20, weightedAvgCost: 2175 },
  { id: '55555555-0000-0000-0000-000000000012', name: 'Pack gobelet moyen', kind: 'PACKAGING', unit: 'unite', minimumStock: 5, targetStock: 20 },
  { id: '55555555-0000-0000-0000-000000000013', name: 'Pack gobelet GM', kind: 'PACKAGING', unit: 'unite', minimumStock: 5, targetStock: 20 },
  { id: '55555555-0000-0000-0000-000000000014', name: 'Pack bouteille 10L de 5', kind: 'PACKAGING', unit: 'unite', minimumStock: 2, targetStock: 10, weightedAvgCost: 1200 },

  /*
   * La carte réelle : trois boissons, trois contenances, trois prix.
   *
   * Chaque taille est un article à part entière — le POS vend un bouton, et le
   * prix doit être porté par ce qu'on touche. Toutes sont `MADE_TO_ORDER` :
   * elles sont montées devant le client, donc elles n'ont jamais de stock de
   * produit fini. Leur disponibilité tient aux gobelets, au lait et au café.
   */
  { id: '55555555-0000-0000-0000-000000000015', name: 'Café Touba · Petit', kind: 'FINISHED', unit: 'unite', price: 400, productionMode: 'MADE_TO_ORDER' },
  { id: '55555555-0000-0000-0000-000000000016', name: 'Café Touba · Moyen', kind: 'FINISHED', unit: 'unite', price: 700, productionMode: 'MADE_TO_ORDER' },
  { id: '55555555-0000-0000-0000-000000000017', name: 'Café Touba · Grand', kind: 'FINISHED', unit: 'unite', price: 1000, productionMode: 'MADE_TO_ORDER' },

  { id: '55555555-0000-0000-0000-000000000018', name: 'Café · Petit', kind: 'FINISHED', unit: 'unite', price: 400, productionMode: 'MADE_TO_ORDER' },
  { id: '55555555-0000-0000-0000-000000000019', name: 'Café · Moyen', kind: 'FINISHED', unit: 'unite', price: 700, productionMode: 'MADE_TO_ORDER' },
  { id: '55555555-0000-0000-0000-000000000020', name: 'Café · Grand', kind: 'FINISHED', unit: 'unite', price: 1000, productionMode: 'MADE_TO_ORDER' },

  { id: '55555555-0000-0000-0000-000000000021', name: 'Chocolat · Petit', kind: 'FINISHED', unit: 'unite', price: 400, productionMode: 'MADE_TO_ORDER' },
  { id: '55555555-0000-0000-0000-000000000022', name: 'Chocolat · Moyen', kind: 'FINISHED', unit: 'unite', price: 700, productionMode: 'MADE_TO_ORDER' },
  { id: '55555555-0000-0000-0000-000000000023', name: 'Chocolat · Grand', kind: 'FINISHED', unit: 'unite', price: 1000, productionMode: 'MADE_TO_ORDER' },
];

export const RECIPE_VERSIONS: RecipeVersion[] = [];
export const RECIPES: Recipe[] = [];

export const SEED_MOVEMENTS: StockMovement[] = [];

export const SEED_CASH_SESSION: CashSession = {
  id: 'cs-initial',
  siteId: SITE.id,
  sellerId: 'u-ibrahima',
  shiftNumber: 1,
  openingCash: 0,
  countedCash: null,
  openedAt: new Date().toISOString(),
  closedAt: new Date().toISOString(),
};

export const SEED_EXPENSES: Expense[] = [];
export const SEED_PURCHASES: Purchase[] = [];
export const SEED_AUDIT: AuditEvent[] = [];
export const SEED_NOTIFICATIONS: Notification[] = [];

export const SEED_GRANTS: CapabilityGrant[] = USERS.flatMap((u) =>
  u.capabilities.map((capability) => ({
    id: `gr-${u.id}-${capability}`,
    userId: u.id,
    capability,
    grantedBy: 'u-bouna',
    grantedByName: 'Bouna',
    grantedAt: new Date().toISOString(),
  })),
);
