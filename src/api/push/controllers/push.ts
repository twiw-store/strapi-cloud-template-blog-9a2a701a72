import pushSvc from '../services/push';

export default {
  async register(ctx) {
    const { token, platform, userId, lang, country, marketingOptIn = true, tags = [] } = ctx.request.body || {};
    if (!token) return ctx.badRequest('token required');

    const repo = strapi.db.query('api::push-device.push-device');
    const existing = await repo.findOne({ where: { token } });
    const data = { platform, lang, country, marketingOptIn, tags, lastSeenAt: new Date(), user: userId || null };

    if (existing) await repo.update({ where: { id: existing.id }, data });
    else await repo.create({ data: { token, ...data } });

    ctx.body = { ok: true };
  },

  async test(ctx) {
    const { token } = ctx.request.body || {};
    if (!token) return ctx.badRequest('token required');
    const res = await pushSvc.sendPush({ tokens: [token] }, { title: 'TWIW', body: 'Test push 🚀' });
    ctx.body = res;
  },

  async send(ctx) {
    const { target, payload } = ctx.request.body || {};
    const res = await pushSvc.sendPush(target, payload);
    ctx.body = res;
  }
};
