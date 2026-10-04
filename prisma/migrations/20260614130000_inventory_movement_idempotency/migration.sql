-- Idempotency protection for inventory movements created by retried workflows.

ALTER TABLE "inventory_movements"
  ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "inventory_movements_idempotency_key_key"
  ON "inventory_movements"("idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
