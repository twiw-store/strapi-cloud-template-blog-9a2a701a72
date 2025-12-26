// src/api/cloudpayments/controllers/cloudpayments.ts (ТОЛЬКО Pay + Fail)

import type { Context } from 'koa';
import qs from 'qs';

export default {
  async pay(ctx: Context) {
    const raw = (ctx.request as any).body;
    const body = typeof raw === 'string' ? qs.parse(raw) : raw || {};

    const invoiceId = body.InvoiceId;
    const amount = Number(body.Amount);
    const status = body.Status;

    if (!invoiceId || !amount || status !== 'Completed') {
      ctx.body = { code: 0 }; // ВСЕГДА 0, чтобы CP не ретраил
      return;
    }

    const order = await strapi.db.query('api::order.order').findOne({
      where: { documentId: String(invoiceId) },
      select: ['paymentStatus', 'total'],
    });

    if (!order) {
      ctx.body = { code: 0 };
      return;
    }

    // идемпотентность
    if (order.paymentStatus === 'paid') {
      ctx.body = { code: 0 };
      return;
    }

    if (Number(order.total) !== amount) {
      strapi.log.warn(`[CP PAY] Amount mismatch ${invoiceId}`);
      ctx.body = { code: 0 };
      return;
    }

    await strapi.db.query('api::order.order').update({
      where: { documentId: String(invoiceId) },
      data: {
        paymentStatus: 'paid',
        orderStatus: 'paid',
        transactionId: body.TransactionId?.toString() ?? null,
      },
    });

    ctx.body = { code: 0 };
  },

  async fail(ctx: Context) {
    const raw = (ctx.request as any).body;
    const body = typeof raw === 'string' ? qs.parse(raw) : raw || {};

    const invoiceId = body.InvoiceId;
    if (!invoiceId) {
      ctx.body = { code: 0 };
      return;
    }

    await strapi.db.query('api::order.order').update({
      where: { documentId: String(invoiceId) },
      data: { paymentStatus: 'failed' },
    });

    ctx.body = { code: 0 };
  },
};
