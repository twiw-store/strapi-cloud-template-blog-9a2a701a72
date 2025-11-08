export default {
  routes: [
    { method: 'POST', path: '/push/register', handler: 'push.register', config: { policies: [] } },
    { method: 'POST', path: '/push/test', handler: 'push.test', config: { policies: [] } },
    { method: 'POST', path: '/push/send', handler: 'push.send', config: { policies: [] } }
  ]
};
