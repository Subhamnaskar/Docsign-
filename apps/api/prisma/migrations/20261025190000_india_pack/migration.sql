-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('PENDING', 'PASSED', 'FAILED');

-- CreateEnum
CREATE TYPE "MandateStatus" AS ENUM ('PENDING', 'ACTIVE', 'FAILED');

-- AlterEnum
ALTER TYPE "FieldType" ADD VALUE 'MANDATE';

-- AlterTable
ALTER TABLE "Field" ADD COLUMN     "config" JSONB;

-- AlterTable
ALTER TABLE "Recipient" ADD COLUMN     "idChecks" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "videoChallenge" TEXT,
ADD COLUMN     "videoChallengeAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "KycCheck" (
    "id" TEXT NOT NULL,
    "envelopeId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "KycStatus" NOT NULL,
    "nameMatch" INTEGER,
    "data" JSONB NOT NULL DEFAULT '{}',
    "storageKey" TEXT,
    "sha256" TEXT,
    "providerRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KycCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mandate" (
    "id" TEXT NOT NULL,
    "envelopeId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerRef" TEXT,
    "status" "MandateStatus" NOT NULL DEFAULT 'PENDING',
    "maxAmount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "frequency" TEXT NOT NULL,
    "startsOn" TIMESTAMP(3) NOT NULL,
    "endsOn" TIMESTAMP(3) NOT NULL,
    "umrn" TEXT,
    "bankName" TEXT,
    "account" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Mandate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KycCheck_recipientId_idx" ON "KycCheck"("recipientId");

-- CreateIndex
CREATE INDEX "KycCheck_providerRef_idx" ON "KycCheck"("providerRef");

-- CreateIndex
CREATE INDEX "Mandate_recipientId_idx" ON "Mandate"("recipientId");

-- CreateIndex
CREATE INDEX "Mandate_providerRef_idx" ON "Mandate"("providerRef");

-- AddForeignKey
ALTER TABLE "KycCheck" ADD CONSTRAINT "KycCheck_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "Recipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

