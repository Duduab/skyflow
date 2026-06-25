-- CreateEnum
CREATE TYPE "DeliveryNoteShippingType" AS ENUM ('INTERNAL', 'EXTERNAL');

-- CreateTable
CREATE TABLE "ProjectDeliveryNote" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "noteNumber" VARCHAR(32) NOT NULL,
    "shippingType" "DeliveryNoteShippingType" NOT NULL,
    "externalPrice" DECIMAL(14,2),
    "documentPath" TEXT NOT NULL,
    "lineItems" JSONB NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectDeliveryNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectDeliveryNote_projectId_issuedAt_idx" ON "ProjectDeliveryNote"("projectId", "issuedAt" DESC);

-- CreateIndex
CREATE INDEX "ProjectDeliveryNote_issuedByUserId_idx" ON "ProjectDeliveryNote"("issuedByUserId");

-- AddForeignKey
ALTER TABLE "ProjectDeliveryNote" ADD CONSTRAINT "ProjectDeliveryNote_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProjectOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDeliveryNote" ADD CONSTRAINT "ProjectDeliveryNote_issuedByUserId_fkey" FOREIGN KEY ("issuedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
