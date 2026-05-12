-- AlterEnum (idempotent if label already exists, e.g. after db push)
DO $$ BEGIN
    ALTER TYPE "SkyflowRole" ADD VALUE 'PLANNING';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
