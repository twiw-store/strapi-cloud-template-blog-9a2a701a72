import type { Core } from '@strapi/strapi';

const routes: Core.RouterConfig = {
  type: 'content-api',
  routes: [

    // ✅ один эндпоинт: и INIT для приложения, и CALLBACK PAY от CP
    {
      method: 'POST',
      path: '/cloudpayments/pay',
      handler: 'api::cloudpayments.cloudpayments.pay',
      config: { auth: false },
    },

    // ✅ callback fail
    {
      method: 'POST',
      path: '/cloudpayments/fail',
      handler: 'api::cloudpayments.cloudpayments.fail',
      config: { auth: false },
    },

    // ✅ polling endpoint
    {
      method: 'GET',
      path: '/cloudpayments/status',
      handler: 'api::cloudpayments.cloudpayments.status',
      config: { auth: false },
    },
  ],
};

export default routes;
