-- AlterEnum
ALTER TYPE "SignatureMethod" ADD VALUE 'QES';

-- AlterTable
ALTER TABLE "EsignTransaction" ADD COLUMN     "state" JSONB;

-- AlterTable
ALTER TABLE "Recipient" ADD COLUMN     "witnessForId" TEXT;

