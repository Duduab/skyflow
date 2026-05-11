-- Optional planning assignee (worker / station-1 manager) stored on approve
ALTER TABLE "ProjectOrder" ADD COLUMN "planningAssigneeUserId" TEXT;

CREATE INDEX "ProjectOrder_planningAssigneeUserId_idx" ON "ProjectOrder"("planningAssigneeUserId");

ALTER TABLE "ProjectOrder" ADD CONSTRAINT "ProjectOrder_planningAssigneeUserId_fkey" FOREIGN KEY ("planningAssigneeUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
