-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "customLimits" JSONB;

-- CreateTable
CREATE TABLE "PlanSetting" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" JSONB,
    "envelopesPerSeat" INTEGER,
    "maxSeats" INTEGER,
    "features" TEXT[],
    "trialDays" INTEGER,
    "updatedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanSetting_pkey" PRIMARY KEY ("id")
);

