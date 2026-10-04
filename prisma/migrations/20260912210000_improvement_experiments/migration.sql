-- AlterTable
ALTER TABLE "improvement_proposals" ADD COLUMN     "candidate_config" JSONB,
ADD COLUMN     "experiment_key" TEXT;

-- CreateTable
CREATE TABLE "improvement_outcomes" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "observation_id" TEXT NOT NULL,
    "finding" TEXT NOT NULL,
    "expected" TEXT NOT NULL,
    "actual" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "actor_id" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "request_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "improvement_outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "improvement_outcome_reviews" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "outcome_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "improvement_outcome_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "improvement_proposal_outcomes" (
    "organization_id" TEXT NOT NULL,
    "proposal_id" TEXT NOT NULL,
    "outcome_id" TEXT NOT NULL,
    "outcome_revision" INTEGER NOT NULL,

    CONSTRAINT "improvement_proposal_outcomes_pkey" PRIMARY KEY ("proposal_id","outcome_id")
);

-- CreateTable
CREATE TABLE "improvement_evaluations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "proposal_id" TEXT NOT NULL,
    "proposal_revision" INTEGER NOT NULL,
    "request_key" TEXT NOT NULL,
    "input_hash" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "experiment_key" TEXT NOT NULL,
    "evaluator_version" TEXT NOT NULL,
    "suite_hash" TEXT NOT NULL,
    "configuration_hash" TEXT NOT NULL,
    "software_version" TEXT NOT NULL,
    "policy_version" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "improvement_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "improvement_outcomes_organization_id_created_at_idx" ON "improvement_outcomes"("organization_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "improvement_outcomes_organization_id_id_key" ON "improvement_outcomes"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "improvement_outcomes_organization_id_request_key_key" ON "improvement_outcomes"("organization_id", "request_key");

-- CreateIndex
CREATE UNIQUE INDEX "improvement_outcome_reviews_outcome_id_revision_key" ON "improvement_outcome_reviews"("outcome_id", "revision");

-- CreateIndex
CREATE INDEX "improvement_evaluations_organization_id_created_at_idx" ON "improvement_evaluations"("organization_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "improvement_evaluations_organization_id_request_key_key" ON "improvement_evaluations"("organization_id", "request_key");

-- AddForeignKey
ALTER TABLE "improvement_outcomes" ADD CONSTRAINT "improvement_outcomes_organization_id_observation_id_fkey" FOREIGN KEY ("organization_id", "observation_id") REFERENCES "improvement_observations"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "improvement_outcome_reviews" ADD CONSTRAINT "improvement_outcome_reviews_organization_id_outcome_id_fkey" FOREIGN KEY ("organization_id", "outcome_id") REFERENCES "improvement_outcomes"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "improvement_proposal_outcomes" ADD CONSTRAINT "improvement_proposal_outcomes_organization_id_proposal_id_fkey" FOREIGN KEY ("organization_id", "proposal_id") REFERENCES "improvement_proposals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "improvement_proposal_outcomes" ADD CONSTRAINT "improvement_proposal_outcomes_organization_id_outcome_id_fkey" FOREIGN KEY ("organization_id", "outcome_id") REFERENCES "improvement_outcomes"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "improvement_evaluations" ADD CONSTRAINT "improvement_evaluations_organization_id_proposal_id_fkey" FOREIGN KEY ("organization_id", "proposal_id") REFERENCES "improvement_proposals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
