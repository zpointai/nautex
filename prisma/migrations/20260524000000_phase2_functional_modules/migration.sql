-- Phase 2 functional module persistence.

CREATE TYPE "ValidationStatus" AS ENUM ('Completed', 'Failed');

CREATE TABLE "search_history" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "module" TEXT NOT NULL DEFAULT 'catalog_search',
    "result_count" INTEGER NOT NULL DEFAULT 0,
    "top_results" JSONB NOT NULL DEFAULT '[]',
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_history_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "validation_runs" (
    "id" TEXT NOT NULL,
    "quote_file_name" TEXT,
    "po_file_name" TEXT,
    "status" "ValidationStatus" NOT NULL DEFAULT 'Completed',
    "source" TEXT NOT NULL DEFAULT 'manual_upload',
    "comparison_results" JSONB NOT NULL DEFAULT '[]',
    "summary" JSONB NOT NULL DEFAULT '{}',
    "model" TEXT,
    "provider" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "validation_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "search_history_module_created_at_idx" ON "search_history"("module", "created_at");
CREATE INDEX "search_history_query_idx" ON "search_history"("query");
CREATE INDEX "validation_runs_created_at_idx" ON "validation_runs"("created_at");
CREATE INDEX "validation_runs_status_idx" ON "validation_runs"("status");

CREATE TABLE "impa_favorites" (
    "id" TEXT NOT NULL,
    "impa_code" TEXT NOT NULL,
    "item_id" TEXT,
    "label" TEXT,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "impa_favorites_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hs_code_history" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "query" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "code" TEXT,
    "favorite" BOOLEAN NOT NULL DEFAULT false,
    "model" TEXT,
    "provider" TEXT,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hs_code_history_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vessel_watchlist" (
    "id" TEXT NOT NULL,
    "vessel_id" TEXT,
    "mmsi" TEXT NOT NULL,
    "imo" TEXT,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vessel_watchlist_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vessel_track_history" (
    "id" TEXT NOT NULL,
    "vessel_id" TEXT,
    "mmsi" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "speed" DOUBLE PRECISION NOT NULL,
    "heading" INTEGER,
    "source" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vessel_track_history_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "impa_favorites_impa_code_key" ON "impa_favorites"("impa_code");
CREATE INDEX "impa_favorites_user_id_idx" ON "impa_favorites"("user_id");
CREATE INDEX "hs_code_history_created_at_idx" ON "hs_code_history"("created_at");
CREATE INDEX "hs_code_history_favorite_idx" ON "hs_code_history"("favorite");
CREATE INDEX "hs_code_history_code_idx" ON "hs_code_history"("code");
CREATE UNIQUE INDEX "vessel_watchlist_mmsi_user_id_key" ON "vessel_watchlist"("mmsi", "user_id");
CREATE INDEX "vessel_watchlist_created_at_idx" ON "vessel_watchlist"("created_at");
CREATE INDEX "vessel_track_history_mmsi_timestamp_idx" ON "vessel_track_history"("mmsi", "timestamp");
