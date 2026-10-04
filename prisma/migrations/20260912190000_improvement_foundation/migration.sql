-- CreateEnum
CREATE TYPE "ImprovementProposalStatus" AS ENUM ('Proposed', 'ExperimentApproved', 'Rejected', 'Revoked');

-- CreateTable
CREATE TABLE "improvement_observations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "legal_entity_id" TEXT,
    "module_key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "source_id" TEXT,
    "source_hash" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "actor_id" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "improvement_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "improvement_proposals" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "legal_entity_id" TEXT,
    "module_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "hypothesis" TEXT NOT NULL,
    "candidate" TEXT NOT NULL,
    "evaluation_plan" TEXT NOT NULL,
    "success_criteria" TEXT NOT NULL,
    "stop_condition" TEXT NOT NULL,
    "status" "ImprovementProposalStatus" NOT NULL DEFAULT 'Proposed',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "request_key" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "improvement_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "improvement_proposal_evidence" (
    "organization_id" TEXT NOT NULL,
    "proposal_id" TEXT NOT NULL,
    "observation_id" TEXT NOT NULL,

    CONSTRAINT "improvement_proposal_evidence_pkey" PRIMARY KEY ("proposal_id","observation_id")
);

-- CreateTable
CREATE TABLE "improvement_decisions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "proposal_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "improvement_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "improvement_observations_organization_id_module_key_created_idx" ON "improvement_observations"("organization_id", "module_key", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "improvement_observations_organization_id_id_key" ON "improvement_observations"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "improvement_observations_organization_id_dedupe_key_key" ON "improvement_observations"("organization_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "improvement_proposals_organization_id_module_key_created_at_idx" ON "improvement_proposals"("organization_id", "module_key", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "improvement_proposals_organization_id_id_key" ON "improvement_proposals"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "improvement_proposals_organization_id_request_key_key" ON "improvement_proposals"("organization_id", "request_key");

-- CreateIndex
CREATE INDEX "improvement_proposal_evidence_organization_id_observation_i_idx" ON "improvement_proposal_evidence"("organization_id", "observation_id");

-- CreateIndex
CREATE UNIQUE INDEX "improvement_decisions_proposal_id_revision_key" ON "improvement_decisions"("proposal_id", "revision");

-- AddForeignKey
ALTER TABLE "improvement_observations" ADD CONSTRAINT "improvement_observations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "improvement_proposals" ADD CONSTRAINT "improvement_proposals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "improvement_proposal_evidence" ADD CONSTRAINT "improvement_proposal_evidence_organization_id_proposal_id_fkey" FOREIGN KEY ("organization_id", "proposal_id") REFERENCES "improvement_proposals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "improvement_proposal_evidence" ADD CONSTRAINT "improvement_proposal_evidence_organization_id_observation__fkey" FOREIGN KEY ("organization_id", "observation_id") REFERENCES "improvement_observations"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "improvement_decisions" ADD CONSTRAINT "improvement_decisions_organization_id_proposal_id_fkey" FOREIGN KEY ("organization_id", "proposal_id") REFERENCES "improvement_proposals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
