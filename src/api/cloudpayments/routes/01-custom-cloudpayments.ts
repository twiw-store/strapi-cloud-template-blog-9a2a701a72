import type { Core } from '@strapi/strapi';

const routes: Core.RouterConfig = {
  type: 'content-api',
  routes: [
    {
      method: 'POST',
      path: '/cloudpayments/check',
      handler: 'api::cloudpayments.cloudpayments.check',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/cloudpayments/pay',
      handler: 'api::cloudpayments.cloudpayments.pay',
      config: {
        auth: { strategies: ['users-permissions'] },
      },
    },
    {
      method: 'POST',
      path: '/cloudpayments/confirm',
      handler: 'api::cloudpayments.cloudpayments.confirm',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/cloudpayments/fail',
      handler: 'api::cloudpayments.cloudpayments.fail',
      config: { auth: false },
    },

    // ✅ ВОТ ЭТО — НОВОЕ
    {
      method: 'POST',
      path: '/cloudpayments/verify',
      handler: 'api::cloudpayments.cloudpayments.verify',
      config: { auth: false },
    },
  ],
};

export default routes;
