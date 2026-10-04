-- DR-4: explicit organization dataset identity and test provenance.
CREATE TYPE "OrganizationDataMode" AS ENUM ('Operational', 'Demo', 'Screenshot', 'Test');

ALTER TABLE "organizations"
ADD COLUMN "data_mode" "OrganizationDataMode" NOT NULL DEFAULT 'Operational';

CREATE INDEX "organizations_data_mode_status_idx"
ON "organizations"("data_mode", "status");

ALTER TYPE "ProvenanceKind" ADD VALUE 'Test';
