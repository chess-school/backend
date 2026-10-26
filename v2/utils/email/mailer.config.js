// v2/utils/email/mailer.config.js
const nodemailer = require('nodemailer');

let transporter;

const environment = process.env.NODE_ENV || 'development';

console.log(`Nodemailer: Initializing for '${environment}' environment.`);

switch (environment) {
    case 'production':
        // Все креды берутся из переменных окружения (.env), в коде секретов быть не должно.
        console.log('Nodemailer: Production environment detected. Configuring for Gmail/SMTP.');
        transporter = nodemailer.createTransport({
            host: process.env.PROD_MAIL_HOST || 'smtp.gmail.com',
            port: process.env.PROD_MAIL_PORT || 465,
            secure: true,
            auth: {
                user: process.env.PROD_MAIL_USER, // gmail-адрес отправителя
                pass: process.env.PROD_MAIL_PASS, // app-password из .env
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