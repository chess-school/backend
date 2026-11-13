// ETL домена Learning: MongoDB Atlas (assignments + submissions + puzzleattempts + schedulev2) → PostgreSQL.
// Запуск:   node scripts/migrate-learning.js [--dry]
//   --dry   только посчитать источник, ничего не писать в PG.
// Atlas ТОЛЬКО на чтение. Идемпотентно: _id сохраняется как PK (skipDuplicates).
// ЧИТАЕМ через v2-модели, чтобы попасть в правильные коллекции (ScheduleV2 → schedulev2;
// legacy `schedules` НЕ трогаем). context/review уплощаются в колонки, plan → JSON,
// Submission.attachment.data (Buffer) → Bytes. См. docs/postgres-migration/MIGRATION-PLAN.md (домен 6).

require('dotenv').config();
const mongoose = require('mongoose');
const makeScriptPrisma = require('./_prismaClient');

const DRY = process.argv.includes('--dry');
const BATCH = 500;
const plain = (v) => (v == null ? null : JSON.parse(JSON.stringify(v)));
const sid = (v) => (v ? String(v) : null);

const toAssignmentRow = (d) => ({
  id: String(d._id),
  clubId: sid(d.club),
  title: d.title,
  description: d.description ?? null,
  authorId: String(d.author),
  contextType: d.context.type,
  contextRefId: String(d.context.refId),
  lessonId: sid(d.lesson),
  scheduleId: sid(d.schedule),
  dueDate: d.dueDate ?? null,
  kind: d.kind ?? 'generic',
  puzzleBookId: sid(d.puzzleBook),
  puzzleTarget: d.puzzleTarget ?? 0,
  plan: plain(d.plan) ?? [],
  createdAt: d.createdAt ?? new Date(),
  updatedAt: d.updatedAt ?? d.createdAt ?? new Date(),
});

const toSubmissionRow = (d) => ({
  id: String(d._id),
  clubId: sid(d.club),
  assignmentId: String(d.assignment),
  studentId: String(d.student),
  contentText: d.contentText ?? null,
  contentFileUrl: d.contentFileUrl ?? null,
  attachmentData: d.attachment?.data ? Buffer.from(d.attachment.data.buffer || d.attachment.data) : null,
  attachmentContentType: d.attachment?.contentType ?? null,
  attachmentSize: d.attachment?.size ?? null,
  attachmentFilename: d.attachment?.filename ?? null,
  submittedAt: d.submittedAt ?? d.createdAt ?? new Date(),
  status: d.status ?? 'submitted',
  reviewComment: d.review?.comment ?? null,
  reviewReviewedBy: sid(d.review?.reviewedBy),
  reviewReviewedAt: d.review?.reviewedAt ?? null,
  createdAt: d.createdAt ?? new Date(),
  updatedAt: d.updatedAt ?? d.createdAt ?? new Date(),
});

const toAttemptRow = (d) => ({
  id: String(d._id),
  studentId: String(d.student),
  puzzleBookId: String(d.puzzleBook),
  exerciseId: String(d.exerciseId),
  solved: d.solved !== false,
  timeTakenSeconds: d.timeTakenSeconds ?? 0,
  attemptsCount: d.attemptsCount ?? 0,
  usedHint: d.usedHint === true,
  createdAt: d.createdAt ?? new Date(),
  updatedAt: d.updatedAt ?? d.createdAt ?? new Date(),
});

const toScheduleRow = (d) => ({
  id: String(d._id),
  clubId: sid(d.club),
  title: d.title,
  description: d.description ?? '',
  date: d.date,
  durationMinutes: d.durationMinutes ?? null,
  link: d.link ?? '',
  status: d.status ?? 'scheduled',
  coachId: String(d.coach),
  contextType: d.context.type,
  contextRefId: String(d.context.refId),
  contractId: sid(d.contract),
  createdAt: d.createdAt ?? new Date(),
  updatedAt: d.updatedAt ?? d.createdAt ?? new Date(),
});

async function migrateCollection(query, toRow, prismaDelegate, label) {
  const total = await query.model.countDocuments();
  console.log(`[etl] источник Atlas: ${total} ${label}`);
  if (DRY) return;
  let migrated = 0, skipped = 0;
  const cursor = query.lean().cursor();
  let buf = [];
  const flush = async () => {
    if (!buf.length) return;
    const rows = buf.map(toRow);
    const res = await prismaDelegate.createMany({ data: rows, skipDuplicates: true });
    migrated += res.count;
    skipped += rows.length - res.count;
    buf = [];
    process.stdout.write(`\r[etl] ${label}: перенесено ${migrated}, дублей ${skipped}   `);
  };
  for await (const d of cursor) { buf.push(d); if (buf.length >= BATCH) await flush(); }
  await flush();
  const inPg = await prismaDelegate.count();
  console.log(`\n[etl] ${label}: в PG теперь ${inPg} (перенесено ${migrated}, дублей ${skipped}).`);
}

(async () => {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI не задан');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL не задан');

  await mongoose.connect(process.env.MONGO_URI);
  const Assignment = require('../v2/models/Assignment');
  const Submission = require('../v2/models/Submission');
  const PuzzleAttempt = require('../v2/models/PuzzleAttempt');
  const Schedule = require('../v2/models/Schedule'); // модель 'ScheduleV2' → коллекция schedulev2
  const prisma = makeScriptPrisma();

  await migrateCollection(Assignment.find(), toAssignmentRow, prisma.assignment, 'assignments');
  await migrateCollection(Submission.find().select('+attachment.data'), toSubmissionRow, prisma.submission, 'submissions');
  await migrateCollection(PuzzleAttempt.find(), toAttemptRow, prisma.puzzleAttempt, 'puzzleattempts');
  await migrateCollection(Schedule.find(), toScheduleRow, prisma.scheduleV2, 'schedulev2');

  console.log('\n[etl] готово.');
  await mongoose.disconnect();
  await prisma.$disconnect();
})().catch((e) => { console.error('\n[etl] ОШИБКА:', e); process.exit(1); });
