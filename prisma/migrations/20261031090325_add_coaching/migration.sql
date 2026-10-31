-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('pending_payment', 'pending_approval', 'active', 'completed', 'cancelled', 'refunded');

-- CreateTable
CREATE TABLE "coaches" (
    "id" TEXT NOT NULL,
    "clubId" TEXT,
    "userId" TEXT NOT NULL,
    "headline" JSONB,
    "bio" JSONB,
    "specializations" JSONB,
    "fideProfile" JSONB,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "platformRatingAverage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "platformRatingCount" INTEGER NOT NULL DEFAULT 0,
    "payoutInfo" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coaches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trainingcontracts" (
    "id" TEXT NOT NULL,
    "clubId" TEXT,
    "studentId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "groupId" TEXT,
    "priceAmount" INTEGER NOT NULL,
    "priceCurrency" TEXT NOT NULL,
    "packageSnapshot" JSONB,
    "status" "ContractStatus" NOT NULL DEFAULT 'pending_payment',
    "progressCompletedLessons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "progressLessonsCompletedCount" INTEGER NOT NULL DEFAULT 0,
    "progressPercentage" INTEGER NOT NULL DEFAULT 0,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trainingcontracts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "coaches_userId_key" ON "coaches"("userId");

-- CreateIndex
CREATE INDEX "coaches_clubId_idx" ON "coaches"("clubId");

-- CreateIndex
CREATE INDEX "coaches_platformRatingAverage_idx" ON "coaches"("platformRatingAverage");

-- CreateIndex
CREATE INDEX "trainingcontracts_coachId_status_idx" ON "trainingcontracts"("coachId", "status");

-- CreateIndex
CREATE INDEX "trainingcontracts_courseId_status_idx" ON "trainingcontracts"("courseId", "status");

-- CreateIndex
CREATE INDEX "trainingcontracts_groupId_idx" ON "trainingcontracts"("groupId");

-- CreateIndex
CREATE INDEX "trainingcontracts_studentId_idx" ON "trainingcontracts"("studentId");

-- CreateIndex
CREATE INDEX "trainingcontracts_clubId_idx" ON "trainingcontracts"("clubId");

-- CreateIndex
CREATE UNIQUE INDEX "trainingcontracts_studentId_courseId_key" ON "trainingcontracts"("studentId", "courseId");
