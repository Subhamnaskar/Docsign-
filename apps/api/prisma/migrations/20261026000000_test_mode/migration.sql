-- AlterTable
ALTER TABLE "ApiKey" ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'live';

-- AlterTable
ALTER TABLE "Envelope" ADD COLUMN     "testMode" BOOLEAN NOT NULL DEFAULT false;

