-- מסורים: פרופילי MPS/MPB מזוהים בעמודה + תמונות לשורת עבודה
ALTER TABLE "ProductComponent" ADD COLUMN "planningSourceCol0" INTEGER;
ALTER TABLE "ProductComponent" ADD COLUMN "sawsProfileCode" VARCHAR(32);

ALTER TABLE "SawStationWorkLine" ADD COLUMN "imagePaths" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
