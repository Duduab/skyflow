-- Per-window-type connection details appendix (CONNECTION_DETAILS_PDF attached to a WindowType)
ALTER TABLE "WindowType" ADD COLUMN IF NOT EXISTS "connectionDocId" TEXT;

ALTER TABLE "WindowType"
    ADD CONSTRAINT "WindowType_connectionDocId_fkey"
    FOREIGN KEY ("connectionDocId") REFERENCES "ProjectDocument"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
