// src/api/cloudpayments/routes/cloudpayments.ts
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

    // ✅ polling endpoint для приложения
    {
      method: 'GET',
      path: '/cloudpayments/status',
      handler: 'api::cloudpayments.cloudpayments.status',
      config: { auth: false },
    },
  ],
};

export default routes;
