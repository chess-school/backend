// v2/utils/email/email.service.js
const transporter = require('./mailer.config');
const getVerificationEmailTemplate = require('./templates/verificationEmail.template');

const environment = process.env.NODE_ENV || 'development';
const isProduction = environment === 'production';

// Формируем адрес отправителя, исходя из .env
const fromAddress = isProduction
    ? `"Chess School" <${process.env.PROD_MAIL_USER}>` // PROD_MAIL_USER должен быть определен!
    : '"Chess School (Dev)" <dev@chess.school>';     // Для Mailtrap можно использовать любой адрес

/**
 * Общая функция для отправки любого письма
 * @param {string} to - Email получателя
 * @param {string} subject - Тема письма
 * @param {string} html - HTML-тело письма
 */
const sendEmail = async (to, subject, html) => {
    // Проверка, что транспортер был успешно создан
    if (!transporter) {
        console.error('Nodemailer transporter is not configured. Email not sent.');
        return;
    }

    const mailOptions = {
        from: fromAddress,
        to,
        subject,
        html,
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`Email sent successfully to ${to}`);
    } catch (error) {
        console.error(`Error sending email to ${to}:`, error);
        // В реальном проекте здесь может быть логика для повторной отправки или уведомления админа.
    }
};


/**
 * Отправляет письмо для верификации email (V2)
 * @param {string} email - Email получателя
 * @param {string} token - Уникальный токен верификации
 * @param {function} t - Функция перевода i18next
 */
const sendVerificationEmailV2 = async (email, token, t) => {
    // ВАЖНО: Создайте эту переменную в вашем .env файле
    // Она должна указывать на URL вашего фронтенд-приложения
    // Пример: FRONTEND_BASE_URL=http://localhost:5173
    const frontendUrl = process.env.FRONTEND_BASE_URL || 'http://localhost:5173';
    
    // Формируем URL верификации, которая ведет на фронтенд
    const verificationUrl = `${frontendUrl}/verify-email?token=${encodeURIComponent(token)}`;

    // Получаем тему и HTML из нашего шаблона
    const { subject, html } = getVerificationEmailTemplate(verificationUrl, t);
    
    // Используем общую функцию для отправки
    await sendEmail(email, subject, html);
};

module.exports = {
    sendVerificationEmailV2,
};