CREATE TABLE "shipping_company_vessels" (
    "id" TEXT NOT NULL,
    "shipping_company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "imo" TEXT,
    "mmsi" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "shipping_company_vessels_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "shipping_company_vessels_shipping_company_id_name_key_key" ON "shipping_company_vessels"("shipping_company_id", "name_key");
CREATE UNIQUE INDEX "shipping_company_vessels_shipping_company_id_imo_key" ON "shipping_company_vessels"("shipping_company_id", "imo");
CREATE UNIQUE INDEX "shipping_company_vessels_shipping_company_id_mmsi_key" ON "shipping_company_vessels"("shipping_company_id", "mmsi");
ALTER TABLE "shipping_company_vessels" ADD CONSTRAINT "shipping_company_vessels_shipping_company_id_fkey" FOREIGN KEY ("shipping_company_id") REFERENCES "shipping_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
