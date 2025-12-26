// src/api/cloudpayments/routes/cloudpayments.ts
import type { Core } from '@strapi/strapi';

const routes: Core.RouterConfig = {
  type: 'content-api',
  routes: [
    // 1) Приложение: получить параметры для виджета + поставить pending
    {
      method: 'POST',
      path: '/cloudpayments/pay',
      handler: 'api::cloudpayments.cloudpayments.pay',
      config: { auth: false },
    },

    // 2) CloudPayments webhook: успешная оплата
    {
      method: 'POST',
      path: '/cloudpayments/webhook/pay',
      handler: 'api::cloudpayments.cloudpayments.webhookPay',
      config: { auth: false },
    },

    // 3) CloudPayments webhook: неуспех
    {
      method: 'POST',
      path: '/cloudpayments/webhook/fail',
      handler: 'api::cloudpayments.cloudpayments.webhookFail',
      config: { auth: false },
    },

    // 4) Приложение: polling статуса
    {
      method: 'GET',
      path: '/cloudpayments/status',
      handler: 'api::cloudpayments.cloudpayments.status',
      config: { auth: false },
    },
  ],
};

export default routes;
