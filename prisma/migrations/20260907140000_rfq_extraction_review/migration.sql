-- Additive and nullable: existing RFQs, line IDs and downstream links are unchanged.
ALTER TABLE "rfqs" ADD COLUMN "review" JSONB;
