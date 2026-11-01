// ETL финальной волны: MongoDB Atlas → PostgreSQL. Домены Play (Game/LiveGame/ClassroomSession,
// + SavedGame) и Misc (ChatRoom/ChatMessage/Conversation/Message). Запуск: node scripts/migrate-realtime-misc.js [--dry]
// Atlas ТОЛЬКО на чтение. Идемпотентно: _id→PK (skipDuplicates). Читаем через v2-модели (верные коллекции).
// Вложенное уплощается в колонки/Json — как в соответствующих швах. games ~16900 — батчами.

require('dotenv').config();
const mongoose = require('mongoose');
const { PrismaClient } = require('@prisma/client');

const DRY = process.argv.includes('--dry');
const BATCH = 1000;
const plain = (v) => (v == null ? null : JSON.parse(JSON.stringify(v)));
const s = (v) => (v == null ? null : String(v));
const ids = (a) => (a || []).map(String);
const dt = (d, f) => d[f] ?? d.createdAt ?? new Date();

const toGame = (d) => ({ id: String(d._id), white: d.white ?? null, black: d.black ?? null, result: d.result ?? null, eco: d.eco ?? null, an: d.an ?? null });

const toLiveGame = (d) => ({
  id: String(d._id),
  whitePlayerId: s(d.whitePlayer), blackPlayerId: s(d.blackPlayer), createdById: s(d.createdBy),
  creatorColor: d.creatorColor || 'random', source: d.source || 'challenge',
  isPrivate: d.isPrivate !== undefined ? !!d.isPrivate : true, isRated: d.isRated !== undefined ? !!d.isRated : true,
  timeControlKind: d.timeControl?.type, timeControlInitialSeconds: d.timeControl?.initialSeconds, timeControlIncrementSeconds: d.timeControl?.incrementSeconds, timeControlCustom: !!d.timeControl?.custom,
  fen: d.fen, moves: d.moves || [], sanMoves: d.sanMoves || [], pgn: d.pgn || '',
  status: d.status || 'created', winner: d.winner ?? null, endReason: d.endReason ?? null,
  clockWhiteMs: d.clock?.whiteMs ?? null, clockBlackMs: d.clock?.blackMs ?? null, clockTurnStartedAt: d.clock?.turnStartedAt ?? null,
  drawOfferBy: d.drawOfferBy ?? null,
  ratingChangesWhite: d.ratingChanges?.white ?? null, ratingChangesBlack: d.ratingChanges?.black ?? null,
  ratingsWhite: plain(d.ratings?.white), ratingsBlack: plain(d.ratings?.black),
  ratingRange: d.ratingRange ?? null, rematchOfId: s(d.rematchOf),
  startedAt: d.startedAt ?? null, finishedAt: d.finishedAt ?? null,
  createdAt: dt(d, 'createdAt'), updatedAt: dt(d, 'updatedAt'),
});

const toClassroom = (d) => ({
  id: String(d._id), clubId: s(d.club), groupId: s(d.group), studentId: s(d.student), coachId: s(d.coach), scheduleId: s(d.schedule),
  status: d.status || 'live', startedAt: d.startedAt ?? new Date(), endedAt: d.endedAt ?? null, attendance: plain(d.attendance) ?? [],
  createdAt: dt(d, 'createdAt'), updatedAt: dt(d, 'updatedAt'),
});

const toSavedGame = (d) => ({
  id: String(d._id), clubId: s(d.club), pgn: d.pgn, title: d.title ?? 'Анализ партии', description: d.description ?? null,
  annotations: plain(d.annotations) ?? [], contextType: d.context?.type, contextRefId: s(d.context?.refId), lastUpdatedById: s(d.lastUpdatedBy),
  createdAt: dt(d, 'createdAt'), updatedAt: dt(d, 'updatedAt'),
});

const toChatRoom = (d) => ({
  id: String(d._id), memberIds: ids(d.members), key: d.key,
  contextKind: d.context?.kind || 'direct', contextRefId: d.context?.refId ?? null, contextTitle: d.context?.title ?? null,
  lastMessageText: d.lastMessage?.text ?? null, lastMessageSenderId: s(d.lastMessage?.sender), lastMessageCreatedAt: d.lastMessage?.createdAt ?? null,
  lastMessageAt: d.lastMessageAt ?? null, createdAt: dt(d, 'createdAt'), updatedAt: dt(d, 'updatedAt'),
});

const toChatMessage = (d) => ({
  id: String(d._id), roomId: s(d.room), senderId: s(d.sender), text: d.text, readAt: d.readAt ?? null, clientId: d.clientId ?? null,
  createdAt: dt(d, 'createdAt'), updatedAt: dt(d, 'updatedAt'),
});

const toConversation = (d) => ({
  id: String(d._id), type: d.type, memberIds: ids(d.members), groupContextId: s(d.groupContext),
  lastMessageText: d.lastMessage?.text ?? null, lastMessageSenderId: s(d.lastMessage?.sender), lastMessageTimestamp: d.lastMessage?.timestamp ?? null,
  createdAt: dt(d, 'createdAt'), updatedAt: dt(d, 'updatedAt'),
});

const toMessage = (d) => ({
  id: String(d._id), conversationId: s(d.conversation), senderId: s(d.sender), text: d.text,
  createdAt: dt(d, 'createdAt'), updatedAt: dt(d, 'updatedAt'),
});

async function migrateOne(prisma, Model, table, mapRow) {
  const total = await Model.countDocuments();
  console.log(`[etl] источник Atlas: ${total} ${table}`);
  if (DRY || total === 0) return;
  let moved = 0, dups = 0;
  const cursor = Model.find().lean().cursor();
  let buf = [];
  const flush = async () => {
    if (!buf.length) return;
    const r = await prisma[table].createMany({ data: buf.map(mapRow), skipDuplicates: true });
    moved += r.count; dups += buf.length - r.count; buf = [];
    process.stdout.write(`\r[etl] ${table}: перенесено ${moved}, дублей ${dups}   `);
  };
  for await (const d of cursor) { buf.push(d); if (buf.length >= BATCH) await flush(); }
  await flush();
  console.log(`\n[etl] ${table}: в PG теперь ${await prisma[table].count()} (перенесено ${moved}, дублей ${dups}).`);
}

(async () => {
  const prisma = new PrismaClient();
  await mongoose.connect(process.env.MONGO_URI);
  try {
    await migrateOne(prisma, require('../v2/models/Game'), 'game', toGame);
    await migrateOne(prisma, require('../v2/models/LiveGame'), 'liveGame', toLiveGame);
    await migrateOne(prisma, require('../v2/models/ClassroomSession'), 'classroomSession', toClassroom);
    await migrateOne(prisma, require('../v2/models/SavedGames'), 'savedGame', toSavedGame);
    await migrateOne(prisma, require('../v2/models/ChatRoom'), 'chatRoom', toChatRoom);
    await migrateOne(prisma, require('../v2/models/ChatMessage'), 'chatMessage', toChatMessage);
    await migrateOne(prisma, require('../v2/models/Conversation'), 'conversationV2', toConversation);
    await migrateOne(prisma, require('../v2/models/Message'), 'messageV2', toMessage);
    console.log('\n[etl] готово.');
  } catch (e) { console.error('[etl] ОШИБКА:', e.message); process.exitCode = 1; }
  finally { await prisma.$disconnect(); await mongoose.disconnect(); }
})();
