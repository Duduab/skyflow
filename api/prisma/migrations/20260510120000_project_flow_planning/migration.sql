-- Idempotent: DB may already have these types (e.g. prisma db push) while _prisma_migrations was empty.

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "ProjectFlowStatus" AS ENUM ('PENDING_PLANNING', 'IN_PRODUCTION', 'COMPLETED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "ProductType" AS ENUM ('UNIT', 'WINDOW');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "ProductComponentKind" AS ENUM ('BEAM', 'FRAME', 'GLASS_SINGLE', 'GLASS_DOUBLE', 'SASH');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AlterTable
DO $$ BEGIN
    ALTER TABLE "ProjectOrder" ADD COLUMN "flowStatus" "ProjectFlowStatus" NOT NULL DEFAULT 'PENDING_PLANNING';
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

-- Existing rows: preserve behaviour (stations already usable). Idempotent on re-run.
UPDATE "ProjectOrder" SET "flowStatus" = 'IN_PRODUCTION' WHERE "flowStatus" = 'PENDING_PLANNING'::"ProjectFlowStatus";

-- CreateTable
CREATE TABLE IF NOT EXISTS "ProductItem" (
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
CREATE TABLE IF NOT EXISTS "ProductComponent" (
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
CREATE TABLE IF NOT EXISTS "SawStationWorkLine" (
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
CREATE INDEX IF NOT EXISTS "ProductItem_projectId_idx" ON "ProductItem"("projectId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ProductComponent_productItemId_idx" ON "ProductComponent"("productItemId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SawStationWorkLine_projectId_idx" ON "SawStationWorkLine"("projectId");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "ProductItem" ADD CONSTRAINT "ProductItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProjectOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "ProductComponent" ADD CONSTRAINT "ProductComponent_productItemId_fkey" FOREIGN KEY ("productItemId") REFERENCES "ProductItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "SawStationWorkLine" ADD CONSTRAINT "SawStationWorkLine_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProjectOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
