-- Length fields were stored in mm; app now uses centimeters (÷ 10).
UPDATE "ProjectOrder" SET "originalLength" = "originalLength" / 10;
UPDATE "StationLog" SET "cutLength" = "cutLength" / 10 WHERE "cutLength" IS NOT NULL;
UPDATE "ScrapReport" SET "itemLength" = "itemLength" / 10;
