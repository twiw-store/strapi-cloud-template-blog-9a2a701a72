'use strict';

/** @type {import('@strapi/strapi').Core.RouterConfig} */
module.exports = {
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
      config: { auth: false },
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
  ],
};
