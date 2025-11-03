export default {
  routes: [
    {
      method: 'POST',
      path: '/auth/register-with-profile',
      handler: 'custom-auth.registerWithProfile',
      config: {
        auth: false, // публичный доступ как у стандартной регистрации
        policies: [],
        middlewares: [],
      },
    },
  ],
};
