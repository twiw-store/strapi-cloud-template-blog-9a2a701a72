// src/api/order/controllers/order.ts
import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::order.order', ({ strapi }) => ({
  async create(ctx) {
    const body = ctx.request.body?.data || ctx.request.body;

    const items = body.Item || [];
    if (!items.length) {
      return ctx.badRequest('Order items required');
    }

    let total = 0;

    for (const item of items) {
      const product = await strapi.entityService.findOne(
        'api::product.product',
        item.product,
        { fields: ['price'] }
      );

      if (!product) {
        return ctx.badRequest(`Product not found: ${item.product}`);
      }

      total += Number(product.price) * Number(item.quantity || 1);
    }

    // ❌ НЕ принимаем total от клиента
    delete body.total;

    const created = await strapi.entityService.create('api::order.order', {
      data: {
        ...body,
        total,
        paymentStatus: 'pending',
        orderStatus: 'pending',
      },
    });

    const full = await strapi.entityService.findOne(
      'api::order.order',
      created.id,
      { populate: { Item: true } }
    );

    return this.transformResponse(full);
  },
}));
