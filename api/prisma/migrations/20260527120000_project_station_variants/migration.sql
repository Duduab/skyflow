-- CreateEnum
CREATE TYPE "ProjectLineMaterial" AS ENUM ('ALUMINUM', 'STEEL');

-- CreateEnum
CREATE TYPE "ProjectMachiningRoute" AS ENUM ('GLASS', 'ALU_RANGER');

-- AlterTable
ALTER TABLE "ProjectOrder" ADD COLUMN "lineMaterial" "ProjectLineMaterial" NOT NULL DEFAULT 'ALUMINUM',
ADD COLUMN "machiningRoute" "ProjectMachiningRoute" NOT NULL DEFAULT 'GLASS';
