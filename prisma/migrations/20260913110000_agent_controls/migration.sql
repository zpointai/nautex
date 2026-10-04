CREATE TABLE "agent_controls" (
  "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "agent_id" TEXT NOT NULL, "enabled" BOOLEAN NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0, "updated_by" TEXT NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("organization_id", "agent_id")
);
ALTER TYPE "AgentRunStatus" ADD VALUE 'Cancelled';
ALTER TYPE "AgentTaskStatus" ADD VALUE 'Cancelled';
ALTER TABLE "agent_runs" ADD COLUMN "request_key" TEXT,
  ADD COLUMN "requested_by" TEXT, ADD COLUMN "retry_of_id" TEXT,
  ADD COLUMN "parent_run_id" TEXT, ADD COLUMN "lease_expires_at" TIMESTAMP(3),
  ADD COLUMN "cancel_requested_at" TIMESTAMP(3);
CREATE UNIQUE INDEX "agent_runs_organization_id_request_key_key" ON "agent_runs"("organization_id", "request_key");
-- Reconcile the historical Validator alias with the registered, controllable agent.
UPDATE "agent_runs" SET "agent" = 'procurement_validation' WHERE "agent" = 'procurement_validator';
UPDATE "agent_tasks" SET "agent" = 'procurement_validation' WHERE "agent" = 'procurement_validator';
UPDATE "audit_log" SET "agent" = 'procurement_validation' WHERE "agent" = 'procurement_validator';
UPDATE "approvals" SET "agent" = 'procurement_validation' WHERE "agent" = 'procurement_validator';
UPDATE "agent_exceptions" SET "agent" = 'procurement_validation' WHERE "agent" = 'procurement_validator';
UPDATE "agent_runs" SET "agent" = 'backorder_follow_up' WHERE "agent" = 'backorder_supplier_followup';
UPDATE "agent_tasks" SET "agent" = 'backorder_follow_up' WHERE "agent" = 'backorder_supplier_followup';
UPDATE "audit_log" SET "agent" = 'backorder_follow_up' WHERE "agent" = 'backorder_supplier_followup';
