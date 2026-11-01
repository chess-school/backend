-- CreateTable
CREATE TABLE "courses" (
    "id" TEXT NOT NULL,
    "clubId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "authorIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isSchoolCourse" BOOLEAN NOT NULL DEFAULT false,
    "modules" JSONB,
    "priceAmount" INTEGER NOT NULL DEFAULT 0,
    "priceCurrency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "visibility" TEXT NOT NULL DEFAULT 'draft',
    "allowedUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowedGroupIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "level" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "language" TEXT NOT NULL DEFAULT 'en',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "puzzlebooks" (
    "id" TEXT NOT NULL,
    "clubId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT NOT NULL,
    "solveSettings" JSONB,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "visibility" TEXT NOT NULL DEFAULT 'draft',
    "allowedUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowedGroupIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "sourceTaskId" TEXT,
    "sourceImportedChapters" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "exercises" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "puzzlebooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sitesettings" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "siteName" TEXT,
    "logoUrl" TEXT,
    "tagline" TEXT,
    "auth" JSONB,
    "footer" JSONB,
    "socials" JSONB,
    "menu" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sitesettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "puzzles" (
    "id" TEXT NOT NULL,
    "fen" TEXT NOT NULL,
    "moves" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rating" INTEGER NOT NULL,
    "themes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "popularity" INTEGER,
    "nbPlays" INTEGER,
    "sourceKind" TEXT,
    "sourceBook" TEXT,
    "sourceBookTitle" TEXT,
    "sourceExercise" TEXT,
    "sourceExerciseNumber" INTEGER,
    "sourceTitle" TEXT,
    "sourceSideToMove" TEXT,
    "sourceSolutionSan" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourcePublished" BOOLEAN,

    CONSTRAINT "puzzles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "positions" (
    "id" TEXT NOT NULL,
    "t" INTEGER,
    "m" JSONB,

    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "courses_clubId_idx" ON "courses"("clubId");

-- CreateIndex
CREATE INDEX "courses_visibility_isArchived_idx" ON "courses"("visibility", "isArchived");

-- CreateIndex
CREATE UNIQUE INDEX "puzzlebooks_sourceTaskId_key" ON "puzzlebooks"("sourceTaskId");

-- CreateIndex
CREATE INDEX "puzzlebooks_clubId_idx" ON "puzzlebooks"("clubId");

-- CreateIndex
CREATE INDEX "puzzlebooks_visibility_isArchived_idx" ON "puzzlebooks"("visibility", "isArchived");

-- CreateIndex
CREATE UNIQUE INDEX "sitesettings_clubId_key" ON "sitesettings"("clubId");

-- CreateIndex
CREATE INDEX "puzzles_rating_idx" ON "puzzles"("rating");

-- CreateIndex
CREATE INDEX "puzzles_sourceKind_sourcePublished_rating_idx" ON "puzzles"("sourceKind", "sourcePublished", "rating");

-- CreateIndex
CREATE INDEX "puzzles_sourceBook_idx" ON "puzzles"("sourceBook");
