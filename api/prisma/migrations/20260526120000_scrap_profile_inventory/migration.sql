-- Scrap inventory by profile type + catalog code
ALTER TABLE "ScrapReport" ADD COLUMN "profileKind" VARCHAR(16) NOT NULL DEFAULT 'CATALOG';
ALTER TABLE "ScrapReport" ADD COLUMN "profileCode" VARCHAR(32) NOT NULL DEFAULT 'LEGACY';

-- Preserve catalog code on saw work lines (from planning MPS/MPB columns)
ALTER TABLE "SawStationWorkLine" ADD COLUMN "sawsProfileCode" VARCHAR(32);

CREATE INDEX "ScrapReport_projectId_profileKind_profileCode_idx" ON "ScrapReport"("projectId", "profileKind", "profileCode");
