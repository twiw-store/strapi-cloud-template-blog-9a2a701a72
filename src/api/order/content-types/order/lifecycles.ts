// src/api/order/content-types/order/lifecycles.ts
import { randomUUID } from 'node:crypto';

type BeforeEvent = { params: { data: Record<string, any>; where?: any } };
type AfterEvent = { result: any; params?: any };
const asAny = (v: any) => v as any;

const ALLOWED_STATUS = new Set(['pending', 'paid', 'shipped', 'delivered', 'cancelled']);
const ALLOWED_LANG = new Set(['ru', 'en', 'fr', 'es'] as const);

function makeOrderNumber() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `TWIW-${y}${m}${day}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

function calcTotal(items: any[] = []) {
  const val = items.reduce(
    (sum, it) => sum + Number(it?.price || 0) * Number(it?.quantity || 0),
    0
  );
  return Math.round(Number.isFinite(val) ? val : 0);
}

function normalizeEmail(e?: string) {
  return typeof e === 'string' ? e.trim().toLowerCase() : '';
}

function toStatusCode(raw?: string) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (['оплачен', 'оплачено', 'payed', 'paid'].includes(s)) return 'paid';
  if (['в обработке', 'ожидает', 'pending', 'awaiting'].includes(s)) return 'pending';
  if (['отгружен', 'отправлен', 'shipped', 'sent'].includes(s)) return 'shipped';
  if (['доставлен', 'delivered'].includes(s)) return 'delivered';
  if (['отменен', 'отменён', 'cancelled', 'canceled'].includes(s)) return 'cancelled';
  return ALLOWED_STATUS.has(s) ? s : 'pending';
}

// ✅ Исправленная версия — динамическая логика
async function fillLangAndCurrencyFromProfile(data: any) {
  // 1. Из payload (прямо из тела запроса)
  if (data.language) data.language = String(data.language).toLowerCase();
  if (data.currency) data.currency = String(data.currency).toUpperCase();

  // 2. Из customer
  if (!data.language && data?.customer?.language)
    data.language = String(data.customer.language).toLowerCase();
  if (!data.currency && data?.customer?.currency)
    data.currency = String(data.customer.currency).toUpperCase();

  // 3. Из пользователя
  try {
    let userId: string | number | undefined;
    if (typeof data.user === 'number' || typeof data.user === 'string') userId = data.user;
    else if (data?.user?.id) userId = data.user.id;
    else if (Array.isArray(data?.user?.connect) && data.user.connect[0]?.id)
      userId = data.user.connect[0].id;

    if (userId) {
      const user = await strapi.entityService.findOne(
        'plugin::users-permissions.user',
        Number(userId)
      );
      const u = user as any;
      if (!data.language && u?.language)
        data.language = String(u.language).toLowerCase();
      if (!data.currency && u?.currency)
        data.currency = String(u.currency).toUpperCase();
      if (!data.customerEmail && u?.email)
        data.customerEmail = u.email.toLowerCase();
    }
  } catch (e) {
    strapi.log.warn('[ORDER] cannot resolve user lang/currency');
  }

  // 4. Дефолты
  if (!data.language) data.language = 'ru';
  if (!data.currency) data.currency = 'RUB';
}

export default {
  async beforeCreate(event: BeforeEvent) {
    strapi.log.info('[ORDER] beforeCreate fired');
    const { data } = event.params;
    if (!data) return;

    await fillLangAndCurrencyFromProfile(data);
    data.orderStatus = toStatusCode(data.orderStatus);
    if (!data.orderNumber) data.orderNumber = makeOrderNumber();

    const items = Array.isArray(data.Item)
      ? data.Item
      : Array.isArray(data.items)
      ? data.items
      : [];

    if (items.length) {
      items.forEach((i) => {
        i.price = Number(i.price) || 0;
        i.quantity = Number(i.quantity) || 0;
      });
      data.total = calcTotal(items);
    }
  },

  async beforeUpdate(event: BeforeEvent) {
    strapi.log.info('[ORDER] beforeUpdate fired');
    const { data, where } = event.params;
    if (!data) return;

    const id = Number(where?.id || data?.id);
    if (id) {
      try {
        const prev = await strapi.entityService.findOne('api::order.order', id, {
          fields: ['orderStatus'],
        });
        if (prev?.orderStatus) (data as any)._prevStatus = String(prev.orderStatus);
      } catch {}
    }

    await fillLangAndCurrencyFromProfile(data);
    if ('orderStatus' in data) data.orderStatus = toStatusCode(data.orderStatus);
    if (!data.orderNumber) data.orderNumber = makeOrderNumber();

    const items = Array.isArray(data.Item)
      ? data.Item
      : Array.isArray(data.items)
      ? data.items
      : [];

    if (items.length) {
      items.forEach((i) => {
        i.price = Number(i.price) || 0;
        i.quantity = Number(i.quantity) || 0;
      });
      data.total = calcTotal(items);
    }
  },

  async afterCreate(event: AfterEvent) {
    strapi.log.info('[ORDER] afterCreate fired');
    try {
      const order = asAny(
        await strapi.entityService.findOne('api::order.order', event.result.id, {
          populate: { Item: true },
        })
      );

      const items = Array.isArray(order?.Item) ? order.Item : [];
      const mustBe = calcTotal(items);

      if (Number(order?.total || 0) !== mustBe) {
        await strapi.entityService.update('api::order.order', order.id, {
          data: { total: mustBe },
        });
        order.total = mustBe;
        strapi.log.info('[ORDER] afterCreate fixed total to ' + mustBe);
      }

      event.result = order;
    } catch (e) {
      strapi.log.error('[ORDER] afterCreate failed', e);
    }
  },

  async afterUpdate(event: AfterEvent) {
    strapi.log.info('[ORDER] afterUpdate fired');
    try {
      const order = asAny(
        await strapi.entityService.findOne('api::order.order', event.result.id, {
          populate: { Item: true },
        })
      );

      const items = Array.isArray(order?.Item) ? order.Item : [];
      const mustBe = calcTotal(items);

      if (Number(order?.total || 0) !== mustBe) {
        await strapi.entityService.update('api::order.order', order.id, {
          data: { total: mustBe },
        });
        order.total = mustBe;
        strapi.log.info('[ORDER] afterUpdate fixed total to ' + mustBe);
      }
    } catch (e) {
      strapi.log.error('[ORDER] afterUpdate failed', e);
    }
  },
};
