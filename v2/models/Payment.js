// models/Payment.js

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const PaymentSchema = new Schema({
    // Клуб-владелец (мульти-арендность #7). Проставляется при создании из req.club.
    club: { type: Schema.Types.ObjectId, ref: 'Club', index: true },
    // --- ВНУТРЕННИЕ СВЯЗИ В ВАШЕЙ СИСТЕМЕ ---
    user: { // Пользователь, который совершил платеж
        type: Schema.Types.ObjectId,
        ref: 'TestUser',
        required: true,
    },
    contract: { // Контракт, который был оплачен этим платежом
        type: Schema.Types.ObjectId,
        ref: 'TrainingContract',
        required: true,
    },

    // --- ФИНАНСОВАЯ ИНФОРМАЦИЯ ---
    amount: { // Сумма платежа в наименьших единицах (копейках, центах)
        type: Number,
        required: true,
        min: 0,
    },
    currency: { // Трехбуквенный код валюты (USD, EUR, RUB)
        type: String,
        required: true,
        uppercase: true,
        minlength: 3,
        maxlength: 3,
    },
    
    // --- ДАННЫЕ ОТ ВНЕШНЕГО ПЛАТЕЖНОГО ШЛЮЗА ---
    paymentGateway: { // Название системы (Stripe, PayPal и т.д.)
        type: String,
        required: true,
        enum: ['Stripe', 'PayPal', 'Manual'], // Manual - для ручного добавления платежей админом
    },
    gatewayTransactionId: { // Уникальный ID транзакции из платежной системы
        type: String,
        required: true,
        unique: true, // Гарантирует, что мы не запишем один и тот же платеж дважды
    },
    receiptUrl: { // URL на квитанцию, если платежный шлюз ее предоставляет
        type: String,
    },
    
    // --- СТАТУС ПЛАТЕЖА ---
    status: {
        type: String,
        required: true,
        enum: [
            'pending',   // Платеж инициирован, но еще не завершен
            'succeeded', // Платеж успешно прошел
            'failed',    // Платеж не удался
        ],
    },
    
    // Метаданные для хранения дополнительной информации от шлюза
    metadata: {
        type: Object, 
    },

}, { timestamps: true });


// Индексы для ускорения частых запросов
PaymentSchema.index({ user: 1 }); // Найти все платежи пользователя
PaymentSchema.index({ contract: 1 }, { unique: true }); // Один контракт может быть оплачен только одним успешным платежом. 
                                                         // Можно убрать unique, если будут рассрочки. Для MVP - оставляем.
// Индекс по gatewayTransactionId создаёт unique: true в схеме (отдельный index был дублем)

module.exports = mongoose.model('Payment', PaymentSchema);