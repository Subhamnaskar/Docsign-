-- AlterTable
ALTER TABLE "Recipient" ADD COLUMN     "embedReturnUrl" TEXT,
ADD COLUMN     "embedTicketExpiresAt" TIMESTAMP(3),
ADD COLUMN     "embedTicketHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Recipient_embedTicketHash_key" ON "Recipient"("embedTicketHash");

