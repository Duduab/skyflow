-- CreateEnum
CREATE TYPE "WorkCycleStatus" AS ENUM ('DRAFT', 'OPEN', 'IN_PROGRESS', 'COMPLETED', 'RETURNED');

-- CreateEnum
CREATE TYPE "WorkCycleStationStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'DONE');

-- CreateEnum
CREATE TYPE "WorkCycleAssignmentRole" AS ENUM ('MANAGER', 'WORKER');

-- CreateTable
CREATE TABLE "WorkCycle" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "windowTypeId" TEXT NOT NULL,
    "status" "WorkCycleStatus" NOT NULL DEFAULT 'DRAFT',
    "targetQty" INTEGER NOT NULL DEFAULT 0,
    "dailyTargetQty" INTEGER,
    "currentStationId" INTEGER,
    "openedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "returnedFromStationId" INTEGER,
    "returnReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkCycleStationProgress" (
    "id" TEXT NOT NULL,
    "workCycleId" TEXT NOT NULL,
    "stationId" INTEGER NOT NULL,
    "targetQty" INTEGER NOT NULL DEFAULT 0,
    "processedQty" INTEGER NOT NULL DEFAULT 0,
    "status" "WorkCycleStationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkCycleStationProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkCycleAssignment" (
    "id" TEXT NOT NULL,
    "workCycleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "WorkCycleAssignmentRole" NOT NULL DEFAULT 'WORKER',
    "stationId" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkCycleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkCycle_windowTypeId_key" ON "WorkCycle"("windowTypeId");

-- CreateIndex
CREATE INDEX "WorkCycle_projectId_idx" ON "WorkCycle"("projectId");

-- CreateIndex
CREATE INDEX "WorkCycle_projectId_status_idx" ON "WorkCycle"("projectId", "status");

-- CreateIndex
CREATE INDEX "WorkCycleStationProgress_workCycleId_idx" ON "WorkCycleStationProgress"("workCycleId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkCycleStationProgress_workCycleId_stationId_key" ON "WorkCycleStationProgress"("workCycleId", "stationId");

-- CreateIndex
CREATE INDEX "WorkCycleAssignment_workCycleId_idx" ON "WorkCycleAssignment"("workCycleId");

-- CreateIndex
CREATE INDEX "WorkCycleAssignment_userId_idx" ON "WorkCycleAssignment"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkCycleAssignment_workCycleId_userId_stationId_key" ON "WorkCycleAssignment"("workCycleId", "userId", "stationId");

-- AddForeignKey
ALTER TABLE "WorkCycle" ADD CONSTRAINT "WorkCycle_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProjectOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkCycle" ADD CONSTRAINT "WorkCycle_windowTypeId_fkey" FOREIGN KEY ("windowTypeId") REFERENCES "WindowType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkCycleStationProgress" ADD CONSTRAINT "WorkCycleStationProgress_workCycleId_fkey" FOREIGN KEY ("workCycleId") REFERENCES "WorkCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkCycleAssignment" ADD CONSTRAINT "WorkCycleAssignment_workCycleId_fkey" FOREIGN KEY ("workCycleId") REFERENCES "WorkCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkCycleAssignment" ADD CONSTRAINT "WorkCycleAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
