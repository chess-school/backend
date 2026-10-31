// Слой хранения платежей — ШОВ миграции MongoDB → PostgreSQL (strangler).
// Флаг окружения PAYMENT_DB: 'mongo' (по умолчанию) | 'pg'.
// Чтения отдаются в форме, совместимой с прежними .lean()-результатами
// (поля _id, contract, amount, currency, status, createdAt).
//
// См. docs/postgres-migration/MIGRATION-PLAN.md (домен 2).

const mongoose = require('mongoose');
const PaymentMongo = require('../models/Payment');

const usePg = () => String(process.env.PAYMENT_DB || 'mongo').toLowerCase() === 'pg';

let _prisma = null;
const prisma = () => {
  if (!_prisma) {
    const { PrismaClient } = require('@prisma/client');
    _prisma = new PrismaClient();
  }
  return _prisma;
};

const newId = () => new mongoose.Types.ObjectId().toString();

const pgRowToDoc = (r) => r && ({
  _id: r.id,
  club: r.clubId ?? undefined,
  user: r.userId,
  contract: r.contractId,
  amount: r.amount,
  currency: r.currency,
  paymentGateway: r.paymentGateway,
  gatewayTransactionId: r.gatewayTransactionId,
  receiptUrl: r.receiptUrl ?? undefined,
  status: r.status,
  metadata: r.metadata ?? undefined,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

/**
 * Идемпотентная запись платежа Stripe.
 * @returns {{inserted:boolean, duplicateContract:boolean}}
 *   inserted          — создан новый платёж (для него и шлём PAYMENT_SUCCESSFUL);
 *   duplicateContract — по этому контракту платёж уже есть (другой id транзакции).
 */
async function upsertStripePayment(txnId, data) {
  const id = String(txnId);
  if (usePg()) {
    try {
      const existing = await prisma().payment.findUnique({ where: { gatewayTransactionId: id } });
      if (existing) return { inserted: false, duplicateContract: false };
      await prisma().payment.create({
        data: {
          id: newId(),
          gatewayTransactionId: id,
          userId: String(data.user),
          contractId: String(data.contract),
          clubId: data.club != null ? String(data.club) : null,
          amount: data.amount,
          currency: data.currency,
          paymentGateway: data.paymentGateway,
          status: data.status,
          receiptUrl: data.receiptUrl ?? null,
          metadata: data.metadata ?? null,
        },
      });
      return { inserted: true, duplicateContract: false };
    } catch (e) {
      if (e.code === 'P2002') {
        const target = Array.isArray(e.meta?.target) ? e.meta.target.join(',') : String(e.meta?.target || '');
        return { inserted: false, duplicateContract: target.includes('contractId') };
      }
      throw e;
    }
  }
  try {
    const up = await PaymentMongo.updateOne(
      { gatewayTransactionId: id },
      { $setOnInsert: { ...data } },
      { upsert: true, runValidators: true },
    );
    return { inserted: up.upsertedCount > 0, duplicateContract: false };
  } catch (e) {
    if (e.code === 11000) {
      const key = JSON.stringify(e.keyPattern || e.keyValue || {});
      return { inserted: false, duplicateContract: key.includes('contract') };
    }
    throw e;
  }
}

/** Платежи по набору контрактов (contractIds — массив ObjectId/строк). */
async function findByContracts(contractIds) {
  if (usePg()) {
    const rows = await prisma().payment.findMany({
      where: { contractId: { in: contractIds.map(String) } },
      select: { id: true, contractId: true, amount: true, currency: true, status: true, createdAt: true },
    });
    return rows.map((r) => ({ _id: r.id, contract: r.contractId, amount: r.amount, currency: r.currency, status: r.status, createdAt: r.createdAt }));
  }
  return PaymentMongo.find({ contract: { $in: contractIds } })
    .select('contract amount currency status createdAt').lean();
}

/** Есть ли успешный платёж по контракту. */
async function existsSucceededForContract(contractId) {
  if (usePg()) {
    const row = await prisma().payment.findFirst({
      where: { contractId: String(contractId), status: 'succeeded' }, select: { id: true },
    });
    return !!row;
  }
  return !!(await PaymentMongo.exists({ contract: contractId, status: 'succeeded' }));
}

/** Платежи клуба (для дашборда владельца). */
async function findByClub(clubId) {
  if (usePg()) {
    const rows = await prisma().payment.findMany({
      where: { clubId: String(clubId) },
      select: { id: true, amount: true, currency: true, status: true },
    });
    return rows.map((r) => ({ _id: r.id, amount: r.amount, currency: r.currency, status: r.status }));
  }
  return PaymentMongo.find({ club: clubId }).select('amount currency status').lean();
}

module.exports = {
  upsertStripePayment,
  findByContracts,
  existsSucceededForContract,
  findByClub,
  usePg,
  _pgRowToDoc: pgRowToDoc,
};
