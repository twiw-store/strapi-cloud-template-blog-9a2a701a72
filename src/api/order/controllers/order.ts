// src/api/order/controllers/order.ts
import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::order.order', ({ strapi }) => ({
  async create(ctx) {
    // создаём сущность через сервис
    const payload = ctx.request.body?.data || ctx.request.body;
    const created = await strapi.entityService.create('api::order.order', { data: payload });

    // сразу читаем с нужной популяцией
    const full = await strapi.entityService.findOne('api::order.order', created.id, {
      populate: { Item: true },
    });

    // возвращаем через встроенную трансформацию
    return this.transformResponse(full);
  },
}));
