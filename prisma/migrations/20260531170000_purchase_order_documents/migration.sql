CREATE TABLE "purchase_order_documents" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "original_name" TEXT,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_provider" TEXT NOT NULL DEFAULT 'local',
    "storage_key" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'other',
    "description" TEXT,
    "uploaded_by" TEXT NOT NULL DEFAULT 'operator',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_order_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "purchase_order_documents_order_id_created_at_idx" ON "purchase_order_documents"("order_id", "created_at");

ALTER TABLE "purchase_order_documents"
ADD CONSTRAINT "purchase_order_documents_order_id_fkey"
FOREIGN KEY ("order_id") REFERENCES "purchase_orders"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
