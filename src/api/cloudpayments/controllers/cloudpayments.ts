import type { Context } from 'koa';
import qs from 'qs';

export default {
  async check(ctx: Context) {
    ctx.body = { code: 0 };
  },

  async pay(ctx: Context) {
    ctx.body = { code: 0 };
  },

  async confirm(ctx: Context) {
    // CloudPayments иногда шлёт form-urlencoded, иногда JSON.
    // Strapi обычно парсит сам, но на всякий случай:
    const rawBody: any = (ctx.request as any).body;
    const body =
      typeof rawBody === 'string' ? qs.parse(rawBody) : (rawBody || {});

    const transactionId = body.TransactionId ?? body.transactionId ?? body.transaction_id;
    const invoiceId = body.InvoiceId ?? body.invoiceId ?? body.invoice_id; // лучше всего сюда передавать ID заказа

    // 1) Если нет invoiceId — подтверждаем, но логируем (чтобы не ломать оплату)
    if (!invoiceId) {
      strapi.log.warn(`[CloudPayments] confirm: missing InvoiceId. body=${JSON.stringify(body)}`);
      ctx.body = { code: 0 };
      return;
    }

    // 2) Ищем заказ по id = InvoiceId (самый надёжный сценарий)
    const orderId = Number(invoiceId);

    if (!Number.isFinite(orderId)) {
      strapi.log.warn(`[CloudPayments] confirm: InvoiceId is not numeric: ${invoiceId}`);
      ctx.body = { code: 0 };
      return;
    }

    const existing = await strapi.db.query('api::order.order').findOne({
      where: { id: orderId },
      select: ['id'],
    });

    if (!existing) {
      strapi.log.warn(`[CloudPayments] confirm: Order not found by id=${orderId}`);
      ctx.body = { code: 0 };
      return;
    }

    const updated = await strapi.db.query('api::order.order').update({
  where: { id: orderId },
  data: {
    paymentStatus: 'paid',
    transactionId: transactionId ? String(transactionId) : null,
  },
});

strapi.log.info(`[CloudPayments] confirm OK orderId=${orderId} tx=${transactionId}`);

ctx.body = { code: 0, updatedId: updated?.id ?? null };

  },

  async fail(ctx: Context) {
    ctx.body = { code: 0 };
  },
};
