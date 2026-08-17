/**
 * Capacités — ce qu'une personne a le droit de faire.
 *
 * Le poste ne détermine plus l'accès : il en propose un jeu de départ. Le reste
 * s'accorde et se retire opération par opération, par quelqu'un qui porte
 * MANAGE_TEAM. Un vendeur qui réceptionne le mardi matin reste vendeur — et il
 * n'a pas fallu de migration SQL pour lui en donner le droit.
 *
 * Un accord est un fait daté révocable, pas une case cochée : même logique que
 * les mouvements de stock. On n'écrase pas un état, on ajoute un fait. C'est ce
 * qui rend l'historique « qui a donné quoi à qui » gratuit et auditable.
 */

import type { UUID } from './types';

/* --------------------------------------------------------------- Features */

export const FEATURE_IDS = [
  'VENTE', 'STOCK', 'PRODUCTION', 'APPRO', 'FINANCE', 'PILOTAGE',
] as const;
export type FeatureId = (typeof FEATURE_IDS)[number];

/* ------------------------------------------------------------- Capacités */

export const CAPABILITIES = [
  /* Vente */
  'SELL', 'VOID_SALE', 'MANAGE_CASH_SESSION', 'VIEW_ALL_SALES',
  /* Stock */
  'VIEW_STOCK', 'RECORD_WASTE', 'TRANSFER_STOCK', 'COUNT_INVENTORY', 'RESOLVE_VARIANCE',
  /* Production */
  'PRODUCE', 'EDIT_RECIPE',
  /* Approvisionnement */
  'REQUEST_PURCHASE', 'APPROVE_PURCHASE', 'PLACE_ORDER', 'RECEIVE_GOODS', 'MANAGE_SUPPLIERS',
  /* Finance */
  'RECORD_EXPENSE', 'VIEW_FINANCES', 'CLOSE_DAY', 'REOPEN_DAY',
  /* Pilotage */
  'VIEW_DASHBOARD', 'MANAGE_CATALOG', 'MANAGE_LOCATIONS', 'MANAGE_TEAM', 'VIEW_AUDIT_LOG',
  'MANAGE_SETTINGS', 'RUN_SIMULATION',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/**
 * Libellés tels que le manager les lit quand il accorde un droit, et tels que
 * l'utilisateur les lit dans son tiroir d'opérations. Un seul vocabulaire des
 * deux côtés : c'est ce qui rend la délégation compréhensible sans notice.
 */
export const CAPABILITY_LABEL: Record<Capability, string> = {
  SELL: 'Enregistrer une vente',
  VOID_SALE: 'Annuler une vente',
  MANAGE_CASH_SESSION: 'Ouvrir et fermer la caisse',
  VIEW_ALL_SALES: "Voir les ventes de toute l'équipe",

  VIEW_STOCK: 'Consulter le stock',
  RECORD_WASTE: 'Déclarer une perte',
  TRANSFER_STOCK: 'Transférer du stock',
  COUNT_INVENTORY: 'Compter un emplacement',
  RESOLVE_VARIANCE: 'Solder un écart',

  PRODUCE: 'Lancer une préparation',
  EDIT_RECIPE: 'Modifier une recette',

  REQUEST_PURCHASE: 'Demander un achat',
  APPROVE_PURCHASE: 'Approuver une demande',
  PLACE_ORDER: 'Passer commande',
  RECEIVE_GOODS: 'Réceptionner une livraison',
  MANAGE_SUPPLIERS: 'Gérer les fournisseurs',

  RECORD_EXPENSE: 'Enregistrer une dépense',
  VIEW_FINANCES: 'Voir les marges et la trésorerie',
  CLOSE_DAY: 'Clôturer la journée',
  REOPEN_DAY: 'Rouvrir une journée clôturée',

  VIEW_DASHBOARD: 'Voir le tableau de bord',
  MANAGE_CATALOG: 'Gérer le catalogue',
  MANAGE_LOCATIONS: 'Gérer les emplacements',
  MANAGE_TEAM: "Gérer l'équipe et les accès",
  VIEW_AUDIT_LOG: 'Consulter le journal',
  /* Le libellé nomme l'effet, pas l'écran : ce réglage décide de ce que
     l'application exige de TOUTE l'équipe, pas seulement de qui l'ouvre. */
  MANAGE_SETTINGS: 'Choisir comment la maison suit ses coûts',
  /* Elle n'est pas rangée avec MANAGE_SETTINGS par hasard — mais elle en est
     bien distincte : entrer en simulation déplace la personne dans une autre
     maison, ce qu'aucun réglage ne fait. Deux décisions différentes, donc deux
     capacités révocables séparément. */
  RUN_SIMULATION: 'Simuler une journée sans toucher aux chiffres',
};

/** À quelle feature chaque capacité se rattache — la navigation en dépend. */
export const CAPABILITY_FEATURE: Record<Capability, FeatureId> = {
  SELL: 'VENTE', VOID_SALE: 'VENTE', MANAGE_CASH_SESSION: 'VENTE', VIEW_ALL_SALES: 'VENTE',

  VIEW_STOCK: 'STOCK', RECORD_WASTE: 'STOCK', TRANSFER_STOCK: 'STOCK',
  COUNT_INVENTORY: 'STOCK', RESOLVE_VARIANCE: 'STOCK',

  PRODUCE: 'PRODUCTION', EDIT_RECIPE: 'PRODUCTION',

  REQUEST_PURCHASE: 'APPRO', APPROVE_PURCHASE: 'APPRO', PLACE_ORDER: 'APPRO',
  RECEIVE_GOODS: 'APPRO', MANAGE_SUPPLIERS: 'APPRO',

  RECORD_EXPENSE: 'FINANCE', VIEW_FINANCES: 'FINANCE', CLOSE_DAY: 'FINANCE', REOPEN_DAY: 'FINANCE',

  VIEW_DASHBOARD: 'PILOTAGE', MANAGE_CATALOG: 'PILOTAGE', MANAGE_LOCATIONS: 'PILOTAGE',
  MANAGE_TEAM: 'PILOTAGE', VIEW_AUDIT_LOG: 'PILOTAGE', MANAGE_SETTINGS: 'PILOTAGE',
  RUN_SIMULATION: 'PILOTAGE',
};

/* ----------------------------------------------------------------- Postes */

/**
 * Le poste est une identité sociale : stable, unique, affichée. Les valeurs
 * reprennent celles de l'ancien enum `user_role` — la migration n'a donc rien
 * à réécrire côté données, seulement côté sens.
 */
export const POSTS = ['OWNER', 'MANAGER', 'FINANCE', 'PROCUREMENT', 'PREPARER', 'SELLER'] as const;
export type Post = (typeof POSTS)[number];

export const POST_LABEL: Record<Post, string> = {
  OWNER: 'Propriétaire',
  MANAGER: 'Manager',
  FINANCE: 'Responsable finance',
  PROCUREMENT: 'Approvisionneur',
  PREPARER: 'Préparateur',
  SELLER: 'Vendeur',
};

const SELLER_PRESET: Capability[] = [
  'SELL', 'VIEW_STOCK', 'MANAGE_CASH_SESSION', 'RECORD_WASTE',
];

const PREPARER_PRESET: Capability[] = [
  'PRODUCE', 'VIEW_STOCK', 'RECORD_WASTE', 'TRANSFER_STOCK', 'COUNT_INVENTORY',
];

const PROCUREMENT_PRESET: Capability[] = [
  'REQUEST_PURCHASE', 'PLACE_ORDER', 'RECEIVE_GOODS', 'MANAGE_SUPPLIERS',
  'VIEW_STOCK', 'RECORD_EXPENSE',
];

const FINANCE_PRESET: Capability[] = [
  'RECORD_EXPENSE', 'VIEW_FINANCES', 'VIEW_AUDIT_LOG', 'VIEW_STOCK',
  'VIEW_DASHBOARD', 'VIEW_ALL_SALES', 'MANAGE_SUPPLIERS', 'CLOSE_DAY',
];

/*
 * Le manager tient les trois métiers de terrain plus l'encadrement. Les trois
 * préréglages se recouvrent — VIEW_STOCK revient trois fois — donc on compose
 * puis on dédoublonne : une capacité accordée deux fois reste une capacité.
 */
const MANAGER_PRESET: Capability[] = [...new Set<Capability>([
  ...SELLER_PRESET, ...PREPARER_PRESET, ...PROCUREMENT_PRESET,
  'VOID_SALE', 'VIEW_ALL_SALES', 'RESOLVE_VARIANCE', 'EDIT_RECIPE',
  'APPROVE_PURCHASE', 'VIEW_FINANCES', 'CLOSE_DAY', 'VIEW_DASHBOARD',
  'MANAGE_CATALOG', 'MANAGE_LOCATIONS', 'MANAGE_TEAM', 'VIEW_AUDIT_LOG',
  /* Le régime d'exploitation fait partie de l'encadrement, pas du privilège du
     propriétaire : c'est le manager qui est là quand la méthode ne colle plus
     au terrain. Il reste révocable comme n'importe quelle autre capacité. */
  'MANAGE_SETTINGS',
  /* Éprouver une journée entière avant de la faire vivre à l'équipe est un
     geste d'encadrement, au même titre. Et c'est le manager, pas le
     propriétaire, qui forme quelqu'un un mardi matin. */
  'RUN_SIMULATION',
])];

/**
 * Ce qu'on coche par défaut à la création d'un compte. Rien d'autre : ce n'est
 * pas une règle d'autorisation, c'est un point de départ que le manager ajuste.
 */
export const POST_PRESET: Record<Post, readonly Capability[]> = {
  OWNER: CAPABILITIES,
  MANAGER: MANAGER_PRESET,
  FINANCE: FINANCE_PRESET,
  PROCUREMENT: PROCUREMENT_PRESET,
  PREPARER: PREPARER_PRESET,
  SELLER: SELLER_PRESET,
};

/* ---------------------------------------------------------------- Accords */

/**
 * Un accord de capacité. Révoquer n'efface pas la ligne : on date la
 * révocation. Le journal des délégations se lit alors sans reconstruction.
 */
export interface CapabilityGrant {
  id: UUID;
  userId: UUID;
  capability: Capability;
  grantedBy: UUID;
  grantedByName: string;
  grantedAt: string;
  revokedBy?: UUID;
  revokedByName?: string;
  revokedAt?: string;
}

/**
 * Les accords qui manquent parce que la capacité n'existait pas encore.
 *
 * Une nouvelle version peut introduire une capacité — `MANAGE_SETTINGS` en est
 * la première. Elle n'a alors été offerte à personne : elle n'apparaît nulle
 * part dans le journal des accords, ni accordée ni révoquée. Résultat, l'écran
 * qu'elle garde est inaccessible à TOUT LE MONDE, y compris à celui qui a
 * installé l'application — et personne ne peut se l'accorder, puisque même le
 * propriétaire ne l'a pas.
 *
 * On retombe donc sur la règle qui vaut déjà à la création d'un compte : le
 * poste PROPOSE un jeu de départ. Ce n'est pas une règle d'autorisation qui
 * reviendrait par la fenêtre — c'est le même geste, au même moment logique,
 * pour une capacité qui vient de naître.
 *
 * Le filtre est étroit et il compte : une capacité déjà présente dans le
 * journal, même RÉVOQUÉE, n'est jamais réaccordée. Retirer un droit reste un
 * fait daté qu'aucune mise à jour ne défait.
 *
 * Le serveur fait le même rattrapage de son côté (migration 0024) ; celui-ci
 * sert aux appareils, qui lisent leur état local bien avant la première
 * hydratation — et à l'application sans backend (RULE-010).
 */
export function backfillGrants(
  grants: readonly CapabilityGrant[],
  users: readonly { id: UUID; name: string; post: Post }[],
  at: string,
): CapabilityGrant[] {
  const known = new Set(grants.map((g) => `${g.userId}:${g.capability}`));
  const out: CapabilityGrant[] = [];

  for (const user of users) {
    for (const capability of POST_PRESET[user.post] ?? []) {
      if (known.has(`${user.id}:${capability}`)) continue;
      out.push({
        id: `backfill-${user.id}-${capability}`,
        userId: user.id,
        capability,
        grantedBy: user.id,
        grantedByName: user.name,
        grantedAt: at,
      });
    }
  }
  return out;
}

/** Les capacités effectives d'un utilisateur : les accords non révoqués. */
export function effectiveCapabilities(grants: CapabilityGrant[], userId: UUID): Capability[] {
  const out = new Set<Capability>();
  for (const g of grants) {
    if (g.userId !== userId || g.revokedAt) continue;
    out.add(g.capability);
  }
  return [...out];
}

export function holds(capabilities: readonly Capability[], capability: Capability): boolean {
  return capabilities.includes(capability);
}

/** Les capacités d'une feature que cet utilisateur détient réellement. */
export function capabilitiesOfFeature(
  capabilities: readonly Capability[],
  feature: FeatureId,
): Capability[] {
  return capabilities.filter((c) => CAPABILITY_FEATURE[c] === feature);
}

/** Les features dont l'utilisateur détient au moins une capacité. */
export function visibleFeatures(capabilities: readonly Capability[]): FeatureId[] {
  const seen = new Set<FeatureId>();
  for (const c of capabilities) seen.add(CAPABILITY_FEATURE[c]);
  return FEATURE_IDS.filter((f) => seen.has(f));
}
