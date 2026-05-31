-- AlterTable
ALTER TABLE "ProjectOrder" ADD COLUMN "createdByUserId" TEXT;

-- CreateIndex
CREATE INDEX "ProjectOrder_createdByUserId_idx" ON "ProjectOrder"("createdByUserId");

-- AddForeignKey
ALTER TABLE "ProjectOrder" ADD CONSTRAINT "ProjectOrder_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
