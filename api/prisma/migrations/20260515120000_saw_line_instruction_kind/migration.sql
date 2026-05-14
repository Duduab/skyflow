-- סיווג שורות מסורים לפי גיליון Type (ללא Window instruction)
ALTER TABLE "SawStationWorkLine" ADD COLUMN "instructionKind" VARCHAR(32) NOT NULL DEFAULT '';
