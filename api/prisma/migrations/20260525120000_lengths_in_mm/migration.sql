-- App now uses millimeters for all length fields (×10 from centimeters).
UPDATE "ProjectOrder" SET "originalLength" = "originalLength" * 10;
UPDATE "StationLog" SET "cutLength" = "cutLength" * 10 WHERE "cutLength" IS NOT NULL;
UPDATE "ScrapReport" SET "itemLength" = "itemLength" * 10;

ALTER TABLE "SawStationWorkLine" RENAME COLUMN "planningCutLengthCm" TO "planningCutLengthMm";
UPDATE "SawStationWorkLine" SET "planningCutLengthMm" = "planningCutLengthMm" * 10 WHERE "planningCutLengthMm" IS NOT NULL;
