-- AlterTable
ALTER TABLE "ProjectOrder" ADD COLUMN     "projectManagerUserId" TEXT;

-- CreateIndex
CREATE INDEX "ProjectOrder_projectManagerUserId_idx" ON "ProjectOrder"("projectManagerUserId");

-- AddForeignKey
ALTER TABLE "ProjectOrder" ADD CONSTRAINT "ProjectOrder_projectManagerUserId_fkey" FOREIGN KEY ("projectManagerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
