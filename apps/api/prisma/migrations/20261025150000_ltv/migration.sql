-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "archiveTimestampAt" TIMESTAMP(3),
ADD COLUMN     "ltvLevel" TEXT,
ADD COLUMN     "priorSha256" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Envelope" ADD COLUMN     "certificateArchiveTimestampAt" TIMESTAMP(3),
ADD COLUMN     "certificatePriorSha256" TEXT[] DEFAULT ARRAY[]::TEXT[];

