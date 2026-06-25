-- CreateEnum
CREATE TYPE "DailyTargetSource" AS ENUM ('MANUAL', 'PLANNING');

-- AlterTable
ALTER TABLE "UserDailyTarget" ADD COLUMN "source" "DailyTargetSource" NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "UserDailyTarget" ADD COLUMN "projectId" TEXT;
ALTER TABLE "UserDailyTarget" ADD COLUMN "stationId" INTEGER;
ALTER TABLE "UserDailyTarget" ADD COLUMN "targetQty" INTEGER;
ALTER TABLE "UserDailyTarget" ADD COLUMN "dedupeKey" TEXT;

-- Backfill dedupeKey for existing manual rows
UPDATE "UserDailyTarget"
SET "dedupeKey" = "userId" || ':' || "targetDate" || ':manual'
WHERE "dedupeKey" IS NULL;

ALTER TABLE "UserDailyTarget" ALTER COLUMN "dedupeKey" SET NOT NULL;

-- DropIndex
DROP INDEX IF EXISTS "UserDailyTarget_userId_targetDate_key";

-- CreateIndex
CREATE UNIQUE INDEX "UserDailyTarget_dedupeKey_key" ON "UserDailyTarget"("dedupeKey");

-- CreateIndex
CREATE INDEX "UserDailyTarget_projectId_idx" ON "UserDailyTarget"("projectId");

-- AddForeignKey
ALTER TABLE "UserDailyTarget" ADD CONSTRAINT "UserDailyTarget_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProjectOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
