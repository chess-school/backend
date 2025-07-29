const getVerificationEmailTemplate = (verificationUrl, t) => {
    return {
        subject: t('email.verificationSubject'), 
        html: `
          <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: auto; border: 1px solid #ddd; padding: 20px;">
            <h2 style="color: #4CAF50;">${t('email.welcome')}</h2>
            <p>${t('email.instruction')}</p>
            <p style="text-align: center;">
              <a 
                href="${verificationUrl}" 
                style="display: inline-block; padding: 12px 24px; font-size: 16px; font-weight: bold; color: #ffffff; background-color: #4CAF50; text-decoration: none; border-radius: 5px;"
              >
                ${t('email.buttonText')}
              </a>
            </p>
            <p style="margin-top: 20px; font-size: 12px; color: #777;">
              ${t('email.linkInstruction')}
              <br>
              <a href="${verificationUrl}" style="color: #4CAF50;">${verificationUrl}</a>
            </p>
            <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
            <p style="font-size: 12px; color: #999;">Chess School Team</p>
          </div>
        `,
    };
};

module.exports = getVerificationEmailTemplate;