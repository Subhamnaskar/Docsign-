-- CreateEnum
CREATE TYPE "SignatureMethod" AS ENUM ('ELECTRONIC', 'AADHAAR_ESIGN', 'DSC');

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "workingKey" TEXT;

-- AlterTable
ALTER TABLE "Envelope" ADD COLUMN     "estamp" JSONB,
ADD COLUMN     "estampResult" JSONB;

-- AlterTable
ALTER TABLE "Recipient" ADD COLUMN     "signatureMethod" "SignatureMethod" NOT NULL DEFAULT 'ELECTRONIC';

-- CreateTable
CREATE TABLE "EsignTransaction" (
    "id" TEXT NOT NULL,
    "envelopeId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "documents" JSONB NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "EsignTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EsignTransaction_recipientId_idx" ON "EsignTransaction"("recipientId");

