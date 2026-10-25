-- AlterTable
ALTER TABLE "Envelope" ADD COLUMN     "selfSign" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "GuestCode" (
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestCode_pkey" PRIMARY KEY ("email")
);

