// src/api/order/controllers/order.ts
import { factories } from '@strapi/strapi';

function normalizeItem(it: any) {
  if (!it || typeof it !== 'object') return it;

  return {
    productId: it.productId ?? null,
    title: it.title ?? '',
    price: typeof it.price === 'number' ? it.price : Number(it.price || 0),
    quantity: typeof it.quantity === 'number' ? it.quantity : Number(it.quantity || 1),

    // app sends size/color, Strapi expects sizes/colors
    sizes: it.sizes ?? it.size ?? '',
    colors: it.colors ?? it.color ?? '',

    productSlug: it.productSlug ?? '',
    imageUrl: it.imageUrl ?? '',

    sku: it.sku ?? null,
    externalCode: it.externalCode ?? null,
    barcode: it.barcode ?? null,
  };
}

function parseNumberLike(v: any): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(',', '.').trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export default factories.createCoreController('api::order.order', ({ strapi }) => ({
  async create(ctx) {
    const incoming = (ctx.request as any).body?.data ?? (ctx.request as any).body ?? {};
    const payload: any = { ...incoming };

    // normalize repeatable component Item
    if (Array.isArray(payload.Item)) {
      payload.Item = payload.Item.map(normalizeItem);
    }

    // ✅ keep the structure: if total пришёл — берём его; если пришёл 0/пусто — считаем из Item
    const incomingTotal =
      payload.total ?? payload.Total ?? payload.amount ?? payload?.meta?.total ?? null;

    const parsedIncomingTotal = parseNumberLike(incomingTotal);

    const computedTotal = Array.isArray(payload.Item)
      ? payload.Item.reduce((sum: number, it: any) => {
          const price = parseNumberLike(it?.price) ?? 0;
          const qty = parseNumberLike(it?.quantity) ?? 0;
          return sum + price * qty;
        }, 0)
      : 0;

    const finalTotal =
      parsedIncomingTotal != null && parsedIncomingTotal > 0 ? parsedIncomingTotal : computedTotal;

    // если всё равно 0 — оставим как есть (не ломаем), но чаще всего станет > 0
    payload.total = Math.round(finalTotal * 100) / 100;

    const created = await strapi.entityService.create('api::order.order', {
      data: payload,
    });

    const full = await strapi.entityService.findOne('api::order.order', created.id, {
      populate: { Item: true },
    });

    return this.transformResponse(full);
  },
}));
