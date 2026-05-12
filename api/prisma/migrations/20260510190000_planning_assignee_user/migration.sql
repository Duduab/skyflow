-- Optional planning assignee (worker / station-1 manager) stored on approve
DO $$ BEGIN
    ALTER TABLE "ProjectOrder" ADD COLUMN "planningAssigneeUserId" TEXT;
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "ProjectOrder_planningAssigneeUserId_idx" ON "ProjectOrder"("planningAssigneeUserId");

DO $$ BEGIN
    ALTER TABLE "ProjectOrder" ADD CONSTRAINT "ProjectOrder_planningAssigneeUserId_fkey" FOREIGN KEY ("planningAssigneeUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
