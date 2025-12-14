'use strict';

export default {
  routes: [
    // CHECK
    {
      method: 'POST',
      path: '/payments/cloudpayments/check',
      handler: 'cloudpayments.check',
    },

    // PAY
    {
      method: 'POST',
      path: '/payments/cloudpayments/pay',
      handler: 'cloudpayments.pay',
    },

    // CONFIRM
    {
      method: 'POST',
      path: '/payments/cloudpayments/confirm',
      handler: 'cloudpayments.confirm',
    },

    // FAIL
    {
      method: 'POST',
      path: '/payments/cloudpayments/fail',
      handler: 'cloudpayments.fail',
    },
  ],
};
