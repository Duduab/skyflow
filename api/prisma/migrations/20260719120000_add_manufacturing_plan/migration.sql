-- CreateTable
CREATE TABLE "ManufacturingPlan" (
    "id" TEXT NOT NULL,
    "projectName" TEXT NOT NULL,
    "s3Url" TEXT NOT NULL,
    "bomData" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManufacturingPlan_pkey" PRIMARY KEY ("id")
);
