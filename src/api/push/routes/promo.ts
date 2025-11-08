export default {
  routes: [
    {
      method: 'POST',
      path: '/push/promo',
      handler: 'promo.send',
      config: { policies: ['admin::isAuthenticatedAdmin'] },
    },
  ],
};
