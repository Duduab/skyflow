-- Station 7 (הרכבה באתר) — delivery note + expected site counts
ALTER TABLE "ProjectOrder" ADD COLUMN "siteDeliveryNotePath" TEXT,
ADD COLUMN "siteExpectedBeams" INTEGER,
ADD COLUMN "siteExpectedGlazing" INTEGER,
ADD COLUMN "siteExpectedUnitized" INTEGER;
