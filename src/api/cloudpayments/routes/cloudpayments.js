'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/cloudpayments/check',
      handler: 'cloudpayments.check',
      config: {
        auth: false,
      },
    },
    {
      method: 'POST',
      path: '/cloudpayments/pay',
      handler: 'cloudpayments.pay',
      config: {
        auth: false,
      },
    },
  ],
};
