// v2/controllers/payment.controller.js

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const contractRepo = require('../repositories/trainingContract.repo'); // шов coaching (mongo|pg по COACHING_DB)
const paymentRepo = require('../repositories/payment.repo');
const { notify } = require('../services/notify');

/**
 * @desc    Создание Stripe Checkout сессии для оплаты контракта.
 * @route   POST /api/v2/payments/create-checkout-session
 * @access  Private
 */

const createCheckoutSession = async (req, res) => {
    const { contractId } = req.body;
    const userId = req.user.id;

    // 1. Находим контракт, убеждаемся, что он принадлежит пользователю и ожидает оплаты.
    const contract = await contractRepo.findOneWithCourse({
        _id: contractId,
        student: userId,
        status: 'pending_payment'
    });

    if (!contract || !contract.course) { // Добавили проверку на .course
        return res.status(404).json({ msg: req.t('controllers.payment.contractNotFound') });
    }

    // 2. Создаем сессию в Stripe
    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            mode: 'payment',
            // --- ИСПРАВЛЕННЫЙ УЧАСТОК ---
            line_items: [{
                price_data: {
                    currency: contract.priceAtPurchase.currency.toLowerCase(),
                    unit_amount: contract.priceAtPurchase.amount, // Сумма в центах
                    product_data: { // <- `product_data` теперь ВНУТРИ `price_data`
                        name: contract.course.title, // Наш курс одноязычный
                        description: contract.course.description,
                        // Можно добавить и другие данные, например, картинку
                        // images: [contract.course.thumbnailUrl],
                    },
                },
                quantity: 1,
            }],
            // ---------------------------
            metadata: {
                contractId: contract._id.toString(),
                userId: userId.toString(),
                courseId: contract.course._id.toString(),
                // Клуб-владелец (#7): переносим активный клуб запроса в Stripe, чтобы вебхук проставил его в Payment
                ...(req.club ? { club: String(req.club) } : {}),
            },
            success_url: `${process.env.FRONTEND_BASE_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.FRONTEND_BASE_URL}/payment-cancelled`,
        });

        res.json({ url: session.url });

    } catch (error) {
        console.error("Stripe session creation error:", error);
        res.status(500).json({ msg: req.t('controllers.payment.sessionError') });
    }
};

/**
 * @desc    Обработка webhook-уведомлений от Stripe.
 * @route   POST /api/v2/payments/webhook
 * @access  Public
 */
const handleStripeWebhook = async (req, res) => {
    const signature = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;
    try {
        // Проверяем подпись, чтобы убедиться, что запрос пришел от Stripe
        event = stripe.webhooks.constructEvent(req.body, signature, endpointSecret);
    } catch (err) {
        console.log(`⚠️  Webhook signature verification failed.`, err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Обрабатываем только интересующее нас событие
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        
        console.log('✅ Checkout session completed:', session.id);

        try {
            // 1. Получаем наши ID из метаданных, которые мы отправили ранее
            const { contractId, userId, club } = session.metadata || {};
            const contract = contractId ? await contractRepo.findById(contractId) : null;
            if (!contract) {
                // Повторять бессмысленно — отвечаем 200, чтобы Stripe не слал событие снова
                console.warn(`Contract with ID ${contractId} not found.`);
                return res.status(200).send();
            }

            // 2. Платёж записываем идемпотентно: Stripe может доставить одно событие несколько раз,
            //    а create() падал на уникальном gatewayTransactionId -> 500 -> бесконечные повторы
            const paidAmount = session.amount_total;
            const paidCurrency = (session.currency || '').toUpperCase();
            // Идемпотентная запись платежа через репозиторий-шов (mongo|pg). Stripe может
            // доставить событие повторно — повторная вставка не создаётся.
            const { inserted: paymentInserted, duplicateContract } = await paymentRepo.upsertStripePayment(
                session.payment_intent || session.id,
                {
                    user: userId || contract.student,
                    contract: contract._id,
                    amount: paidAmount,
                    currency: paidCurrency,
                    paymentGateway: 'Stripe',
                    status: 'succeeded',
                    metadata: { checkoutSessionId: session.id },
                    // Клуб-владелец (#7): из метаданных сессии, выставленных при создании checkout
                    ...(club ? { club } : {}),
                },
            );
            if (duplicateContract) {
                // По этому контракту уже есть платёж с другим ID транзакции (Payment.contract уникален)
                console.warn(`Contract ${contractId} already has a payment; duplicate checkout ${session.id} ignored.`);
                return res.status(200).send();
            }

            // Чекпоинт: успешная оплата. Эмитим ТОЛЬКО при первой вставке платежа —
            // Stripe может доставить событие повторно, колокольчик не дублируем.
            if (paymentInserted) {
                await notify({
                    recipient: contract.student,
                    type: 'PAYMENT_SUCCESSFUL',
                    message: 'Your payment was received successfully.',
                    link: '/my-courses',
                    entity: { type: 'Course', id: contract.course },
                });
            }

            // 3. Активируем запись, только если сумма и валюта совпали и запись ещё ждёт оплаты:
            //    отменённый/возвращённый контракт не должен «воскреснуть» от позднего вебхука
            const expected = contract.priceAtPurchase || {};
            const amountMatches = paidAmount >= expected.amount && paidCurrency === String(expected.currency).toUpperCase();
            if (!amountMatches) {
                console.error(`Contract ${contractId}: paid ${paidAmount} ${paidCurrency}, expected ${expected.amount} ${expected.currency} — not activated.`);
            } else {
                const activated = await contractRepo.updateOne(
                    { _id: contract._id, status: { $in: ['pending_payment', 'pending_approval'] } },
                    { status: 'active', startDate: contract.startDate || new Date() },
                );
                if (activated.modifiedCount) {
                    console.log(`Contract ${contractId} activated.`);
                    // Чекпоинт: запись на курс активирована (эмитим только при реальной активации)
                    await notify({
                        recipient: contract.student,
                        type: 'CONTRACT_APPROVED',
                        message: 'Your enrollment is now active. Happy training!',
                        link: '/my-courses',
                        entity: { type: 'Course', id: contract.course },
                    });
                }
            }

        } catch (dbError) {
            console.error('Error updating database after payment:', dbError);
            // Если что-то пошло не так, мы должны вернуть ошибку, чтобы Stripe попробовал снова
            return res.status(500).json({ error: 'Database update failed' });
        }
    } else if (event.type === 'checkout.session.async_payment_failed') {
        // Чекпоинт: отложенный платёж не прошёл — сообщаем ученику
        const session = event.data.object;
        const { contractId } = session.metadata || {};
        const contract = contractId
            ? await contractRepo.findById(contractId)
            : null;
        if (contract) {
            await notify({
                recipient: contract.student,
                type: 'PAYMENT_FAILED',
                message: 'Your payment could not be processed. Please try again.',
                link: '/my-courses',
                entity: { type: 'Course', id: contract.course },
            });
        }
    } else {
        console.log(`Unhandled event type: ${event.type}`);
    }

    // Возвращаем ответ, что мы все получили, чтобы Stripe не слал повторные уведомления
    res.status(200).send();
};


module.exports = {
    createCheckoutSession,
    handleStripeWebhook,
};