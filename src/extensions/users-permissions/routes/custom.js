'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/auth/register-with-profile',
      handler: 'auth.registerWithProfile',
      config: { auth: false },
    },
  ],
};
