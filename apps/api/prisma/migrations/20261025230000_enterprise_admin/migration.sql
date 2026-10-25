-- AlterTable
ALTER TABLE "Envelope" ADD COLUMN     "departmentId" TEXT,
ADD COLUMN     "legalHoldAt" TIMESTAMP(3),
ADD COLUMN     "legalHoldBy" TEXT,
ADD COLUMN     "legalHoldReason" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "customDomain" TEXT,
ADD COLUMN     "customDomainToken" TEXT,
ADD COLUMN     "customDomainVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "dkimPrivateKeyEnc" TEXT,
ADD COLUMN     "dkimPublicKey" TEXT,
ADD COLUMN     "dkimSelector" TEXT,
ADD COLUMN     "emailDomain" TEXT,
ADD COLUMN     "emailDomainVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "emailFromName" TEXT,
ADD COLUMN     "emailReplyTo" TEXT,
ADD COLUMN     "ipAllowlist" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "purgeIncompleteDays" INTEGER,
ADD COLUMN     "retentionDays" INTEGER,
ADD COLUMN     "storageKmsKeyId" TEXT;

-- AlterTable
ALTER TABLE "Template" ADD COLUMN     "departmentId" TEXT;

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepartmentMember" (
    "departmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',

    CONSTRAINT "DepartmentMember_pkey" PRIMARY KEY ("departmentId","userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Department_orgId_name_key" ON "Department"("orgId", "name");

-- CreateIndex
CREATE INDEX "DepartmentMember_userId_idx" ON "DepartmentMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_customDomain_key" ON "Organization"("customDomain");

-- AddForeignKey
ALTER TABLE "Envelope" ADD CONSTRAINT "Envelope_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepartmentMember" ADD CONSTRAINT "DepartmentMember_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepartmentMember" ADD CONSTRAINT "DepartmentMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

