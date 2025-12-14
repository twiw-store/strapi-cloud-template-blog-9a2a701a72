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
    const rawBody: any = (ctx.request as any).body;
    const body = typeof rawBody === 'string' ? qs.parse(rawBody) : (rawBody || {});

    const transactionId =
      body.TransactionId ?? body.transactionId ?? body.transaction_id;

    const invoiceId =
      body.InvoiceId ?? body.invoiceId ?? body.invoice_id; // у тебя это documentId заказа

    // Если нет invoiceId — подтверждаем, но логируем (чтобы не ломать оплату)
    if (!invoiceId) {
      strapi.log.warn(
        `[CloudPayments] confirm: missing InvoiceId. body=${JSON.stringify(body)}`
      );
      ctx.body = { code: 0 };
      return;
    }

    // Strapi v5: в админке у заказа в URL — documentId (строка)
    const orderDocId = String(invoiceId);

    const existing = await strapi.db.query('api::order.order').findOne({
      where: { documentId: orderDocId },
      select: ['id', 'documentId'],
    });

    if (!existing) {
      strapi.log.warn(
        `[CloudPayments] confirm: Order not found by documentId=${orderDocId}`
      );
      ctx.body = { code: 0 };
      return;
    }

    const updated = await strapi.db.query('api::order.order').update({
      where: { documentId: orderDocId },
      data: {
        paymentStatus: 'paid',
        transactionId: transactionId ? String(transactionId) : null,
      },
    });

    strapi.log.info(
      `[CloudPayments] confirm OK documentId=${orderDocId} tx=${transactionId}`
    );

    ctx.body = {
      code: 0,
      updatedDocumentId: orderDocId,
      updatedId: (updated as any)?.id ?? null,
    };
  },

  async fail(ctx: Context) {
    ctx.body = { code: 0 };
  },
};
