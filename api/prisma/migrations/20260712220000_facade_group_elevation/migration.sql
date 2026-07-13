-- Elevation maps are uploaded per facade GROUP (the part before '-': S-w/S-e → S,
-- N5-w/N5-e → N5, W2 → W2). One PDF covers all sub-facades in the group.

-- Facade: group key (backfilled from label prefix)
ALTER TABLE "Facade" ADD COLUMN "groupKey" VARCHAR(16) NOT NULL DEFAULT '';
UPDATE "Facade" SET "groupKey" = split_part("label", '-', 1);
CREATE INDEX "Facade_projectId_groupKey_idx" ON "Facade"("projectId", "groupKey");

-- ElevationMap: switch from a single facade to a facade group
ALTER TABLE "ElevationMap" DROP CONSTRAINT IF EXISTS "ElevationMap_facadeId_fkey";
DROP INDEX IF EXISTS "ElevationMap_facadeId_idx";
ALTER TABLE "ElevationMap" DROP COLUMN IF EXISTS "facadeId";
ALTER TABLE "ElevationMap" ADD COLUMN "facadeGroup" VARCHAR(16);
CREATE INDEX "ElevationMap_projectId_facadeGroup_idx" ON "ElevationMap"("projectId", "facadeGroup");
