-- Station 6 — pack report photo slots
CREATE TABLE "PackReportPhoto" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "slotIndex" INTEGER NOT NULL,
    "imagePath" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackReportPhoto_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PackReportPhoto_projectId_slotIndex_key" ON "PackReportPhoto"("projectId", "slotIndex");
CREATE INDEX "PackReportPhoto_projectId_idx" ON "PackReportPhoto"("projectId");

ALTER TABLE "PackReportPhoto" ADD CONSTRAINT "PackReportPhoto_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProjectOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
