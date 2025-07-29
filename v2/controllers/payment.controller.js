// v2/controllers/payment.controller.js

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const TrainingContract = require('../models/TrainingContract');
const Payment = require('../models/Payment');
const Course = require('../models/Course'); // Понадобится для populate

/**
 * @desc    Создание Stripe Checkout сессии для оплаты контракта.
 * @route   POST /api/v2/payments/create-checkout-session
 * @access  Private
 */

const createCheckoutSession = async (req, res) => {
    const { contractId } = req.body;
    const userId = req.user.id;

    // 1. Находим контракт, убеждаемся, что он принадлежит пользователю и ожидает оплаты.
    const contract = await TrainingContract.findOne({
        _id: contractId,
        student: userId,
        status: 'pending_payment'
    }).populate('course');

    if (!contract || !contract.course) { // Добавили проверку на .course
        return res.status(404).json({ msg: 'Contract or associated course not found, or contract already processed.' });
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
                courseId: contract.course._id.toString()
            },
            success_url: `${process.env.FRONTEND_BASE_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.FRONTEND_BASE_URL}/payment-cancelled`,
        });

        res.json({ url: session.url });

    } catch (error) {
        console.error("Stripe session creation error:", error);
        res.status(500).json({ msg: "Error creating payment session." });
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
            const { contractId, userId, courseId } = session.metadata;

            // 2. Обновляем статус контракта на 'active'
            const contract = await TrainingContract.findByIdAndUpdate(contractId, { status: 'active' });

            if (contract) {
                 // 3. Создаем запись о платеже в нашей базе данных
                await Payment.create({
                    user: userId,
                    contract: contractId,
                    amount: session.amount_total,
                    currency: session.currency.toUpperCase(),
                    paymentGateway: 'Stripe',
                    gatewayTransactionId: session.payment_intent,
                    status: 'succeeded'
                });
                
                console.log(`Contract ${contractId} activated.`);
            } else {
                 console.warn(`Contract with ID ${contractId} not found.`);
            }

        } catch (dbError) {
            console.error('Error updating database after payment:', dbError);
            // Если что-то пошло не так, мы должны вернуть ошибку, чтобы Stripe попробовал снова
            return res.status(500).json({ error: 'Database update failed' });
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