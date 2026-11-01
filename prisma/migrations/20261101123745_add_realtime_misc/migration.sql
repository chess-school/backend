-- CreateEnum
CREATE TYPE "LiveGameStatus" AS ENUM ('created', 'active', 'finished', 'aborted');

-- CreateEnum
CREATE TYPE "LiveGameSource" AS ENUM ('challenge', 'lobby', 'pairing', 'rematch');

-- CreateEnum
CREATE TYPE "CreatorColor" AS ENUM ('white', 'black', 'random');

-- CreateEnum
CREATE TYPE "TimeControlKind" AS ENUM ('bullet', 'blitz', 'rapid', 'classical');

-- CreateEnum
CREATE TYPE "ClassroomStatus" AS ENUM ('live', 'ended');

-- CreateEnum
CREATE TYPE "SavedGameContext" AS ENUM ('personal_training', 'group_study');

-- CreateEnum
CREATE TYPE "ChatContextKind" AS ENUM ('direct', 'puzzle', 'homework', 'book');

-- CreateEnum
CREATE TYPE "ConversationType" AS ENUM ('private', 'group');

-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('image');

-- CreateEnum
CREATE TYPE "MediaStorage" AS ENUM ('mongo', 's3');

-- CreateEnum
CREATE TYPE "SitePageStatus" AS ENUM ('draft', 'published');

-- CreateTable
CREATE TABLE "games" (
    "id" TEXT NOT NULL,
    "white" TEXT,
    "black" TEXT,
    "result" TEXT,
    "eco" TEXT,
    "an" TEXT,

    CONSTRAINT "games_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "livegames" (
    "id" TEXT NOT NULL,
    "whitePlayerId" TEXT,
    "blackPlayerId" TEXT,
    "createdById" TEXT NOT NULL,
    "creatorColor" "CreatorColor" NOT NULL DEFAULT 'random',
    "source" "LiveGameSource" NOT NULL DEFAULT 'challenge',
    "isPrivate" BOOLEAN NOT NULL DEFAULT true,
    "isRated" BOOLEAN NOT NULL DEFAULT true,
    "timeControlKind" "TimeControlKind" NOT NULL,
    "timeControlInitialSeconds" INTEGER NOT NULL,
    "timeControlIncrementSeconds" INTEGER NOT NULL,
    "timeControlCustom" BOOLEAN NOT NULL DEFAULT false,
    "fen" TEXT NOT NULL,
    "moves" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sanMoves" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pgn" TEXT NOT NULL DEFAULT '',
    "status" "LiveGameStatus" NOT NULL DEFAULT 'created',
    "winner" TEXT,
    "endReason" TEXT,
    "clockWhiteMs" INTEGER,
    "clockBlackMs" INTEGER,
    "clockTurnStartedAt" TIMESTAMP(3),
    "drawOfferBy" TEXT,
    "ratingChangesWhite" INTEGER,
    "ratingChangesBlack" INTEGER,
    "ratingsWhite" JSONB,
    "ratingsBlack" JSONB,
    "ratingRange" INTEGER,
    "rematchOfId" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "livegames_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classroomsessions" (
    "id" TEXT NOT NULL,
    "clubId" TEXT,
    "groupId" TEXT,
    "studentId" TEXT,
    "coachId" TEXT NOT NULL,
    "scheduleId" TEXT,
    "status" "ClassroomStatus" NOT NULL DEFAULT 'live',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "attendance" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "classroomsessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "savedgames" (
    "id" TEXT NOT NULL,
    "clubId" TEXT,
    "pgn" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Анализ партии',
    "description" TEXT,
    "annotations" JSONB,
    "contextType" "SavedGameContext" NOT NULL,
    "contextRefId" TEXT NOT NULL,
    "lastUpdatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "savedgames_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_rooms" (
    "id" TEXT NOT NULL,
    "memberIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "key" TEXT NOT NULL,
    "contextKind" "ChatContextKind" NOT NULL DEFAULT 'direct',
    "contextRefId" TEXT,
    "contextTitle" TEXT,
    "lastMessageText" TEXT,
    "lastMessageSenderId" TEXT,
    "lastMessageCreatedAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "clientId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "type" "ConversationType" NOT NULL,
    "memberIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "groupContextId" TEXT,
    "lastMessageText" TEXT,
    "lastMessageSenderId" TEXT,
    "lastMessageTimestamp" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mediaassets" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "kind" "MediaKind" NOT NULL DEFAULT 'image',
    "mimeType" TEXT,
    "originalName" TEXT,
    "originalMime" TEXT,
    "alt" TEXT NOT NULL DEFAULT '',
    "width" INTEGER NOT NULL DEFAULT 0,
    "height" INTEGER NOT NULL DEFAULT 0,
    "size" INTEGER NOT NULL DEFAULT 0,
    "storage" "MediaStorage" NOT NULL DEFAULT 'mongo',
    "variants" JSONB,
    "url" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mediaassets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mediablobs" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "contentType" TEXT,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mediablobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sitepages" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "blocks" JSONB,
    "status" "SitePageStatus" NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sitepages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "games_white_idx" ON "games"("white");

-- CreateIndex
CREATE INDEX "games_black_idx" ON "games"("black");

-- CreateIndex
CREATE INDEX "livegames_whitePlayerId_createdAt_idx" ON "livegames"("whitePlayerId", "createdAt");

-- CreateIndex
CREATE INDEX "livegames_blackPlayerId_createdAt_idx" ON "livegames"("blackPlayerId", "createdAt");

-- CreateIndex
CREATE INDEX "livegames_status_isPrivate_createdAt_idx" ON "livegames"("status", "isPrivate", "createdAt");

-- CreateIndex
CREATE INDEX "classroomsessions_groupId_startedAt_idx" ON "classroomsessions"("groupId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "chat_rooms_key_key" ON "chat_rooms"("key");

-- CreateIndex
CREATE INDEX "chat_rooms_lastMessageAt_idx" ON "chat_rooms"("lastMessageAt");

-- CreateIndex
CREATE INDEX "chat_messages_roomId_createdAt_idx" ON "chat_messages"("roomId", "createdAt");

-- CreateIndex
CREATE INDEX "chat_messages_roomId_readAt_senderId_idx" ON "chat_messages"("roomId", "readAt", "senderId");

-- CreateIndex
CREATE INDEX "messages_conversationId_idx" ON "messages"("conversationId");

-- CreateIndex
CREATE INDEX "mediaassets_clubId_createdAt_idx" ON "mediaassets"("clubId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "mediablobs_key_key" ON "mediablobs"("key");

-- CreateIndex
CREATE UNIQUE INDEX "sitepages_clubId_slug_key" ON "sitepages"("clubId", "slug");

-- Partial unique: одна live-сессия classroom на занятие (как Mongo partialFilterExpression status=live).
CREATE UNIQUE INDEX "classroomsessions_schedule_live_key" ON "classroomsessions"("scheduleId") WHERE "status" = 'live' AND "scheduleId" IS NOT NULL;
