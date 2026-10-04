ALTER TABLE "items"
ADD COLUMN "source" TEXT,
ADD COLUMN "edition" TEXT,
ADD COLUMN "raw" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN "is_deleted" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "items_impa_code_key" ON "items"("impa_code");
CREATE INDEX "items_category_idx" ON "items"("category");

CREATE TABLE "dataset_imports" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "source_file_name" TEXT,
    "source_path" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Completed',
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "imported_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dataset_imports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hs_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "system" TEXT NOT NULL DEFAULT 'generic',
    "chapter" TEXT,
    "heading" TEXT,
    "description" TEXT NOT NULL,
    "notes" TEXT,
    "source" TEXT,
    "raw" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hs_codes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "dataset_imports_type_created_at_idx" ON "dataset_imports"("type", "created_at");
CREATE UNIQUE INDEX "hs_codes_code_system_key" ON "hs_codes"("code", "system");
CREATE INDEX "hs_codes_code_idx" ON "hs_codes"("code");
CREATE INDEX "hs_codes_chapter_idx" ON "hs_codes"("chapter");
