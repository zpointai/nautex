-- DR-2 authentication and RBAC foundation. Additive only.

CREATE TYPE "UserStatus" AS ENUM ('Active', 'Suspended', 'Disabled');

CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'Active',
    "last_login_at" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "id_token" TEXT,
    "access_token_expires_at" TIMESTAMP(3),
    "refresh_token_expires_at" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "verifications" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "permissions" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "role_permissions" (
    "role_id" TEXT NOT NULL,
    "permission_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id", "permission_id")
);

CREATE TABLE "user_role_assignments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "user_role_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE INDEX "users_status_idx" ON "users"("status");
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");
CREATE UNIQUE INDEX "accounts_provider_id_account_id_key" ON "accounts"("provider_id", "account_id");
CREATE INDEX "accounts_user_id_idx" ON "accounts"("user_id");
CREATE INDEX "verifications_identifier_idx" ON "verifications"("identifier");
CREATE INDEX "verifications_expires_at_idx" ON "verifications"("expires_at");
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");
CREATE INDEX "role_permissions_permission_id_idx" ON "role_permissions"("permission_id");
CREATE UNIQUE INDEX "user_role_assignments_user_id_role_id_key" ON "user_role_assignments"("user_id", "role_id");
CREATE INDEX "user_role_assignments_role_id_idx" ON "user_role_assignments"("role_id");

ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "roles" ("id", "code", "name", "description", "is_system", "updated_at") VALUES
('role-operator', 'operator', 'Operator', 'General operational processing without approval authority.', true, CURRENT_TIMESTAMP),
('role-buyer', 'buyer', 'Buyer', 'Procurement and supplier maintenance.', true, CURRENT_TIMESTAMP),
('role-senior-buyer', 'senior-buyer', 'Senior Buyer', 'Procurement approval and senior buying controls.', true, CURRENT_TIMESTAMP),
('role-manager', 'manager', 'Manager', 'Cross-module operational approval authority.', true, CURRENT_TIMESTAMP),
('role-finance', 'finance', 'Finance', 'Finance processing and approval authority.', true, CURRENT_TIMESTAMP),
('role-admin', 'admin', 'Administrator', 'System administration and unrestricted application access.', true, CURRENT_TIMESTAMP),
('role-read-only', 'read-only', 'Read Only', 'Application read access without mutation rights.', true, CURRENT_TIMESTAMP),
('role-system-agent', 'system-agent', 'System Agent', 'Non-human automation identity without human approval authority.', true, CURRENT_TIMESTAMP);

INSERT INTO "permissions" ("id", "code", "description", "updated_at") VALUES
('perm-app-read', 'app.read', 'Read authenticated application data.', CURRENT_TIMESTAMP),
('perm-app-write', 'app.write', 'Perform general application mutations.', CURRENT_TIMESTAMP),
('perm-procurement-write', 'procurement.write', 'Create and update procurement records.', CURRENT_TIMESTAMP),
('perm-procurement-approve', 'procurement.approve', 'Approve procurement decisions.', CURRENT_TIMESTAMP),
('perm-suppliers-write', 'suppliers.write', 'Create and maintain suppliers.', CURRENT_TIMESTAMP),
('perm-agreements-write', 'agreements.write', 'Create and maintain agreements.', CURRENT_TIMESTAMP),
('perm-agreements-approve', 'agreements.approve', 'Approve and activate agreements.', CURRENT_TIMESTAMP),
('perm-inventory-write', 'inventory.write', 'Adjust and move inventory.', CURRENT_TIMESTAMP),
('perm-inventory-approve', 'inventory.approve', 'Approve inventory control decisions.', CURRENT_TIMESTAMP),
('perm-finance-write', 'finance.write', 'Create and maintain finance records.', CURRENT_TIMESTAMP),
('perm-finance-approve', 'finance.approve', 'Approve finance decisions and postings.', CURRENT_TIMESTAMP),
('perm-agents-approve', 'agents.approve', 'Resolve agent approval requests.', CURRENT_TIMESTAMP),
('perm-exceptions-manage', 'exceptions.manage', 'Review, resolve, dismiss, and reopen exceptions.', CURRENT_TIMESTAMP),
('perm-admin-users', 'admin.users', 'Administer user accounts and role assignments.', CURRENT_TIMESTAMP),
('perm-admin-roles', 'admin.roles', 'Administer roles and permissions.', CURRENT_TIMESTAMP);

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE
    r."code" = 'admin'
    OR p."code" = 'app.read'
    OR (r."code" IN ('operator', 'buyer', 'senior-buyer', 'manager', 'finance', 'system-agent') AND p."code" = 'app.write')
    OR (r."code" IN ('operator', 'buyer', 'senior-buyer', 'manager', 'system-agent') AND p."code" IN ('procurement.write', 'inventory.write', 'exceptions.manage'))
    OR (r."code" IN ('buyer', 'senior-buyer', 'manager') AND p."code" IN ('suppliers.write', 'agreements.write'))
    OR (r."code" IN ('senior-buyer', 'manager') AND p."code" IN ('procurement.approve', 'agreements.approve', 'inventory.approve', 'agents.approve'))
    OR (r."code" IN ('manager', 'finance') AND p."code" IN ('finance.write', 'finance.approve'))
    OR (r."code" = 'finance' AND p."code" = 'exceptions.manage');
