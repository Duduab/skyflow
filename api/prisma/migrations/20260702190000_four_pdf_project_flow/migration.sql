-- 4-PDF project flow: window types, facade/stage quantities, angles (laser), cell defects

-- New enums
CREATE TYPE "ProjectAngleSourcing" AS ENUM ('INTERNAL_LASER', 'EXTERNAL_SUPPLIER');
CREATE TYPE "CellDefectStatus" AS ENUM ('OPEN', 'RESOLVED');

-- Extend ProjectDocumentKind
ALTER TYPE "ProjectDocumentKind" ADD VALUE IF NOT EXISTS 'WINDOW_INSTRUCTION_PDF';
ALTER TYPE "ProjectDocumentKind" ADD VALUE IF NOT EXISTS 'QUANTITIES_PDF';
ALTER TYPE "ProjectDocumentKind" ADD VALUE IF NOT EXISTS 'ANGLE_INSTRUCTION_PDF';

-- ProjectOrder.angleSourcing
ALTER TABLE "ProjectOrder"
    ADD COLUMN "angleSourcing" "ProjectAngleSourcing" NOT NULL DEFAULT 'INTERNAL_LASER';

-- ElevationCell window-type link
ALTER TABLE "ElevationCell" ADD COLUMN "windowTypeCode" VARCHAR(64);
ALTER TABLE "ElevationCell" ADD COLUMN "windowTypeId" TEXT;

-- WindowType
CREATE TABLE "WindowType" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "instructionDocId" TEXT,
    "instructionPage" INTEGER,
    "composition" JSONB,
    "hasAngles" BOOLEAN NOT NULL DEFAULT false,
    "angleCodes" JSONB,
    "setsPayload" JSONB,
    "totalQty" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WindowType_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WindowType_projectId_code_key" ON "WindowType"("projectId", "code");
CREATE INDEX "WindowType_projectId_idx" ON "WindowType"("projectId");

-- FacadeQuantity
CREATE TABLE "FacadeQuantity" (
    "id" TEXT NOT NULL,
    "windowTypeId" TEXT NOT NULL,
    "facadeLabel" VARCHAR(32) NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacadeQuantity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FacadeQuantity_windowTypeId_facadeLabel_key" ON "FacadeQuantity"("windowTypeId", "facadeLabel");
CREATE INDEX "FacadeQuantity_windowTypeId_idx" ON "FacadeQuantity"("windowTypeId");

-- ProductionStage
CREATE TABLE "ProductionStage" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" VARCHAR(16) NOT NULL,
    "colorHex" VARCHAR(9),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionStage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductionStage_projectId_code_key" ON "ProductionStage"("projectId", "code");
CREATE INDEX "ProductionStage_projectId_idx" ON "ProductionStage"("projectId");

-- StageQuantity
CREATE TABLE "StageQuantity" (
    "id" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "windowTypeId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StageQuantity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StageQuantity_stageId_windowTypeId_key" ON "StageQuantity"("stageId", "windowTypeId");
CREATE INDEX "StageQuantity_stageId_idx" ON "StageQuantity"("stageId");
CREATE INDEX "StageQuantity_windowTypeId_idx" ON "StageQuantity"("windowTypeId");

-- Angle
CREATE TABLE "Angle" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 0,
    "instructionDocId" TEXT,
    "instructionPage" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Angle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Angle_projectId_code_key" ON "Angle"("projectId", "code");
CREATE INDEX "Angle_projectId_idx" ON "Angle"("projectId");

-- CellDefect
CREATE TABLE "CellDefect" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "cellId" TEXT NOT NULL,
    "returnedToStationId" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "CellDefectStatus" NOT NULL DEFAULT 'OPEN',
    "reportedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CellDefect_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CellDefect_projectId_status_idx" ON "CellDefect"("projectId", "status");
CREATE INDEX "CellDefect_cellId_idx" ON "CellDefect"("cellId");
CREATE INDEX "CellDefect_returnedToStationId_idx" ON "CellDefect"("returnedToStationId");

-- Foreign keys
ALTER TABLE "ElevationCell"
    ADD CONSTRAINT "ElevationCell_windowTypeId_fkey" FOREIGN KEY ("windowTypeId") REFERENCES "WindowType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "ElevationCell_windowTypeId_idx" ON "ElevationCell"("windowTypeId");

ALTER TABLE "WindowType"
    ADD CONSTRAINT "WindowType_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProjectOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WindowType"
    ADD CONSTRAINT "WindowType_instructionDocId_fkey" FOREIGN KEY ("instructionDocId") REFERENCES "ProjectDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FacadeQuantity"
    ADD CONSTRAINT "FacadeQuantity_windowTypeId_fkey" FOREIGN KEY ("windowTypeId") REFERENCES "WindowType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductionStage"
    ADD CONSTRAINT "ProductionStage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProjectOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StageQuantity"
    ADD CONSTRAINT "StageQuantity_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "ProductionStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StageQuantity"
    ADD CONSTRAINT "StageQuantity_windowTypeId_fkey" FOREIGN KEY ("windowTypeId") REFERENCES "WindowType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Angle"
    ADD CONSTRAINT "Angle_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProjectOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Angle"
    ADD CONSTRAINT "Angle_instructionDocId_fkey" FOREIGN KEY ("instructionDocId") REFERENCES "ProjectDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CellDefect"
    ADD CONSTRAINT "CellDefect_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProjectOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CellDefect"
    ADD CONSTRAINT "CellDefect_cellId_fkey" FOREIGN KEY ("cellId") REFERENCES "ElevationCell"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CellDefect"
    ADD CONSTRAINT "CellDefect_reportedByUserId_fkey" FOREIGN KEY ("reportedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
