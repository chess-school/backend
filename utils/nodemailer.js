const nodemailer = require('nodemailer');

let transporter;

if (process.env.NODE_ENV === 'production') {
  transporter = nodemailer.createTransport({
    host: process.env.PROD_MAIL_HOST,
    port: process.env.PROD_MAIL_PORT,
    secure: true,
    auth: {
      user: process.env.PROD_MAIL_USER,
      pass: process.env.PROD_MAIL_PASS,
    },
  });

} else if (process.env.NODE_ENV === 'development') {
  console.log('Nodemailer: Development environment detected. Configuring for Mailtrap.');
  transporter = nodemailer.createTransport({
    host: process.env.MAILTRAP_HOST,
    port: process.env.MAILTRAP_PORT,
    auth: {
      user: process.env.MAILTRAP_USER,
      pass: process.env.MAILTRAP_PASS,
    },
  });

} else {
    transporter = nodemailer.createTransport({
        host: process.env.MAILTRAP_HOST,
        port: process.env.MAILTRAP_PORT,
        auth: {
          user: process.env.MAILTRAP_USER,
          pass: process.env.MAILTRAP_PASS,
        },
      });
}


const sendVerificationEmail = async (email, token, t) => {
  const isProduction = process.env.NODE_ENV === 'production';
  const verificationUrl = `${process.env.BASE_URL}/auth/verify-email?token=${encodeURIComponent(token)}`;
  const fromAddress = isProduction
    ? `"Chess School" <${process.env.PROD_MAIL_USER}>`
    : '"Chess School (Dev)" <no-reply@chess-school.com>';

  const mailOptions = {
    from: fromAddress,
    to: email,
    subject: t('email.verificationSubject'), 
    html: `
      <div style="font-family: sans-serif; padding: 20px; color: #333;">
        <h2>${t('email.welcome')}</h2>
        <p>${t('email.instruction')}</p>
        <a 
          href="${verificationUrl}" 
          style="display: inline-block; padding: 12px 24px; font-size: 16px; color: #fff; background-color: #4CAF50; text-decoration: none; border-radius: 5px;"
        >
          ${t('email.buttonText')}
        </a>
        <p style="margin-top: 20px;">${t('email.linkInstruction')}</p>
        <p><a href="${verificationUrl}">${verificationUrl}</a></p>
      </div>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Verification email sent successfully to ${email}`);
  } catch (error) {
    console.error(`Error sending email to ${email}:`, error);
    throw new Error('Could not send verification email.');
  }
};

module.exports = {
  sendVerificationEmail,
};