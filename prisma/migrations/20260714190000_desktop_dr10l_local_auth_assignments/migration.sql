ALTER TABLE "rfqs" ADD COLUMN "assigned_to_id" TEXT;
ALTER TABLE "purchase_orders" ADD COLUMN "assigned_to_id" TEXT;

CREATE INDEX "rfqs_organization_id_assigned_to_id_status_idx"
ON "rfqs"("organization_id", "assigned_to_id", "status");

CREATE INDEX "purchase_orders_organization_id_assigned_to_id_status_idx"
ON "purchase_orders"("organization_id", "assigned_to_id", "status");

ALTER TABLE "rfqs"
ADD CONSTRAINT "rfqs_assigned_to_id_fkey"
FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "purchase_orders"
ADD CONSTRAINT "purchase_orders_assigned_to_id_fkey"
FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
