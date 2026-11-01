-- CreateEnum
CREATE TYPE "AssignmentContextType" AS ENUM ('student', 'group', 'course');

-- CreateEnum
CREATE TYPE "AssignmentKind" AS ENUM ('generic', 'puzzles');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('submitted', 'needs_revision', 'approved');

-- CreateEnum
CREATE TYPE "ScheduleContextType" AS ENUM ('individual', 'group', 'course_wide');

-- CreateEnum
CREATE TYPE "ScheduleStatus" AS ENUM ('scheduled', 'completed', 'cancelled', 'missed');

-- CreateTable
CREATE TABLE "assignments" (
    "id" TEXT NOT NULL,
    "clubId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "authorId" TEXT NOT NULL,
    "contextType" "AssignmentContextType" NOT NULL,
    "contextRefId" TEXT NOT NULL,
    "lessonId" TEXT,
    "scheduleId" TEXT,
    "dueDate" TIMESTAMP(3),
    "kind" "AssignmentKind" NOT NULL DEFAULT 'generic',
    "puzzleBookId" TEXT,
    "puzzleTarget" INTEGER NOT NULL DEFAULT 0,
    "plan" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submissions" (
    "id" TEXT NOT NULL,
    "clubId" TEXT,
    "assignmentId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "contentText" TEXT,
    "contentFileUrl" TEXT,
    "attachmentData" BYTEA,
    "attachmentContentType" TEXT,
    "attachmentSize" INTEGER,
    "attachmentFilename" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'submitted',
    "reviewComment" TEXT,
    "reviewReviewedBy" TEXT,
    "reviewReviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "puzzleattempts" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "puzzleBookId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "solved" BOOLEAN NOT NULL DEFAULT true,
    "timeTakenSeconds" INTEGER NOT NULL DEFAULT 0,
    "attemptsCount" INTEGER NOT NULL DEFAULT 0,
    "usedHint" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "puzzleattempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedulev2" (
    "id" TEXT NOT NULL,
    "clubId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "date" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER,
    "link" TEXT NOT NULL DEFAULT '',
    "status" "ScheduleStatus" NOT NULL DEFAULT 'scheduled',
    "coachId" TEXT NOT NULL,
    "contextType" "ScheduleContextType" NOT NULL,
    "contextRefId" TEXT NOT NULL,
    "contractId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schedulev2_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assignments_scheduleId_key" ON "assignments"("scheduleId");

-- CreateIndex
CREATE INDEX "assignments_authorId_createdAt_idx" ON "assignments"("authorId", "createdAt");

-- CreateIndex
CREATE INDEX "assignments_contextType_contextRefId_idx" ON "assignments"("contextType", "contextRefId");

-- CreateIndex
CREATE INDEX "submissions_studentId_status_idx" ON "submissions"("studentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "submissions_assignmentId_studentId_key" ON "submissions"("assignmentId", "studentId");

-- CreateIndex
CREATE INDEX "puzzleattempts_puzzleBookId_studentId_idx" ON "puzzleattempts"("puzzleBookId", "studentId");

-- CreateIndex
CREATE INDEX "puzzleattempts_studentId_idx" ON "puzzleattempts"("studentId");

-- CreateIndex
CREATE INDEX "schedulev2_coachId_date_idx" ON "schedulev2"("coachId", "date");

-- CreateIndex
CREATE INDEX "schedulev2_contextRefId_date_idx" ON "schedulev2"("contextRefId", "date");
