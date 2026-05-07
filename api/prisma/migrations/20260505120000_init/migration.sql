-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'ON_HOLD');

-- CreateTable
CREATE TABLE "ProjectOrder" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "totalItems" INTEGER NOT NULL,
    "requirements" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "originalLength" DECIMAL(14,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StationLog" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "stationId" INTEGER NOT NULL,
    "processedQty" INTEGER NOT NULL,
    "issues" TEXT,
    "workerId" TEXT,
    "cutLength" DECIMAL(14,4),
    "extraPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScrapReport" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "stationId" INTEGER NOT NULL,
    "itemLength" DECIMAL(14,4) NOT NULL,
    "scrapQty" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScrapReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StationLog_projectId_stationId_idx" ON "StationLog"("projectId", "stationId");

-- CreateIndex
CREATE INDEX "ScrapReport_projectId_stationId_idx" ON "ScrapReport"("projectId", "stationId");

-- AddForeignKey
ALTER TABLE "StationLog" ADD CONSTRAINT "StationLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProjectOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScrapReport" ADD CONSTRAINT "ScrapReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProjectOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
