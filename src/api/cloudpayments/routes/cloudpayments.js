'use strict';

module.exports = {
  routes: [
    { method: 'POST', path: '/cloudpayments/check', handler: 'cloudpayments.check' },
    { method: 'POST', path: '/cloudpayments/pay', handler: 'cloudpayments.pay' },
  ],
};
