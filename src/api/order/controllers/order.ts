// src/api/order/controllers/order.ts
import { factories } from '@strapi/strapi';

function calcTotal(items: any[] = []) {
  const val = items.reduce((sum, it) => {
    const price = Number(it?.price ?? it?.finalPrice ?? it?.currentPrice ?? 0);
    const qty   = Number(it?.quantity ?? it?.qty ?? 1);
    if (!Number.isFinite(price) || !Number.isFinite(qty)) return sum;
    return sum + price * qty;
  }, 0);
  return Math.round(val);
}

export default factories.createCoreController('api::order.order', ({ strapi }) => ({
  async create(ctx) {
    // 1) Аккуратно достаём payload (Strapi может прислать { data: ... } или просто {...})
    const body = (ctx.request as any)?.body || {};
    const payload = body.data ?? body ?? {};

    // 2) Берём позиции из Item или items
    const rawItems: any[] =
      Array.isArray(payload?.Item) ? payload.Item :
      Array.isArray(payload?.items) ? payload.items : [];

    // 3) Считаем тотал заранее
    const preTotal = calcTotal(rawItems);

    // 4) Готовим данные к созданию: если total пустой/<=0 — проставим вычисленный
    const dataToCreate = {
      ...payload,
      Item: Array.isArray(payload?.Item) ? payload.Item : rawItems,
      total: (Number(payload?.total) > 0 ? Number(payload.total) : preTotal),
    };

    // Страховка: валюта по умолчанию
    if (!dataToCreate.currency) dataToCreate.currency = 'RUB';

    // 5) Создаём сущность
    const created = await strapi.entityService.create('api::order.order', { data: dataToCreate });

    // 6) Читаем с популяцией позиций
    let full = await strapi.entityService.findOne('api::order.order', created.id, {
      populate: { Item: true, user: true, customer: true },
      fields: ['id', 'total', 'currency', 'orderNumber', 'orderStatus', 'createdAt', 'updatedAt'],
    });

    // 7) На всякий: если вдруг total всё ещё не совпал — добиваем обновлением
    const mustBe = calcTotal(Array.isArray((full as any)?.Item) ? (full as any).Item : []);
    if (Number((full as any)?.total || 0) !== mustBe) {
      await strapi.entityService.update('api::order.order', created.id, { data: { total: mustBe } });
      // перечитаем для корректного ответа
      full = await strapi.entityService.findOne('api::order.order', created.id, {
        populate: { Item: true, user: true, customer: true },
        fields: ['id', 'total', 'currency', 'orderNumber', 'orderStatus', 'createdAt', 'updatedAt'],
      });
      strapi.log.info(`[ORDER][controller.create] post-fix total=${mustBe} (id=${created.id})`);
    } else {
      strapi.log.info(`[ORDER][controller.create] total=${(full as any)?.total} ok (id=${created.id})`);
    }

    // 8) Возвращаем через встроенную трансформацию
    // @ts-ignore (у фабричного контроллера есть transformResponse)
    return this.transformResponse(full);
  },
}));
