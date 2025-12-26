// src/api/cloudpayments/controllers/cloudpayments.ts
import type { Context } from 'koa';
import qs from 'qs';

function cpOk(ctx: Context) {
  ctx.body = { code: 0 };
}

function parseBody(ctx: Context) {
  const raw = (ctx.request as any).body;
  return typeof raw === 'string' ? (qs.parse(raw) as any) : (raw || {});
}

export default {
  // CloudPayments → Pay
  async pay(ctx: Context) {
    const body = parseBody(ctx);

    const invoiceId = body.InvoiceId ?? body.invoiceId ?? body.invoice_id;
    const amountRaw = body.Amount ?? body.amount;
    const amount = Number(amountRaw);
    const status = body.Status ?? body.status;

    // Важно: CP должен получить {code:0} всегда, иначе будет долбить ретраями
    if (!invoiceId || !Number.isFinite(amount) || status !== 'Completed') {
      return cpOk(ctx);
    }

    const order = await strapi.db.query('api::order.order').findOne({
      where: { documentId: String(invoiceId) },
      select: ['paymentStatus', 'total'] as any,
    });

    if (!order) return cpOk(ctx);
    if (order.paymentStatus === 'paid') return cpOk(ctx);

    // мягкая проверка суммы
    const orderTotal = Number(order.total);
    if (Number.isFinite(orderTotal) && Math.abs(orderTotal - amount) > 0.01) {
      strapi.log.warn(`[CP PAY] Amount mismatch invoiceId=${invoiceId} orderTotal=${order.total} cpAmount=${amount}`);
      return cpOk(ctx);
    }

    await strapi.db.query('api::order.order').update({
      where: { documentId: String(invoiceId) },
      data: {
        paymentStatus: 'paid',
        orderStatus: 'paid',
        transactionId: body.TransactionId ? String(body.TransactionId) : null,
      },
    });

    return cpOk(ctx);
  },

  // CloudPayments → Fail
  async fail(ctx: Context) {
    const body = parseBody(ctx);
    const invoiceId = body.InvoiceId ?? body.invoiceId ?? body.invoice_id;

    if (!invoiceId) return cpOk(ctx);

    const order = await strapi.db.query('api::order.order').findOne({
      where: { documentId: String(invoiceId) },
      select: ['paymentStatus'] as any,
    });

    if (!order) return cpOk(ctx);
    if (order.paymentStatus === 'paid') return cpOk(ctx);

    await strapi.db.query('api::order.order').update({
      where: { documentId: String(invoiceId) },
      data: {
        paymentStatus: 'failed',
        transactionId: body.TransactionId ? String(body.TransactionId) : null,
      },
    });

    return cpOk(ctx);
  },

  // App → polling
  async status(ctx: Context) {
    const invoiceId = String(ctx.query?.invoiceId || '').trim();

    if (!invoiceId) {
      ctx.status = 400;
      ctx.body = { error: 'invoiceId is required' };
      return;
    }

    const order = await strapi.db.query('api::order.order').findOne({
      where: { documentId: invoiceId },
      select: ['documentId', 'paymentStatus', 'orderStatus'] as any,
    });

    if (!order) {
      ctx.status = 404;
      ctx.body = { ok: false, found: false, invoiceId };
      return;
    }

    ctx.status = 200;
    ctx.body = {
      ok: true,
      found: true,
      invoiceId,
      paymentStatus: order.paymentStatus || 'pending',
      orderStatus: order.orderStatus || 'pending',
    };
  },
};
