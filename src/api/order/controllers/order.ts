// src/api/order/controllers/order.ts
import { factories } from '@strapi/strapi';

function normalizeItem(it: any) {
  if (!it || typeof it !== 'object') return it;

  return {
    // в Strapi компоненте поля такие:
    productId: it.productId ?? null,
    title: it.title ?? '',
    price: typeof it.price === 'number' ? it.price : Number(it.price || 0),
    quantity: typeof it.quantity === 'number' ? it.quantity : Number(it.quantity || 1),

    // ВАЖНО: приложение шлёт size/color, а Strapi ждёт sizes/colors
    sizes: it.sizes ?? it.size ?? '',
    colors: it.colors ?? it.color ?? '',

    productSlug: it.productSlug ?? '',
    imageUrl: it.imageUrl ?? '',

    sku: it.sku ?? null,
    externalCode: it.externalCode ?? null,
    barcode: it.barcode ?? null,

    // если Strapi компонент реально ждёт media "images", можно оставить пусто
    // images: it.images ?? undefined,
  };
}

export default factories.createCoreController('api::order.order', ({ strapi }) => ({
  async create(ctx) {
    const incoming = (ctx.request as any).body?.data ?? (ctx.request as any).body ?? {};

    const payload: any = { ...incoming };

    // нормализуем Item (repeatable component)
    if (Array.isArray(payload.Item)) {
      payload.Item = payload.Item.map(normalizeItem);
    }

    const created = await strapi.entityService.create('api::order.order', {
      data: payload,
    });

    const full = await strapi.entityService.findOne('api::order.order', created.id, {
      populate: { Item: true },
    });

    return this.transformResponse(full);
  },
}));
