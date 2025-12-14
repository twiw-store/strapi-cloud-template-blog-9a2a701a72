import type { Context } from 'koa';
import qs from 'qs';

function pickFirstNumber(obj: any, keys: string[]) {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

function pickFirstString(obj: any, keys: string[]) {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return null;
}

export default {
  async check(ctx: Context) {
    ctx.body = { code: 0 };
  },

  /**
   * PAY
   * Ожидает:
   *  - documentId (или orderDocumentId) заказа
   * Возвращает:
   *  - publicId, invoiceId (documentId), amount, currency, description
   */
  async pay(ctx: Context) {
    const body = (ctx.request as any).body || {};

    const orderDocId =
      body.documentId ||
      body.orderDocumentId ||
      body.invoiceId ||
      body.InvoiceId;

    if (!orderDocId) {
      ctx.status = 400;
      ctx.body = { error: 'documentId (orderDocumentId) is required' };
      return;
    }

    // 1) Находим заказ по documentId
    const order = await strapi.db.query('api::order.order').findOne({
      where: { documentId: String(orderDocId) },
      // оставим select попроще — если у тебя другие поля, оно всё равно придёт, но Strapi может обрезать
      // можно убрать select полностью, но так безопаснее
      select: [
        'id',
        'documentId',
        'paymentStatus',
        'transactionId',
        // ниже поля могут не существовать — это ок
        'total',
        'totalAmount',
        'amount',
        'sum',
        'currency',
        'orderNumber',
      ] as any,
    });

    if (!order) {
      ctx.status = 404;
      ctx.body = { error: `Order not found by documentId=${orderDocId}` };
      return;
    }

    // 2) Вычисляем сумму и валюту из заказа (подстраховка под разные названия полей)
    const amount = pickFirstNumber(order, ['totalAmount', 'total', 'amount', 'sum']);
    const currency = pickFirstString(order, ['currency']) || 'RUB';

    if (!amount || amount <= 0) {
      ctx.status = 400;
      ctx.body = {
        error: 'Order amount is missing or invalid',
        hint: 'Add numeric field totalAmount/total/amount/sum to Order or adjust pay() to your schema',
      };
      return;
    }

    // 3) (Опционально) ставим статус pending перед оплатой
    // Если у тебя enum другой — скажи, я подстрою
    try {
      if (order.paymentStatus !== 'paid') {
        await strapi.db.query('api::order.order').update({
          where: { documentId: String(orderDocId) },
          data: { paymentStatus: 'pending' },
        });
      }
    } catch (e) {
      // не ломаем оплату из-за статуса
      strapi.log.warn(`[CloudPayments] pay: could not set pending for ${orderDocId}`);
    }

    // 4) Готовим данные для виджета CloudPayments
    // publicId возьмём из ENV, чтобы не хранить в коде
    const publicId =
      process.env.CLOUDPAYMENTS_PUBLIC_ID ||
      process.env.CLOUDPAYMENTS_PUBLIC_KEY ||
      '';

    if (!publicId) {
      ctx.status = 500;
      ctx.body = {
        error: 'Missing CLOUDPAYMENTS_PUBLIC_ID in environment variables',
      };
      return;
    }

    const invoiceId = String(order.documentId); // КЛЮЧЕВО: InvoiceId = documentId
    const description =
      order.orderNumber
        ? `TWIW order #${order.orderNumber}`
        : `TWIW order ${order.id}`;

    ctx.body = {
      publicId,
      invoiceId,
      amount,
      currency,
      description,
      // можно добавить любые метаданные, которые отправишь в widget
      // accountId: userId/email и т.п.
    };
  },

  async confirm(ctx: Context) {
    const rawBody: any = (ctx.request as any).body;
    const body = typeof rawBody === 'string' ? qs.parse(rawBody) : (rawBody || {});

    const transactionId =
      body.TransactionId ?? body.transactionId ?? body.transaction_id;

    const invoiceId =
      body.InvoiceId ?? body.invoiceId ?? body.invoice_id;

    if (!invoiceId) {
      strapi.log.warn(
        `[CloudPayments] confirm: missing InvoiceId. body=${JSON.stringify(body)}`
      );
      ctx.body = { code: 0 };
      return;
    }

    const orderDocId = String(invoiceId);

    const existing = await strapi.db.query('api::order.order').findOne({
      where: { documentId: orderDocId },
      select: ['id', 'documentId'] as any,
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
    // Можно ставить paymentStatus='failed' по documentId, если CloudPayments пришлёт InvoiceId
    ctx.body = { code: 0 };
  },
};
