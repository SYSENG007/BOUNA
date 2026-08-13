import type { Role } from './types';

/** §7 — RBAC. Les permissions critiques restent revalidées côté serveur (RLS + Edge Functions). */
export const PERMISSIONS = [
  'CREATE_SALE', 'VOID_SALE', 'VIEW_POS_STOCK', 'CLOSE_OWN_CASH_SESSION',
  'START_BATCH', 'RECORD_WASTE', 'TRANSFER_STOCK', 'COUNT_INVENTORY',
  'CREATE_PURCHASE', 'RECEIVE_GOODS', 'VIEW_SUPPLIERS', 'APPROVE_PURCHASE',
  'EDIT_RECIPE', 'MODIFY_PRODUCT_COST', 'VIEW_FULL_COMPANY_PROFIT',
  'CLOSE_DAY', 'MANAGE_USERS', 'VIEW_AUDIT_LOG', 'RECORD_EXPENSE',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const SELLER: Permission[] = ['CREATE_SALE', 'VIEW_POS_STOCK', 'CLOSE_OWN_CASH_SESSION', 'RECORD_WASTE'];

const PREPARER: Permission[] = ['START_BATCH', 'RECORD_WASTE', 'TRANSFER_STOCK', 'VIEW_POS_STOCK', 'COUNT_INVENTORY'];

const PROCUREMENT: Permission[] = [
  'CREATE_PURCHASE', 'RECEIVE_GOODS', 'VIEW_SUPPLIERS', 'VIEW_POS_STOCK', 'RECORD_EXPENSE',
];

const FINANCE: Permission[] = [
  'RECORD_EXPENSE', 'VIEW_SUPPLIERS', 'VIEW_FULL_COMPANY_PROFIT', 'VIEW_AUDIT_LOG', 'VIEW_POS_STOCK',
];

/*
 * Le manager hérite des trois métiers de terrain. Les trois partagent des
 * droits — VIEW_POS_STOCK revient trois fois, RECORD_WASTE deux — donc on
 * compose puis on dédoublonne : un droit accordé deux fois reste un droit.
 */
const MANAGER: Permission[] = [...new Set<Permission>([
  ...SELLER, ...PREPARER, ...PROCUREMENT,
  'VOID_SALE', 'APPROVE_PURCHASE', 'CLOSE_DAY', 'VIEW_AUDIT_LOG',
])];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  SELLER, PREPARER, PROCUREMENT, FINANCE, MANAGER,
  OWNER: PERMISSIONS,
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Check if ANY of a user's roles grants a permission. */
export function canAny(roles: Role[], permission: Permission): boolean {
  return roles.some((r) => ROLE_PERMISSIONS[r].includes(permission));
}

/** Get all unique permissions across multiple roles. */
export function permissionsForRoles(roles: Role[]): Permission[] {
  return [...new Set(roles.flatMap((r) => [...ROLE_PERMISSIONS[r]]))];
}
