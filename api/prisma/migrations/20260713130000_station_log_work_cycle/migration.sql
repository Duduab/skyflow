-- AlterTable
ALTER TABLE "StationLog" ADD COLUMN     "workCycleId" TEXT;

-- CreateIndex
CREATE INDEX "StationLog_workCycleId_idx" ON "StationLog"("workCycleId");

-- AddForeignKey
ALTER TABLE "StationLog" ADD CONSTRAINT "StationLog_workCycleId_fkey" FOREIGN KEY ("workCycleId") REFERENCES "WorkCycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
