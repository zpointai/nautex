-- DR-6: retry protection for mutation endpoints.
CREATE TYPE "ApiIdempotencyStatus" AS ENUM ('Processing', 'Completed');

CREATE TABLE "api_idempotency_records" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "route" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "status" "ApiIdempotencyStatus" NOT NULL DEFAULT 'Processing',
  "response_status" INTEGER,
  "response_body" JSONB,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "api_idempotency_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "api_idempotency_records_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "api_idempotency_records_organization_id_route_key_key"
ON "api_idempotency_records"("organization_id", "route", "key");

CREATE INDEX "api_idempotency_records_expires_at_idx"
ON "api_idempotency_records"("expires_at");
