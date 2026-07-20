-- Performance audit: add missing indexes on columns that are filtered/sorted
-- on in hot query paths (admin dashboard, shipping, worker performance,
-- purchase-order list, planning saws worker lookups).

-- CreateIndex
CREATE INDEX "ProjectOrder_status_idx" ON "ProjectOrder"("status");

-- CreateIndex
CREATE INDEX "ProjectOrder_flowStatus_updatedAt_idx" ON "ProjectOrder"("flowStatus", "updatedAt");

-- CreateIndex
CREATE INDEX "StationLog_workerId_createdAt_idx" ON "StationLog"("workerId", "createdAt");

-- CreateIndex
CREATE INDEX "ManufacturingPlan_createdAt_idx" ON "ManufacturingPlan"("createdAt");

-- CreateIndex
CREATE INDEX "ProjectPlanningSawsWorker_userId_idx" ON "ProjectPlanningSawsWorker"("userId");
