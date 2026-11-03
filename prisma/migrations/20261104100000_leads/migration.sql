-- Заявки на пробное занятие (Leads) с публичного сайта клуба.
CREATE TYPE "LeadStatus" AS ENUM ('new', 'contacted', 'trial_scheduled', 'trial_done', 'converted', 'lost');

CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'site',
    "pagePath" TEXT,
    "who" TEXT NOT NULL DEFAULT 'self',
    "name" TEXT NOT NULL,
    "childAge" INTEGER,
    "email" TEXT,
    "phone" TEXT,
    "level" TEXT,
    "format" TEXT,
    "preferredTime" TEXT,
    "coachId" TEXT,
    "groupId" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'new',
    "lostReason" TEXT,
    "assigneeId" TEXT,
    "note" TEXT,
    "consentAt" TIMESTAMP(3),
    "consentIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "leads_clubId_status_createdAt_idx" ON "leads"("clubId", "status", "createdAt");
