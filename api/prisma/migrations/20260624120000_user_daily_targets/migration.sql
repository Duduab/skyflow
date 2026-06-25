-- CreateTable
CREATE TABLE "UserDailyTarget" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "targetDate" VARCHAR(10) NOT NULL,
    "description" TEXT NOT NULL,
    "targetMinutes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserDailyTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserDailyTarget_userId_targetDate_idx" ON "UserDailyTarget"("userId", "targetDate" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "UserDailyTarget_userId_targetDate_key" ON "UserDailyTarget"("userId", "targetDate");

-- AddForeignKey
ALTER TABLE "UserDailyTarget" ADD CONSTRAINT "UserDailyTarget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
