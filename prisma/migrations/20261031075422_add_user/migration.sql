-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "uuid" TEXT NOT NULL,
    "firebaseUID" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "verificationToken" TEXT,
    "password" TEXT NOT NULL,
    "roles" TEXT[] DEFAULT ARRAY['USER']::TEXT[],
    "sessionTokenVersion" INTEGER NOT NULL DEFAULT 0,
    "bulletRating" DOUBLE PRECISION NOT NULL DEFAULT 1500,
    "bulletRd" DOUBLE PRECISION NOT NULL DEFAULT 350,
    "bulletVol" DOUBLE PRECISION NOT NULL DEFAULT 0.06,
    "bulletGames" INTEGER NOT NULL DEFAULT 0,
    "blitzRating" DOUBLE PRECISION NOT NULL DEFAULT 1500,
    "blitzRd" DOUBLE PRECISION NOT NULL DEFAULT 350,
    "blitzVol" DOUBLE PRECISION NOT NULL DEFAULT 0.06,
    "blitzGames" INTEGER NOT NULL DEFAULT 0,
    "rapidRating" DOUBLE PRECISION NOT NULL DEFAULT 1500,
    "rapidRd" DOUBLE PRECISION NOT NULL DEFAULT 350,
    "rapidVol" DOUBLE PRECISION NOT NULL DEFAULT 0.06,
    "rapidGames" INTEGER NOT NULL DEFAULT 0,
    "classicalRating" DOUBLE PRECISION NOT NULL DEFAULT 1500,
    "classicalRd" DOUBLE PRECISION NOT NULL DEFAULT 350,
    "classicalVol" DOUBLE PRECISION NOT NULL DEFAULT 0.06,
    "classicalGames" INTEGER NOT NULL DEFAULT 0,
    "puzzleRating" DOUBLE PRECISION NOT NULL DEFAULT 1500,
    "puzzleRatingGames" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_uuid_key" ON "users"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "users_firebaseUID_key" ON "users"("firebaseUID");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_verificationToken_idx" ON "users"("verificationToken");

-- CreateIndex
CREATE INDEX "users_lastName_firstName_idx" ON "users"("lastName", "firstName");
