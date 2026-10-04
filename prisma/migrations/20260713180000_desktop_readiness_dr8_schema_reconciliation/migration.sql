-- DR-8: reconcile schema changes that predated migration enforcement.
ALTER TABLE "agreement_items" ADD COLUMN IF NOT EXISTS "coo_confidence" TEXT;

ALTER TABLE "inventory_cycle_counts" ALTER COLUMN "updated_at" DROP DEFAULT;

DROP INDEX IF EXISTS "inventory_movements_idempotency_key_key";
CREATE UNIQUE INDEX "inventory_movements_idempotency_key_key"
  ON "inventory_movements"("idempotency_key");

ALTER INDEX IF EXISTS "customer_contract_source_agreements_contract_id_agreement_versi"
  RENAME TO "customer_contract_source_agreements_contract_id_agreement_v_key";

ALTER INDEX IF EXISTS "number_sequences_legal_entity_id_document_type_fiscal_year_pref"
  RENAME TO "number_sequences_legal_entity_id_document_type_fiscal_year__key";
