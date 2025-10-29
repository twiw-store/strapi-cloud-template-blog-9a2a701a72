module.exports = ({ env }) => ({

  // === Почта → Mail.ru через Nodemailer ===
  email: {
    config: {
      provider: 'nodemailer',
      providerOptions: {
        host: env('SMTP_HOST', 'smtp.mail.ru'),
        port: env.int('SMTP_PORT', 465),
        secure: env.bool('SMTP_SECURE', true),
        auth: {
          user: env('SMTP_USER'),
          pass: env('SMTP_PASS'),
        },

      },
      settings: {
        defaultFrom: env('SMTP_FROM', env('SMTP_USER')),
        defaultReplyTo: env('SMTP_REPLY_TO', env('SMTP_USER')),
      },
    },
  },
});

