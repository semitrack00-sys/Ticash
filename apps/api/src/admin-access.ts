import type { NextFunction, Request, Response } from 'express';

export const adminPermissions = [
  'admin.view',
  'staff.manage',
  'customers.view',
  'customers.restrict',
  'kyc.review',
  'transfers.view',
  'transfers.operate',
  'compliance.decide',
  'providers.view',
  'providers.manage',
  'configuration.view',
  'configuration.manage',
  'ledger.view',
  'reconciliation.view',
  'reconciliation.run',
  'audit.view',
] as const;

export type AdminPermission = typeof adminPermissions[number];
export type StaffRole = 'ADMIN' | 'SUPER_ADMIN' | 'COMPLIANCE' | 'OPERATIONS' | 'SUPPORT' | 'READ_ONLY';
export type AdminRequest = Request & { userId?: string; staffRole?: StaffRole; permissions?: AdminPermission[] };

const all = [...adminPermissions];
const permissionsByRole: Record<StaffRole, AdminPermission[]> = {
  ADMIN: all,
  SUPER_ADMIN: all,
  COMPLIANCE: [
    'admin.view', 'customers.view', 'customers.restrict', 'kyc.review',
    'transfers.view', 'compliance.decide', 'providers.view',
    'configuration.view', 'ledger.view', 'reconciliation.view', 'audit.view',
  ],
  OPERATIONS: [
    'admin.view', 'customers.view', 'transfers.view', 'transfers.operate',
    'providers.view', 'providers.manage', 'configuration.view', 'ledger.view',
    'reconciliation.view', 'reconciliation.run', 'audit.view',
  ],
  SUPPORT: ['admin.view', 'customers.view', 'transfers.view'],
  READ_ONLY: [
    'admin.view', 'customers.view', 'transfers.view', 'providers.view',
    'configuration.view', 'ledger.view', 'reconciliation.view', 'audit.view',
  ],
};

export function permissionsForRole(role: string | undefined): AdminPermission[] {
  return role && role in permissionsByRole ? [...permissionsByRole[role as StaffRole]] : [];
}

export function hasPermission(role: string | undefined, permission: AdminPermission): boolean {
  return permissionsForRole(role).includes(permission);
}

export function requirePermission(
  permission: AdminPermission,
  resolveRole: (userId: string) => Promise<string | undefined>,
) {
  return async (req: AdminRequest, res: Response, next: NextFunction) => {
    const role = await resolveRole(req.userId ?? '');
    if (!hasPermission(role, permission)) {
      res.status(403).json({
        error: 'This staff role is not authorized for the requested operation',
        code: 'ADMIN_PERMISSION_REQUIRED',
        requiredPermission: permission,
      });
      return;
    }
    req.staffRole = role as StaffRole;
    req.permissions = permissionsForRole(role);
    next();
  };
}
