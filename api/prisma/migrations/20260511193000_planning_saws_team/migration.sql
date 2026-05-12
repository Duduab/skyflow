-- מנהל מסורים נפרד + עובדים מרובים לשיבוץ מתכנון (עמדה 1)

DO $$ BEGIN
    ALTER TABLE "ProjectOrder" ADD COLUMN "planningSawsManagerUserId" TEXT;
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "ProjectOrder_planningSawsManagerUserId_idx" ON "ProjectOrder"("planningSawsManagerUserId");

DO $$ BEGIN
    ALTER TABLE "ProjectOrder" ADD CONSTRAINT "ProjectOrder_planningSawsManagerUserId_fkey" FOREIGN KEY ("planningSawsManagerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "ProjectPlanningSawsWorker" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectPlanningSawsWorker_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProjectPlanningSawsWorker_projectId_userId_key" ON "ProjectPlanningSawsWorker"("projectId", "userId");

CREATE INDEX IF NOT EXISTS "ProjectPlanningSawsWorker_projectId_idx" ON "ProjectPlanningSawsWorker"("projectId");

DO $$ BEGIN
    ALTER TABLE "ProjectPlanningSawsWorker" ADD CONSTRAINT "ProjectPlanningSawsWorker_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProjectOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "ProjectPlanningSawsWorker" ADD CONSTRAINT "ProjectPlanningSawsWorker_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
