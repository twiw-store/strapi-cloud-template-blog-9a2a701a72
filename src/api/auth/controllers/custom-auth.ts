import { errors } from '@strapi/utils';

const { ValidationError } = errors;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default {
  async registerWithProfile(ctx) {
    const body = ctx.request.body || {};
    const {
      email,
      password,
      name = '',
      surname = '',
      phone = '',
      language = 'ru',
      country = '',
    } = body;

    if (!email || !EMAIL_RE.test(String(email).toLowerCase())) {
      throw new ValidationError('Invalid email');
    }
    if (!password || String(password).length < 6) {
      throw new ValidationError('Password too short');
    }

    // username обязателен для local-провайдера
    const username = String(email).split('@')[0];

    // Проверим, что пользователь ещё не существует
    const existing = await strapi
      .query('plugin::users-permissions.user')
      .findOne({ where: { email: email.toLowerCase() } });

    if (existing) {
      throw new ValidationError('Email already taken');
    }

    // Создаём пользователя через entityService (пароль будет захеширован плагином)
    const user = await strapi.entityService.create('plugin::users-permissions.user', {
      data: {
        username,
        email: email.toLowerCase(),
        password,
        provider: 'local',
        confirmed: true, // если нужна верификация по email — выставь false и включи подтверждение в U&P
        blocked: false,
        // Кастомные поля профиля (должны существовать в схеме пользователя!)
        name,
        surname,
        phone,
        language,
        country,
      },
    });

    // Сгенерим JWT как делает стандартный /auth/local
    const jwt = await strapi
      .plugin('users-permissions')
      .service('jwt')
      .issue({ id: user.id });

    // Санитизируем ответ (уберём чувствительные поля)
    const { password: _p, resetPasswordToken, confirmationToken, ...safeUser } = user as any;

    ctx.body = { jwt, user: safeUser };
  },
};
