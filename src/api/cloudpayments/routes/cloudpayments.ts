// src/api/cloudpayments/routes/cloudpayments.ts
import type { Core } from '@strapi/strapi';

const routes: Core.RouterConfig = {
  type: 'content-api',
  routes: [
    // ✅ УСПЕШНАЯ ОПЛАТА (основной хук)
    {
      method: 'POST',
      path: '/cloudpayments/pay',
      handler: 'api::cloudpayments.cloudpayments.pay',
      config: { auth: false },
    },

    // ❌ НЕУСПЕШНАЯ ОПЛАТА
    {
      method: 'POST',
      path: '/cloudpayments/fail',
      handler: 'api::cloudpayments.cloudpayments.fail',
      config: { auth: false },
    },

    // ✅ polling из приложения
    {
      method: 'GET',
      path: '/cloudpayments/status',
      handler: 'api::cloudpayments.cloudpayments.status',
      config: { auth: false },
    },
  ],
};

export default routes;
