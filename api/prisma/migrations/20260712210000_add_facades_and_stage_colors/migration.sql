-- Facades: each sub-facade (S-w, N2-e, W4 ...) belongs to a single production
-- stage (by cell color) and requires its own elevation-map PDF.

-- New enum
CREATE TYPE "FacadeDirection" AS ENUM ('SOUTH', 'NORTH', 'WEST', 'EAST');

-- Facade
CREATE TABLE "Facade" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "label" VARCHAR(32) NOT NULL,
    "direction" "FacadeDirection" NOT NULL,
    "totalQty" INTEGER NOT NULL DEFAULT 0,
    "stageId" TEXT,
    "elevationDocId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Facade_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Facade_projectId_label_key" ON "Facade"("projectId", "label");
CREATE INDEX "Facade_projectId_idx" ON "Facade"("projectId");
CREATE INDEX "Facade_stageId_idx" ON "Facade"("stageId");

ALTER TABLE "Facade"
    ADD CONSTRAINT "Facade_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProjectOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Facade"
    ADD CONSTRAINT "Facade_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "ProductionStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Facade"
    ADD CONSTRAINT "Facade_elevationDocId_fkey" FOREIGN KEY ("elevationDocId") REFERENCES "ProjectDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
