CREATE TABLE "learning_corrections" (
  "id" TEXT NOT NULL, "organization_id" TEXT NOT NULL, "supplier_id" TEXT NOT NULL,
  "original_query" TEXT NOT NULL, "normalized_alias" TEXT NOT NULL, "original_output" JSONB NOT NULL,
  "expected_name" TEXT NOT NULL, "reason" TEXT NOT NULL, "source_fingerprint" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'Pending', "active" BOOLEAN NOT NULL DEFAULT false, "revision" INTEGER NOT NULL DEFAULT 1,
  "created_by" TEXT NOT NULL, "request_key" TEXT NOT NULL, "reviewed_by" TEXT, "reviewed_at" TIMESTAMP(3), "evaluation" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "learning_corrections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "learning_corrections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "learning_corrections_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "learning_corrections_organization_id_request_key_key" ON "learning_corrections"("organization_id", "request_key");
CREATE INDEX "learning_corrections_organization_id_normalized_alias_activ_idx" ON "learning_corrections"("organization_id", "normalized_alias", "active");
-- No legacy source-reliability or matching feedback receives inferred ownership.
