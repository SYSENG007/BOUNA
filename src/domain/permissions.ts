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

const MANAGER: Permission[] = [
  ...SELLER, ...PREPARER, ...PROCUREMENT,
  'VOID_SALE', 'APPROVE_PURCHASE', 'CLOSE_DAY', 'VIEW_AUDIT_LOG', 'COUNT_INVENTORY',
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  SELLER, PREPARER, PROCUREMENT, FINANCE, MANAGER,
  OWNER: PERMISSIONS,
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
