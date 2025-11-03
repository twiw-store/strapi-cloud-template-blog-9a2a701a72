'use strict';

module.exports = (plugin) => {
  plugin.controllers.auth.registerWithProfile = async (ctx) => {
    const { email, password, name, surname, phone } = ctx.request.body || {};

    if (!email || !password) {
      return ctx.badRequest('Email and password are required');
    }

    // Подготовим тело как для стандартной регистрации
    ctx.request.body = {
      username: email,
      email,
      password,
    };

    // Вызовем стандартный register
    await plugin.controllers.auth.register(ctx);

    const reg = ctx.response.body; // { jwt, user }
    const userId = reg?.user?.id;
    const jwt = reg?.jwt;

    if (userId) {
      // Докинем профильные поля
      await strapi.entityService.update('plugin::users-permissions.user', userId, {
        data: { name, surname, phone },
      });

      const user = await strapi.entityService.findOne('plugin::users-permissions.user', userId, {
        fields: ['id', 'username', 'email', 'name', 'surname', 'phone', 'confirmed', 'blocked'],
      });

      ctx.response.body = { jwt, user };
    }
  };

  return plugin;
};
