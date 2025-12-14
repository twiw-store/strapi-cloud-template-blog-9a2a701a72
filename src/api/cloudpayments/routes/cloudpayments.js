'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/cloudpayments/check',
      handler: 'cloudpayments.check',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/cloudpayments/pay',
      handler: 'cloudpayments.pay',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/cloudpayments/confirm',
      handler: 'cloudpayments.confirm',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/cloudpayments/fail',
      handler: 'cloudpayments.fail',
      config: { auth: false },
    },
  ],
};
