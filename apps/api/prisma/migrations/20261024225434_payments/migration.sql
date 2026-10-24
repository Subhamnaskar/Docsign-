-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED');

-- AlterEnum
ALTER TYPE "FieldType" ADD VALUE 'PAYMENT';

-- AlterTable
ALTER TABLE "Field" ADD COLUMN     "amount" INTEGER,
ADD COLUMN     "currency" TEXT;

-- AlterTable
ALTER TABLE "TemplateField" ADD COLUMN     "amount" INTEGER,
ADD COLUMN     "currency" TEXT;

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "envelopeId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerRef" TEXT,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "receipt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Payment_recipientId_idx" ON "Payment"("recipientId");

-- CreateIndex
CREATE INDEX "Payment_providerRef_idx" ON "Payment"("providerRef");

