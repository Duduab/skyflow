-- Steelwork (מסגריה) connection-details appendix flow: multi-PDF, no detection.

-- Extend ProjectDocumentKind
ALTER TYPE "ProjectDocumentKind" ADD VALUE IF NOT EXISTS 'CONNECTION_DETAILS_PDF';

-- SteelworkDetail
CREATE TABLE "SteelworkDetail" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "targetQty" INTEGER NOT NULL DEFAULT 0,
    "instructionDocId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SteelworkDetail_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SteelworkDetail_projectId_idx" ON "SteelworkDetail"("projectId");

ALTER TABLE "SteelworkDetail"
    ADD CONSTRAINT "SteelworkDetail_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProjectOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SteelworkDetail"
    ADD CONSTRAINT "SteelworkDetail_instructionDocId_fkey" FOREIGN KEY ("instructionDocId") REFERENCES "ProjectDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
