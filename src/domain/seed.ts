import type {
  CashSession, Expense, Item, Purchase, Recipe, RecipeVersion, Site,
  StockLocation, StockMovement, Supplier, User, AuditEvent, Notification,
} from './types';
import type { Capability, Post } from './capabilities';
import { POST_PRESET } from './capabilities';
import type { Actor } from './actor';
import type { CapabilityGrant } from './capabilities';

/**
 * Jeu de données de démonstration — Coffee Bar Auchan, mardi 12 août.
 * Reprend les chiffres des maquettes pour que l'app démarre sur un état crédible.
 * Sera remplacé par la synchronisation PowerSync dès que le backend est branché.
 */

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

/**
 * Chacun a un poste et un jeu de capacités. Baboy portait trois rôles pour
 * pouvoir préparer et réceptionner ; il n'en a plus besoin — son poste est
 * manager, et ses capacités couvrent le terrain.
 *
 * Ibou est l'exemple qui a motivé la refonte : vendeur, mais il réceptionne le
 * mardi matin. On lui a donc accordé RECEIVE_GOODS en plus de son préréglage.
 */
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
  seedUser('u-ibou', 'Ibou', 'SELLER', ['RECEIVE_GOODS', 'COUNT_INVENTORY']),
];

/** Tampon d'auteur pour les faits de démonstration. */
function seedActor(userId: string, under: Capability, at: string): Actor {
  const u = USERS.find((x) => x.id === userId);
  return {
    userId,
    userName: u?.name ?? 'Inconnu',
    post: u?.post ?? 'SELLER',
    under,
    deviceId: 'seed',
    at,
  };
}

export const SUPPLIERS: Supplier[] = [
  { id: 'sup-laiterie', name: 'Laiterie du Terroir', phone: '77 812 44 10', contact: 'M. Sarr' },
  { id: 'sup-cafe', name: 'Torréfaction Dakar', phone: '76 330 09 55', contact: 'Mme Faye' },
  { id: 'sup-emballage', name: 'Emballages Plus', phone: '78 221 76 03' },
];

/* Matières, emballages, produits finis. Coûts en FCFA par unité de l'article. */
export const ITEMS: Item[] = [
  { id: 'it-lait', name: 'Lait entier', kind: 'RAW_MATERIAL', unit: 'L', minimumStock: 10, targetStock: 30, weightedAvgCost: 1062, preferredSupplierId: 'sup-laiterie' },
  { id: 'it-cafe', name: 'Café en grains', kind: 'RAW_MATERIAL', unit: 'kg', minimumStock: 8, targetStock: 25, weightedAvgCost: 4500, preferredSupplierId: 'sup-cafe' },
  { id: 'it-sirop-van', name: 'Sirop vanille', kind: 'RAW_MATERIAL', unit: 'L', minimumStock: 3, targetStock: 10, weightedAvgCost: 3200 },
  { id: 'it-sirop-car', name: 'Sirop caramel', kind: 'RAW_MATERIAL', unit: 'L', minimumStock: 3, targetStock: 10, weightedAvgCost: 3300 },
  { id: 'it-matcha', name: 'Poudre matcha', kind: 'RAW_MATERIAL', unit: 'kg', minimumStock: 1, targetStock: 4, weightedAvgCost: 22000 },
  { id: 'it-glace', name: 'Glaçons', kind: 'RAW_MATERIAL', unit: 'kg', minimumStock: 10, targetStock: 40, weightedAvgCost: 200 },
  { id: 'it-gobelet', name: 'Gobelets 16 oz', kind: 'PACKAGING', unit: 'unite', minimumStock: 200, targetStock: 800, weightedAvgCost: 28, preferredSupplierId: 'sup-emballage' },
  { id: 'it-couvercle', name: 'Couvercles', kind: 'PACKAGING', unit: 'unite', minimumStock: 200, targetStock: 800, weightedAvgCost: 12 },
  { id: 'it-paille', name: 'Pailles', kind: 'PACKAGING', unit: 'unite', minimumStock: 200, targetStock: 800, weightedAvgCost: 6 },

  { id: 'it-vanilla', name: 'Vanilla Iced Coffee', kind: 'FINISHED', unit: 'unite', price: 2500, weightedAvgCost: 1020, minimumStock: 10, targetStock: 40 },
  { id: 'it-caramel', name: 'Caramel Latte', kind: 'FINISHED', unit: 'unite', price: 2500, weightedAvgCost: 1080, minimumStock: 10, targetStock: 40 },
  { id: 'it-mocha', name: 'Mocha Iced Coffee', kind: 'FINISHED', unit: 'unite', price: 2500, weightedAvgCost: 1110, minimumStock: 8, targetStock: 30 },
  { id: 'it-matcha-latte', name: 'Matcha Latte', kind: 'FINISHED', unit: 'unite', price: 2500, weightedAvgCost: 1240, minimumStock: 6, targetStock: 24 },
  { id: 'it-coldbrew', name: 'Cold Brew', kind: 'FINISHED', unit: 'unite', price: 3000, weightedAvgCost: 1160, minimumStock: 6, targetStock: 24 },
  { id: 'it-tonic', name: 'Espresso Tonic', kind: 'FINISHED', unit: 'unite', price: 3000, weightedAvgCost: 1290, minimumStock: 5, targetStock: 20 },
];

/* Recettes — Vanilla reprend la BOM du PRD §25 (adaptée aux unités d'achat). */
export const RECIPE_VERSIONS: RecipeVersion[] = [
  {
    id: 'rv-vanilla-2', recipeId: 'rc-vanilla', version: 2, frozen: true,
    ingredients: [
      { itemId: 'it-cafe', quantity: 20, unit: 'g' },
      { itemId: 'it-lait', quantity: 150, unit: 'mL' },
      { itemId: 'it-sirop-van', quantity: 30, unit: 'mL' },
      { itemId: 'it-glace', quantity: 150, unit: 'g' },
      { itemId: 'it-gobelet', quantity: 1, unit: 'unite' },
      { itemId: 'it-couvercle', quantity: 1, unit: 'unite' },
      { itemId: 'it-paille', quantity: 1, unit: 'unite' },
    ],
  },
  {
    id: 'rv-caramel-1', recipeId: 'rc-caramel', version: 1, frozen: true,
    ingredients: [
      { itemId: 'it-cafe', quantity: 20, unit: 'g' },
      { itemId: 'it-lait', quantity: 180, unit: 'mL' },
      { itemId: 'it-sirop-car', quantity: 30, unit: 'mL' },
      { itemId: 'it-glace', quantity: 120, unit: 'g' },
      { itemId: 'it-gobelet', quantity: 1, unit: 'unite' },
      { itemId: 'it-couvercle', quantity: 1, unit: 'unite' },
      { itemId: 'it-paille', quantity: 1, unit: 'unite' },
    ],
  },
];

export const RECIPES: Recipe[] = [
  { id: 'rc-vanilla', itemId: 'it-vanilla', name: 'Vanilla Iced Coffee', currentVersionId: 'rv-vanilla-2' },
  { id: 'rc-caramel', itemId: 'it-caramel', name: 'Caramel Latte', currentVersionId: 'rv-caramel-1' },
];

const now = new Date();
const iso = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 3600_000).toISOString();

/** Mouvements d'ouverture : le stock affiché découle de ces lignes, jamais d'un champ. */
export const SEED_MOVEMENTS: StockMovement[] = [
  ['it-lait', LOC.FRIDGE, 6.2, 'L'],
  ['it-cafe', LOC.CENTRAL, 17.1, 'kg'],
  ['it-sirop-van', LOC.KITCHEN, 4.1, 'L'],
  ['it-sirop-car', LOC.KITCHEN, 5.4, 'L'],
  ['it-matcha', LOC.KITCHEN, 2.2, 'kg'],
  ['it-glace', LOC.FRIDGE, 18, 'kg'],
  ['it-gobelet', LOC.CENTRAL, 640, 'unite'],
  ['it-couvercle', LOC.CENTRAL, 610, 'unite'],
  ['it-paille', LOC.CENTRAL, 580, 'unite'],
  ['it-vanilla', LOC.POS, 18, 'unite'],
  ['it-caramel', LOC.POS, 12, 'unite'],
  ['it-mocha', LOC.POS, 9, 'unite'],
  ['it-matcha-latte', LOC.POS, 7, 'unite'],
  ['it-coldbrew', LOC.POS, 6, 'unite'],
  ['it-tonic', LOC.POS, 5, 'unite'],
].map(([itemId, locationId, quantity, unit], i) => ({
  id: `mv-seed-${i}`,
  organizationId: ORG_ID,
  siteId: SITE.id,
  locationId: locationId as string,
  itemId: itemId as string,
  quantity: quantity as number,
  unit: unit as Item['unit'],
  movementType: 'INITIAL' as const,
  referenceType: 'SEED',
  referenceId: 'seed',
  userId: 'u-baboy',
  deviceId: 'seed',
  createdAt: iso(12),
  actor: seedActor('u-baboy', 'COUNT_INVENTORY', iso(12)),
}));

export const SEED_CASH_SESSION: CashSession = {
  id: 'cs-shift-2',
  siteId: SITE.id,
  sellerId: 'u-ibou',
  shiftNumber: 2,
  openingCash: 25000,
  countedCash: null,
  openedAt: iso(2),
  closedAt: null,
};

export const SEED_EXPENSES: Expense[] = [
  { id: 'ex-1', amount: 22000, category: 'MATIERE', description: 'Achat lait — Laiterie du Terroir', supplierId: 'sup-laiterie', paymentMethod: 'CASH', userId: 'u-baboy', createdAt: iso(11), actor: seedActor('u-baboy', 'RECORD_EXPENSE', iso(11)) },
  { id: 'ex-2', amount: 14000, category: 'EMBALLAGE', description: 'Gobelets 16 oz × 500', supplierId: 'sup-emballage', paymentMethod: 'MOBILE_MONEY', userId: 'u-baboy', createdAt: iso(10), actor: seedActor('u-baboy', 'RECORD_EXPENSE', iso(10)) },
  { id: 'ex-3', amount: 14000, category: 'TRANSPORT', description: 'Transport marché → cuisine', paymentMethod: 'CASH', userId: 'u-baboy', createdAt: iso(8), actor: seedActor('u-baboy', 'RECORD_EXPENSE', iso(8)) },
  { id: 'ex-4', amount: 18000, category: 'ENERGIE', description: 'Recharge électricité', paymentMethod: 'MOBILE_MONEY', userId: 'u-matel', createdAt: iso(5), actor: seedActor('u-matel', 'RECORD_EXPENSE', iso(5)) },
  { id: 'ex-5', amount: 10000, category: 'MATIERE', description: 'Glace — appoint', paymentMethod: 'CASH', userId: 'u-ibou', createdAt: iso(2), actor: seedActor('u-ibou', 'RECORD_EXPENSE', iso(2)) },
];

export const SEED_PURCHASES: Purchase[] = [
  {
    id: 'pu-1', supplierId: 'sup-laiterie', locationId: LOC.CENTRAL,
    lines: [
      { itemId: 'it-lait', quantity: 20, unit: 'bouteille', expectedUnitPrice: 1000, actualUnitPrice: 1100 },
      { itemId: 'it-cafe', quantity: 5, unit: 'kg', expectedUnitPrice: 4500, actualUnitPrice: 4500 },
      { itemId: 'it-sirop-van', quantity: 2, unit: 'L', expectedUnitPrice: 3200, actualUnitPrice: 3200 },
    ],
    transportCost: 2000, total: 52900, paymentMethod: 'CASH',
    createdAt: iso(11), receivedAt: iso(11),
    actor: seedActor('u-baboy', 'RECEIVE_GOODS', iso(11)),
  },
];

export const SEED_AUDIT: AuditEvent[] = [
  { id: 'au-1', actor: seedActor('u-ibou', 'SELL', iso(3)), action: 'Vente #453 — 5 000 FCFA', detail: '2 Vanilla Iced Coffee · Espèces', reference: 'sale:453', createdAt: iso(3) },
  { id: 'au-2', actor: seedActor('u-matel', 'VOID_SALE', iso(2.7)), action: 'Annulation vente #453', detail: 'motif : erreur de saisie · validée', reference: 'sale:453', createdAt: iso(2.7) },
  { id: 'au-3', actor: seedActor('u-baboy', 'PRODUCE', iso(2.5)), action: 'Batch #B-20260812-04', detail: '27/30 unités · rendement 90 %', reference: 'batch:04', createdAt: iso(2.5) },
  { id: 'au-4', actor: seedActor('u-baboy', 'TRANSFER_STOCK', iso(2.2)), action: 'Transfert vers Coffee Bar Auchan', detail: '18 unités Vanilla · 9 conservées au froid', reference: 'transfer:12', createdAt: iso(2.2) },
];

export const SEED_NOTIFICATIONS: Notification[] = [
  {
    id: 'nt-1', title: 'Stock de lait faible', body: '6,2 L en frigo · rupture estimée demain 16 h',
    severity: 'ACTION_REQUIRED', status: 'UNREAD',
    actionLabel: 'Ajouter 24 L au bon', actionTarget: '/appro',
    recipientCapabilities: ['REQUEST_PURCHASE', 'PLACE_ORDER'], createdAt: iso(1),
  },
  {
    id: 'nt-2', title: 'Production Vanilla insuffisante', body: '18 unités pour 25 ventes attendues 18–20 h',
    severity: 'ACTION_REQUIRED', status: 'UNREAD',
    actionLabel: 'Lancer un batch de 20', actionTarget: '/production/preparation',
    recipientCapabilities: ['PRODUCE'], createdAt: iso(0.6),
  },
  {
    id: 'nt-3', title: 'Prix du lait +9 % vs dernier achat', body: '1 100 FCFA/L contre 1 010 FCFA/L · Laiterie du Terroir',
    severity: 'ATTENTION', status: 'UNREAD',
    actionLabel: 'Comparer les fournisseurs', actionTarget: '/appro',
    recipientCapabilities: ['MANAGE_SUPPLIERS', 'PLACE_ORDER'], createdAt: iso(9),
  },
];

/**
 * Le journal des délégations au démarrage.
 *
 * Chaque capacité d'un compte est un accord daté, signé par le propriétaire.
 * Ce n'est pas de la décoration : c'est ce que l'écran Équipe lit et modifie,
 * et ce qui rend « qui a donné ce droit à Ibou ? » répondable.
 */
export const SEED_GRANTS: CapabilityGrant[] = USERS.flatMap((u) =>
  u.capabilities.map((capability) => ({
    id: `gr-${u.id}-${capability}`,
    userId: u.id,
    capability,
    grantedBy: 'u-bouna',
    grantedByName: 'Bouna',
    grantedAt: iso(72),
  })),
);
