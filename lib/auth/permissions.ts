export const ROLE_CODES = [
  "operator",
  "buyer",
  "senior-buyer",
  "manager",
  "finance",
  "admin",
  "read-only",
  "system-agent",
] as const;

export type RoleCode = (typeof ROLE_CODES)[number];

export const PERMISSIONS = {
  APP_READ: "app.read",
  APP_WRITE: "app.write",
  PROCUREMENT_WRITE: "procurement.write",
  PROCUREMENT_APPROVE: "procurement.approve",
  SUPPLIERS_WRITE: "suppliers.write",
  AGREEMENTS_WRITE: "agreements.write",
  AGREEMENTS_APPROVE: "agreements.approve",
  INVENTORY_WRITE: "inventory.write",
  INVENTORY_APPROVE: "inventory.approve",
  FINANCE_WRITE: "finance.write",
  FINANCE_APPROVE: "finance.approve",
  AGENTS_APPROVE: "agents.approve",
  EXCEPTIONS_MANAGE: "exceptions.manage",
  ADMIN_USERS: "admin.users",
  ADMIN_ROLES: "admin.roles",
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function permissionForRequest(pathname: string, method: string): PermissionCode {
  if (READ_METHODS.has(method.toUpperCase())) return PERMISSIONS.APP_READ;
  if (pathname === "/api/v1/auth/profile") return PERMISSIONS.APP_READ;
  if (pathname.startsWith("/api/v1/admin/")) return PERMISSIONS.ADMIN_USERS;
  if (pathname === "/api/v1/hs-code/import" || pathname === "/api/v1/impa/import") return PERMISSIONS.ADMIN_USERS;

  if (pathname.startsWith("/api/v1/agents/approvals")) return PERMISSIONS.AGENTS_APPROVE;
  if (pathname === "/api/v1/improvements" && method.toUpperCase() === "PATCH") return PERMISSIONS.AGENTS_APPROVE;
  if (pathname === "/api/v1/improvements/outcomes" && method.toUpperCase() === "PATCH") return PERMISSIONS.AGENTS_APPROVE;
  if (pathname === "/api/v1/improvements/evaluations") return PERMISSIONS.AGENTS_APPROVE;
  if (pathname.startsWith("/api/v1/agents/exceptions")) return PERMISSIONS.EXCEPTIONS_MANAGE;

  if (pathname.startsWith("/api/v1/finance")) {
    if (/\/(decision|resolve|prepare|transition)(\/|$)/.test(pathname)) return PERMISSIONS.FINANCE_APPROVE;
    return PERMISSIONS.FINANCE_WRITE;
  }

  if (pathname.startsWith("/api/v1/inventory")) {
    if (/\/decision(\/|$)/.test(pathname)) return PERMISSIONS.INVENTORY_APPROVE;
    return PERMISSIONS.INVENTORY_WRITE;
  }

  if (pathname.startsWith("/api/v1/agreements")) {
    if (pathname.startsWith("/api/v1/agreements/customer-contracts") && method.toUpperCase() === "PATCH") return PERMISSIONS.AGREEMENTS_APPROVE;
    if (/\/review(\/|$)/.test(pathname)) return PERMISSIONS.AGREEMENTS_APPROVE;
    return PERMISSIONS.AGREEMENTS_WRITE;
  }

  if (pathname.startsWith("/api/v1/suppliers") || pathname.startsWith("/api/v1/shipping-companies")) {
    return PERMISSIONS.SUPPLIERS_WRITE;
  }

  if (
    pathname.startsWith("/api/v1/purchase-orders") ||
    pathname.startsWith("/api/v1/rfq") ||
    pathname.startsWith("/api/v1/backorders") ||
    pathname.startsWith("/api/v1/supplier-inquiries") ||
    pathname.startsWith("/api/v1/customer-quotes") ||
    pathname.startsWith("/api/v1/sales-orders")
  ) {
    if (/\/(agent-review|decision)(\/|$)/.test(pathname)) return PERMISSIONS.PROCUREMENT_APPROVE;
    return PERMISSIONS.PROCUREMENT_WRITE;
  }

  return PERMISSIONS.APP_WRITE;
}
