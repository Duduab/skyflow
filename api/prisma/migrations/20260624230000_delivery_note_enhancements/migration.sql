-- CreateEnum
CREATE TYPE "DeliveryNoteStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- AlterTable
ALTER TABLE "ProjectDeliveryNote" ADD COLUMN "status" "DeliveryNoteStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "ProjectDeliveryNote" ADD COLUMN "cancelledAt" TIMESTAMP(3);
ALTER TABLE "ProjectDeliveryNote" ADD COLUMN "emailNotifiedAt" TIMESTAMP(3);
ALTER TABLE "ProjectDeliveryNote" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "ProjectDeliveryNote_projectId_status_idx" ON "ProjectDeliveryNote"("projectId", "status");
