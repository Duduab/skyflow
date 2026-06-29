-- Elevation maps: interactive facade installation tracker derived from an ELEVATION_MAP PDF

-- New enums
CREATE TYPE "ElevationCellKind" AS ENUM ('SPANDREL', 'UNIT');
CREATE TYPE "ElevationCellStatus" AS ENUM ('PENDING', 'DONE');
CREATE TYPE "ElevationMapStatus" AS ENUM ('PROCESSING', 'READY', 'FAILED');

-- Extend ProjectDocumentKind
ALTER TYPE "ProjectDocumentKind" ADD VALUE IF NOT EXISTS 'ELEVATION_MAP';

-- ElevationMap
CREATE TABLE "ElevationMap" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "documentId" TEXT,
    "title" TEXT NOT NULL,
    "status" "ElevationMapStatus" NOT NULL DEFAULT 'PROCESSING',
    "pageCount" INTEGER NOT NULL DEFAULT 1,
    "pages" JSONB NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ElevationMap_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ElevationMap_documentId_key" ON "ElevationMap"("documentId");
CREATE INDEX "ElevationMap_projectId_idx" ON "ElevationMap"("projectId");

ALTER TABLE "ElevationMap"
    ADD CONSTRAINT "ElevationMap_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProjectOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ElevationMap"
    ADD CONSTRAINT "ElevationMap_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ProjectDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ElevationCell
CREATE TABLE "ElevationCell" (
    "id" TEXT NOT NULL,
    "mapId" TEXT NOT NULL,
    "pageIndex" INTEGER NOT NULL DEFAULT 0,
    "code" VARCHAR(64) NOT NULL,
    "floor" VARCHAR(16),
    "kind" "ElevationCellKind" NOT NULL,
    "items" JSONB NOT NULL,
    "bbox" JSONB NOT NULL,
    "status" "ElevationCellStatus" NOT NULL DEFAULT 'PENDING',
    "doneAt" TIMESTAMP(3),
    "doneByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ElevationCell_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ElevationCell_mapId_pageIndex_idx" ON "ElevationCell"("mapId", "pageIndex");
CREATE INDEX "ElevationCell_mapId_status_idx" ON "ElevationCell"("mapId", "status");
CREATE INDEX "ElevationCell_doneByUserId_idx" ON "ElevationCell"("doneByUserId");

ALTER TABLE "ElevationCell"
    ADD CONSTRAINT "ElevationCell_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "ElevationMap"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ElevationCell"
    ADD CONSTRAINT "ElevationCell_doneByUserId_fkey" FOREIGN KEY ("doneByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
