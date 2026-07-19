-- CreateEnum
CREATE TYPE "TrackingPhase" AS ENUM ('PRODUCTION', 'SUPPLY', 'INSTALL');

-- CreateTable
CREATE TABLE "ModuleTrackingRow" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "stageCode" VARCHAR(16) NOT NULL,
    "facadeLabel" VARCHAR(32) NOT NULL,
    "facadeGroup" VARCHAR(16) NOT NULL DEFAULT '',
    "floor" VARCHAR(16),
    "moduleCode" VARCHAR(64) NOT NULL,
    "windowTypeId" TEXT,
    "plannedQty" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModuleTrackingRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModuleTrackingBeat" (
    "id" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "phase" "TrackingPhase" NOT NULL,
    "occurredOn" VARCHAR(10) NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 0,
    "deliveryNoteId" TEXT,
    "note" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModuleTrackingBeat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ModuleTrackingRow_projectId_idx" ON "ModuleTrackingRow"("projectId");

-- CreateIndex
CREATE INDEX "ModuleTrackingRow_projectId_stageCode_idx" ON "ModuleTrackingRow"("projectId", "stageCode");

-- CreateIndex
CREATE UNIQUE INDEX "ModuleTrackingRow_projectId_facadeLabel_moduleCode_key" ON "ModuleTrackingRow"("projectId", "facadeLabel", "moduleCode");

-- CreateIndex
CREATE INDEX "ModuleTrackingBeat_rowId_phase_idx" ON "ModuleTrackingBeat"("rowId", "phase");

-- CreateIndex
CREATE INDEX "ModuleTrackingBeat_deliveryNoteId_idx" ON "ModuleTrackingBeat"("deliveryNoteId");

-- AddForeignKey
ALTER TABLE "ModuleTrackingRow" ADD CONSTRAINT "ModuleTrackingRow_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProjectOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModuleTrackingBeat" ADD CONSTRAINT "ModuleTrackingBeat_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "ModuleTrackingRow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModuleTrackingBeat" ADD CONSTRAINT "ModuleTrackingBeat_deliveryNoteId_fkey" FOREIGN KEY ("deliveryNoteId") REFERENCES "ProjectDeliveryNote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModuleTrackingBeat" ADD CONSTRAINT "ModuleTrackingBeat_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
