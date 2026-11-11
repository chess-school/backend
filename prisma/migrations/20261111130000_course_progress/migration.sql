-- CreateTable
CREATE TABLE "course_progress" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "chapterId" TEXT,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_progress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "course_progress_courseId_studentId_idx" ON "course_progress"("courseId", "studentId");

-- CreateIndex
CREATE INDEX "course_progress_courseId_idx" ON "course_progress"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "course_progress_courseId_studentId_blockId_key" ON "course_progress"("courseId", "studentId", "blockId");

