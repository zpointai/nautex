-- CreateTable
CREATE TABLE "agent_schedules" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "interval_minutes" INTEGER NOT NULL,
    "max_daily_runs" INTEGER NOT NULL DEFAULT 24,
    "allow_provider" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "request_key" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "next_run_at" TIMESTAMP(3) NOT NULL,
    "occurrence_at" TIMESTAMP(3),
    "lease_until" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "active_key" TEXT,
    "last_run_id" TEXT,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_learning_corrections" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "inventory_item_id" TEXT NOT NULL,
    "original_query" TEXT NOT NULL,
    "normalized_alias" TEXT NOT NULL,
    "expected_name" TEXT NOT NULL,
    "original_output" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "source_fingerprint" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "active" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_by" TEXT NOT NULL,
    "request_key" TEXT NOT NULL,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "evaluation" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "item_learning_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mailbox_connections" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'microsoft365',
    "client_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "secret_ciphertext" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_by" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mailbox_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mailbox_replies" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "backorder_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "reviewed_by" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mailbox_replies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_schedules_enabled_next_run_at_idx" ON "agent_schedules"("enabled", "next_run_at");

-- CreateIndex
CREATE UNIQUE INDEX "agent_schedules_organization_id_request_key_key" ON "agent_schedules"("organization_id", "request_key");

-- CreateIndex
CREATE INDEX "item_learning_corrections_organization_id_normalized_alias__idx" ON "item_learning_corrections"("organization_id", "normalized_alias", "active");

-- CreateIndex
CREATE UNIQUE INDEX "item_learning_corrections_organization_id_request_key_key" ON "item_learning_corrections"("organization_id", "request_key");

-- CreateIndex
CREATE UNIQUE INDEX "mailbox_connections_organization_id_key" ON "mailbox_connections"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "mailbox_replies_organization_id_message_id_backorder_id_key" ON "mailbox_replies"("organization_id", "message_id", "backorder_id");

-- AddForeignKey
ALTER TABLE "agent_schedules" ADD CONSTRAINT "agent_schedules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_learning_corrections" ADD CONSTRAINT "item_learning_corrections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_learning_corrections" ADD CONSTRAINT "item_learning_corrections_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mailbox_connections" ADD CONSTRAINT "mailbox_connections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mailbox_replies" ADD CONSTRAINT "mailbox_replies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mailbox_replies" ADD CONSTRAINT "mailbox_replies_backorder_id_fkey" FOREIGN KEY ("backorder_id") REFERENCES "backorders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
