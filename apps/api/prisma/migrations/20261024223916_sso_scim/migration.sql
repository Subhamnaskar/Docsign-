-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "scimTokenHash" TEXT,
ADD COLUMN     "ssoClientId" TEXT,
ADD COLUMN     "ssoClientSecretEnc" TEXT,
ADD COLUMN     "ssoDefaultRole" "UserRole" NOT NULL DEFAULT 'MEMBER',
ADD COLUMN     "ssoDomains" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "ssoEnforced" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ssoIssuer" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "ssoSubject" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Organization_scimTokenHash_key" ON "Organization"("scimTokenHash");

