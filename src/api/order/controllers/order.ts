// src/api/order/controllers/order.ts
import { factories } from '@strapi/strapi';

// жёсткий парс чисел из "1 990", "1,990.00", "1990,00", "€1 990"
function toNumberStrict(v: any): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const cleaned = v
      .replace(/\u00A0|\u202F/g, ' ') // неразрывные пробелы → обычные
      .replace(/[^\d.,-]/g, '')       // выкинуть символы валют
      .replace(/,/g, '.')             // запятые → точки
      .replace(/\s+/g, '');           // убрать пробелы
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function qtyOf(it: any): number {
  const q = toNumberStrict(it?.quantity ?? it?.qty ?? it?.count ?? 1);
  return q > 0 ? q : 1;
}

function priceOf(it: any): number {
  // поддержим разные названия поля цены
  const p = toNumberStrict(it?.price ?? it?.finalPrice ?? it?.currentPrice ?? it?.amount ?? 0);
  return p > 0 ? p : 0;
}

function calcTotal(items: any[] = []): number {
  const val = items.reduce((sum, it) => sum + priceOf(it) * qtyOf(it), 0);
  return Math.round(val);
}

export default factories.createCoreController('api::order.order', ({ strapi }) => ({
  // ВАЖНО: не стрелка. Нужно иметь доступ к this.transformResponse/sanitizeOutput
  async create(this: any, ctx) {
    // 1) payload может прийти как { data: {...} } или просто {...}
    const body = (ctx.request as any)?.body || {};
    const payload = body.data ?? body ?? {};

    // 2) Достаём позиции из Item | items
    const rawItems: any[] =
      Array.isArray(payload?.Item) ? payload.Item :
      Array.isArray(payload?.items) ? payload.items : [];

    // 3) Пересчёт тотала
    const computedTotal = calcTotal(rawItems);
    const incomingTotal = toNumberStrict(payload?.total);
    const totalToSave = incomingTotal > 0 ? Math.round(incomingTotal) : computedTotal;

    // 4) Сбор данных к созданию
    const dataToCreate: any = {
      ...payload,
      Item: Array.isArray(payload?.Item) ? payload.Item : rawItems,
      total: totalToSave,
    };
    if (!dataToCreate.currency) dataToCreate.currency = 'RUB';

    // 5) Создание
    const created = await strapi.entityService.create('api::order.order', { data: dataToCreate });

    // 6) Чтение с популяцией
    let full = await strapi.entityService.findOne('api::order.order', created.id, {
      populate: { Item: true, user: true, customer: true },
    });

    // 7) Страховка: если по каким-то причинам total в БД не совпал — добиваем апдейтом
    const mustBe = calcTotal(Array.isArray((full as any)?.Item) ? (full as any).Item : []);
    if (toNumberStrict((full as any)?.total) !== mustBe) {
      await strapi.entityService.update('api::order.order', created.id, { data: { total: mustBe } });
      full = await strapi.entityService.findOne('api::order.order', created.id, {
        populate: { Item: true, user: true, customer: true },
      });
      strapi.log.info(`[ORDER][controller.create] post-fix total=${mustBe} (id=${created.id})`);
    } else {
      strapi.log.info(`[ORDER][controller.create] total=${(full as any)?.total} ok (id=${created.id})`);
    }

    // 8) Нормальный 201-ответ через встроенную трансформацию (исправляет фронтовую ошибку)
    ctx.status = 201;
    return this.transformResponse(full);
  },
}));
