CREATE TABLE "jev_settings" (
  "organization_id" TEXT NOT NULL,
  "secret_ciphertext" JSONB,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "daily_limit" INTEGER NOT NULL DEFAULT 20 CHECK ("daily_limit" BETWEEN 1 AND 100),
  "revision" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "jev_settings_pkey" PRIMARY KEY ("organization_id"),
  CONSTRAINT "jev_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "jev_reviews" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "request_key" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "source_hash" TEXT NOT NULL,
  "requested_by" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "record_id" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "provider_attempted" BOOLEAN NOT NULL DEFAULT false,
  "result" JSONB,
  "input_tokens" INTEGER,
  "output_tokens" INTEGER,
  "duration_ms" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "jev_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "jev_reviews_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "jev_reviews_organization_id_request_key_key" ON "jev_reviews"("organization_id", "request_key");
CREATE INDEX "jev_reviews_organization_id_created_at_idx" ON "jev_reviews"("organization_id", "created_at");
