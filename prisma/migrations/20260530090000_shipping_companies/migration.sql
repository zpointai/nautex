CREATE TABLE "shipping_companies" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "legal_name" TEXT,
  "address" TEXT,
  "postal_code" TEXT,
  "city" TEXT,
  "country" TEXT,
  "contact_name" TEXT,
  "email" TEXT,
  "phone" TEXT,
  "vat_id" TEXT,
  "company_number" TEXT,
  "payment_terms" TEXT,
  "invoice_email" TEXT,
  "notes" TEXT,
  "source" TEXT NOT NULL DEFAULT 'manual',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "shipping_companies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shipping_companies_name_key" ON "shipping_companies"("name");
CREATE INDEX "shipping_companies_name_idx" ON "shipping_companies"("name");
