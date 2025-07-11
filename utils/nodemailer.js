const nodemailer = require('nodemailer');

let transporter;

// Проверяем, запущено ли приложение на сервере (Vercel) или локально
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction) {
  // === КОНФИГУРАЦИЯ ДЛЯ GMAIL НА ПРОДАКШЕНЕ (VERCEL) ===
  // Использует переменные окружения, которые вы задали на Vercel
  transporter = nodemailer.createTransport({
    host: process.env.PROD_MAIL_HOST,
    port: process.env.PROD_MAIL_PORT,
    secure: true, // true для порта 465, false для других
    auth: {
      user: process.env.PROD_MAIL_USER, // Ваш email на gmail
      pass: process.env.PROD_MAIL_PASS, // Ваш 16-значный пароль приложения
    },
  });
  console.log('Nodemailer configured for production (Gmail)');
} else {
  // === КОНФИГУРАЦИЯ ДЛЯ MAILTRAP НА ЛОКАЛЬНОЙ МАШИНЕ ===
  // Использует переменные из вашего локального .env файла
  transporter = nodemailer.createTransport({
    host: process.env.MAILTRAP_HOST,
    port: process.env.MAILTRAP_PORT,
    auth: {
      user: process.env.MAILTRAP_USER,
      pass: process.env.MAILTRAP_PASS,
    },
  });
  console.log('Nodemailer configured for development (Mailtrap)');
}

/**
 * Отправляет письмо для верификации почты
 * @param {string} email - Адрес получателя
 * @param {string} token - Токен для верификации
 */
const sendVerificationEmail = async (email, token) => {
  // BASE_URL берется из переменных окружения и будет правильным
  // и для локальной машины, и для Vercel
  const verificationUrl = `${process.env.BASE_URL}/auth/verify-email?token=${encodeURIComponent(token)}`;

  const fromAddress = isProduction
    ? `"Chess School" <${process.env.PROD_MAIL_USER}>`
    : '"Chess School (Dev)" <no-reply@chess-school.com>';

  const mailOptions = {
    from: fromAddress,
    to: email,
    subject: 'Подтвердите вашу электронную почту в Chess School',
    html: `
      <div style="font-family: sans-serif; padding: 20px; color: #333;">
        <h2>Добро пожаловать в Шахматную Школу!</h2>
        <p>Остался всего один шаг. Пожалуйста, подтвердите вашу электронную почту, нажав на кнопку ниже:</p>
        <a 
          href="${verificationUrl}" 
          style="display: inline-block; padding: 12px 24px; font-size: 16px; color: #fff; background-color: #4CAF50; text-decoration: none; border-radius: 5px;"
        >
          Подтвердить почту
        </a>
        <p style="margin-top: 20px;">Если кнопка не работает, скопируйте и вставьте эту ссылку в ваш браузер:</p>
        <p><a href="${verificationUrl}">${verificationUrl}</a></p>
      </div>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Verification email sent successfully to ${email}`);
  } catch (error) {
    console.error(`Error sending email to ${email}:`, error);
    // Важно обработать ошибку, чтобы сервер не падал, а вы знали о проблеме
    throw new Error('Could not send verification email.');
  }
};

// Экспортируем функцию, чтобы ее можно было использовать в других файлах
module.exports = {
  sendVerificationEmail,
};