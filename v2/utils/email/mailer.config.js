// v2/utils/email/mailer.config.js
const nodemailer = require('nodemailer');

let transporter;

const environment = process.env.NODE_ENV || 'development';

console.log(`Nodemailer: Initializing for '${environment}' environment.`);

switch (environment) {
    case 'production':
        // ВАЖНО: Вам нужно будет добавить эти переменные в ваш .env для продакшена.
        // Я использую стандартные для Gmail как пример.
        // И предполагаю, что process.env.PROD_MAIL_PASS - это ваш 'vuui yzyu wgny srne'
        console.log('Nodemailer: Production environment detected. Configuring for Gmail/SMTP.');
        transporter = nodemailer.createTransport({
            host: process.env.PROD_MAIL_HOST || 'smtp.gmail.com',
            port: process.env.PROD_MAIL_PORT || 465,
            secure: true,
            auth: {
                // ВАЖНО: Добавьте PROD_MAIL_USER в ваш .env (например, ваш gmail адрес)
                user: process.env.PROD_MAIL_USER,
                // Я предполагаю, что вы хотите использовать пароль 'vuui yzyu wgny srne' для продакшена
                pass: process.env.PROD_MAIL_PASS, // Это ваш пароль приложения Gmail/другого сервиса
            },
        });
        break;
    
    case 'development':
    default:
        console.log('Nodemailer: Development environment detected. Configuring for Mailtrap.');
        // Для разработки мы используем Mailtrap, как и было.
        transporter = nodemailer.createTransport({
            host: process.env.MAILTRAP_HOST,
            port: process.env.MAILTRAP_PORT,
            auth: {
                user: process.env.MAILTRAP_USER,
                pass: process.env.MAILTRAP_PASS,
            },
        });
        break;
}

module.exports = transporter;