-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('CYCLE_LAUNCHED', 'CYCLE_REPORTED', 'CYCLE_COMPLETED', 'CYCLE_RETURNED', 'STATION_LOG', 'DAILY_TARGET_MANUAL', 'DELIVERY_NOTE_ISSUED', 'ELEVATION_CELL_DONE', 'ELEVATION_DEFECT', 'PLANNING_APPROVED', 'PROJECT_COMPLETED', 'TRACKING_BEAT');

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "titleKey" VARCHAR(120) NOT NULL,
    "bodyKey" VARCHAR(120),
    "params" JSONB,
    "link" VARCHAR(300),
    "projectId" TEXT,
    "projectName" VARCHAR(200),
    "stationId" INTEGER,
    "actorUserId" TEXT,
    "actorName" VARCHAR(200),
    "recipientUserId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_recipientUserId_readAt_idx" ON "Notification"("recipientUserId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_recipientUserId_createdAt_idx" ON "Notification"("recipientUserId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
