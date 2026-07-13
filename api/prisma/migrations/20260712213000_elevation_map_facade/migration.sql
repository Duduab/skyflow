-- Tie each elevation map to a single facade (one elevation-map PDF per sub-facade).

ALTER TABLE "ElevationMap" ADD COLUMN "facadeId" TEXT;

CREATE INDEX "ElevationMap_facadeId_idx" ON "ElevationMap"("facadeId");

ALTER TABLE "ElevationMap"
    ADD CONSTRAINT "ElevationMap_facadeId_fkey" FOREIGN KEY ("facadeId") REFERENCES "Facade"("id") ON DELETE CASCADE ON UPDATE CASCADE;
