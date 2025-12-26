// src/api/cloudpayments/routes/cloudpayments.ts
import type { Core } from '@strapi/strapi';

const routes: Core.RouterConfig = {
  type: 'content-api',
  routes: [
    {
      method: 'POST',
      path: '/cloudpayments/pay',
      handler: 'api::cloudpayments.cloudpayments.pay',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/cloudpayments/fail',
      handler: 'api::cloudpayments.cloudpayments.fail',
      config: { auth: false },
    },
  ],
};

export default routes;
