-- CreateEnum
CREATE TYPE "ClubPlan" AS ENUM ('start', 'club', 'academy');

-- CreateEnum
CREATE TYPE "ClubStatus" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('owner', 'trainer', 'student', 'parent');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('active', 'invited', 'removed');

-- CreateEnum
CREATE TYPE "GroupStatus" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "clubs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "city" TEXT,
    "logoUrl" TEXT,
    "brandPrimaryColor" TEXT NOT NULL DEFAULT '#2B50E0',
    "ownerId" TEXT NOT NULL,
    "plan" "ClubPlan" NOT NULL DEFAULT 'start',
    "status" "ClubStatus" NOT NULL DEFAULT 'active',
    "limitsMaxStudents" INTEGER,
    "limitsMaxTrainers" INTEGER,
    "limitsMaxLessonSize" INTEGER,
    "billingStripeCustomerId" TEXT,
    "billingStripeSubscriptionId" TEXT,
    "billingCurrentPeriodEnd" TIMESTAMP(3),
    "botConfig" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clubs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clubmemberships" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'active',
    "childrenIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clubmemberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "groups" (
    "id" TEXT NOT NULL,
    "clubId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "coachId" TEXT NOT NULL,
    "memberIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "GroupStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playerv2s" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ratings" JSONB,
    "statsTotalWins" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "playerv2s_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coachapplications" (
    "id" TEXT NOT NULL,
    "clubId" TEXT,
    "applicantId" TEXT NOT NULL,
    "headline" TEXT NOT NULL DEFAULT '',
    "motivation" TEXT NOT NULL,
    "experience" TEXT NOT NULL DEFAULT '',
    "specializations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "contact" TEXT NOT NULL DEFAULT '',
    "fideProfile" JSONB,
    "sourceLang" TEXT NOT NULL DEFAULT 'en',
    "status" "ApplicationStatus" NOT NULL DEFAULT 'pending',
    "adminNote" TEXT NOT NULL DEFAULT '',
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coachapplications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coachrequests" (
    "id" TEXT NOT NULL,
    "clubId" TEXT,
    "studentId" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "experience" TEXT NOT NULL,
    "goals" TEXT NOT NULL DEFAULT '',
    "status" "ApplicationStatus" NOT NULL DEFAULT 'pending',
    "decidedAt" TIMESTAMP(3),
    "enrollmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coachrequests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clubs_slug_key" ON "clubs"("slug");

-- CreateIndex
CREATE INDEX "clubs_ownerId_idx" ON "clubs"("ownerId");

-- CreateIndex
CREATE INDEX "clubmemberships_userId_status_idx" ON "clubmemberships"("userId", "status");

-- CreateIndex
CREATE INDEX "clubmemberships_clubId_role_status_idx" ON "clubmemberships"("clubId", "role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "clubmemberships_clubId_userId_key" ON "clubmemberships"("clubId", "userId");

-- CreateIndex
CREATE INDEX "groups_coachId_idx" ON "groups"("coachId");

-- CreateIndex
CREATE UNIQUE INDEX "playerv2s_userId_key" ON "playerv2s"("userId");

-- CreateIndex
CREATE INDEX "coachapplications_status_createdAt_idx" ON "coachapplications"("status", "createdAt");

-- CreateIndex
CREATE INDEX "coachapplications_applicantId_idx" ON "coachapplications"("applicantId");

-- CreateIndex
CREATE INDEX "coachrequests_coachId_status_createdAt_idx" ON "coachrequests"("coachId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "coachrequests_studentId_coachId_idx" ON "coachrequests"("studentId", "coachId");

-- Partial unique: одна pending-заявка на applicant / на пару (student,coach) — как в Mongo (partialFilterExpression).
CREATE UNIQUE INDEX "coachapplications_applicant_pending_key" ON "coachapplications"("applicantId") WHERE "status" = 'pending';
CREATE UNIQUE INDEX "coachrequests_student_coach_pending_key" ON "coachrequests"("studentId", "coachId") WHERE "status" = 'pending';
