-- CreateEnum
CREATE TYPE "ProjectFlowStatus" AS ENUM ('PENDING_PLANNING', 'IN_PRODUCTION', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('UNIT', 'WINDOW');

-- CreateEnum
CREATE TYPE "ProductComponentKind" AS ENUM ('BEAM', 'FRAME', 'GLASS_SINGLE', 'GLASS_DOUBLE', 'SASH');

-- AlterTable
ALTER TABLE "ProjectOrder" ADD COLUMN "flowStatus" "ProjectFlowStatus" NOT NULL DEFAULT 'PENDING_PLANNING';

-- Existing rows: preserve behaviour (stations already usable)
UPDATE "ProjectOrder" SET "flowStatus" = 'IN_PRODUCTION';

-- CreateTable
CREATE TABLE "ProductItem" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "productType" "ProductType" NOT NULL,
    "instructionKind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductComponent" (
    "id" TEXT NOT NULL,
    "productItemId" TEXT NOT NULL,
    "kind" "ProductComponentKind" NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "spec" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SawStationWorkLine" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "componentKind" "ProductComponentKind" NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SawStationWorkLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductItem_projectId_idx" ON "ProductItem"("projectId");

-- CreateIndex
CREATE INDEX "ProductComponent_productItemId_idx" ON "ProductComponent"("productItemId");

-- CreateIndex
CREATE INDEX "SawStationWorkLine_projectId_idx" ON "SawStationWorkLine"("projectId");

-- AddForeignKey
ALTER TABLE "ProductItem" ADD CONSTRAINT "ProductItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProjectOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductComponent" ADD CONSTRAINT "ProductComponent_productItemId_fkey" FOREIGN KEY ("productItemId") REFERENCES "ProductItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SawStationWorkLine" ADD CONSTRAINT "SawStationWorkLine_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProjectOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
