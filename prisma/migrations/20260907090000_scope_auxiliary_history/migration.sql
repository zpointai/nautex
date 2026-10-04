-- Legacy records without provable ownership remain inaccessible to ordinary
-- organization requests. Do not assign ambiguous data to a default customer.
ALTER TABLE "command_history" ADD COLUMN "organization_id" TEXT;
ALTER TABLE "search_history" ADD COLUMN "organization_id" TEXT;
ALTER TABLE "hs_code_history" ADD COLUMN "organization_id" TEXT;
ALTER TABLE "impa_favorites" ADD COLUMN "organization_id" TEXT;
UPDATE "command_history" AS h SET "organization_id" = r."organization_id"
FROM "agent_runs" AS r WHERE h."run_id" = r."id";
DROP INDEX "impa_favorites_impa_code_key";
CREATE UNIQUE INDEX "impa_favorites_organization_id_impa_code_key" ON "impa_favorites"("organization_id", "impa_code");
ALTER TABLE "agreement_insights" ADD COLUMN "organization_id" TEXT;
UPDATE "agreement_insights" AS i SET "organization_id" = s."organization_id"
FROM "suppliers" AS s WHERE i."supplier_id" = s."id";
ALTER TABLE "vessel_watchlist" ADD COLUMN "organization_id" TEXT;
DROP INDEX "vessel_watchlist_mmsi_user_id_key";
CREATE UNIQUE INDEX "vessel_watchlist_organization_id_mmsi_user_id_key" ON "vessel_watchlist"("organization_id", "mmsi", "user_id");
