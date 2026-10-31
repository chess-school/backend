-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('NEW_ASSIGNMENT', 'SUBMISSION_RECEIVED', 'SUBMISSION_REVIEWED', 'GROUP_INVITE', 'NEW_GROUP_LESSON', 'NEW_LESSON', 'LESSON_REMINDER', 'CONTRACT_APPROVED', 'COACH_REQUEST', 'COACH_REQUEST_DECIDED', 'PAYMENT_SUCCESSFUL', 'PAYMENT_FAILED', 'COACH_APPLICATION', 'COACH_APPLICATION_DECIDED', 'NEW_MESSAGE', 'SYSTEM_ANNOUNCEMENT');

-- CreateEnum
CREATE TYPE "NotificationEntityType" AS ENUM ('Course', 'Group', 'Assignment', 'User');

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "description" TEXT,
    "type" "NotificationType" NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "metadataLink" TEXT,
    "metadataEntityType" "NotificationEntityType",
    "metadataEntityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_recipientId_read_idx" ON "notifications"("recipientId", "read");
