export default {
  routes: [
    {
      method: 'POST',
      path: '/payments/cloudpayments/check',
      handler: 'cloudpayments.check',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/payments/cloudpayments/pay',
      handler: 'cloudpayments.pay',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/payments/cloudpayments/confirm',
      handler: 'cloudpayments.confirm',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/payments/cloudpayments/fail',
      handler: 'cloudpayments.fail',
      config: { auth: false },
    },
  ],
};
