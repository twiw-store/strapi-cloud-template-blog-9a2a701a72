'use strict';

module.exports = {
  routes: [
    // CHECK
    { method: 'GET',  path: '/payments/cloudpayments/check', handler: 'cloudpayments.check', config: { auth: false } },
    { method: 'POST', path: '/payments/cloudpayments/check', handler: 'cloudpayments.check', config: { auth: false } },

    // PAY
    { method: 'GET',  path: '/payments/cloudpayments/pay', handler: 'cloudpayments.pay', config: { auth: false } },
    { method: 'POST', path: '/payments/cloudpayments/pay', handler: 'cloudpayments.pay', config: { auth: false } },

    // CONFIRM
    { method: 'GET',  path: '/payments/cloudpayments/confirm', handler: 'cloudpayments.confirm', config: { auth: false } },
    { method: 'POST', path: '/payments/cloudpayments/confirm', handler: 'cloudpayments.confirm', config: { auth: false } },

    // FAIL
    { method: 'GET',  path: '/payments/cloudpayments/fail', handler: 'cloudpayments.fail', config: { auth: false } },
    { method: 'POST', path: '/payments/cloudpayments/fail', handler: 'cloudpayments.fail', config: { auth: false } },
  ],
};
