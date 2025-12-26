import type { Context } from 'koa';
import qs from 'qs';

function cpOk(ctx: Context) {
  ctx.status = 200;
  ctx.body = { code: 0 };
}

function parseBody(ctx: Context) {
  const raw = (ctx.request as any).body;
  return typeof raw === 'string' ? (qs.parse(raw) as any) : (raw || {});
}

function toNumber(v: any): number | null {
  const n =
    typeof v === 'number'
      ? v
      : Number(String(v ?? '').replace(/\s+/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function calcTotalFromItems(items: any[]): number {
  if (!Array.isArray(items)) return 0;
  const sum = items.reduce((acc, it) => {
    const price = toNumber(it?.price) ?? 0;
    const qty = toNumber(it?.quantity) ?? 1;
    return acc + price * qty;
  }, 0);
  return Math.round(sum * 100) / 100;
}

export default {
  // ─────────────────────────────────────────
  // OPTIONAL: если routes содержит /check — пусть не падает
  async check(ctx: Context) {
    return cpOk(ctx);
  },

  // ─────────────────────────────────────────
  // OPTIONAL: если routes содержит /confirm — пусть не падает
  async confirm(ctx: Context) {
    return cpOk(ctx);
  },

  // ─────────────────────────────────────────
  // Один endpoint /cloudpayments/pay:
  // 1) App INIT: { documentId } -> отдаём publicId/amount/invoiceId
  // 2) CloudPayments callback Pay: { InvoiceId, Amount, Status, TransactionId } -> ставим paid
  async pay(ctx: Context) {
    const body = parseBody(ctx);

    // ✅ 1) APP INIT (виджет)
    const documentId = body.documentId || body.orderDocumentId;
    if (documentId) {
      const order = await strapi.db.query('api::order.order').findOne({
        where: { documentId: String(documentId) },
        select: ['documentId', 'id', 'orderNumber', 'total', 'currency', 'paymentStatus'] as any,
        populate: { Item: true } as any,
      });

      if (!order) {
        ctx.status = 404;
        ctx.body = { error: 'Order not found' };
        return;
      }

      if (order.paymentStatus === 'paid') {
        ctx.status = 409;
        ctx.body = { error: 'Order already paid' };
        return;
      }

      let amount = toNumber(order.total);

      // если total = 0 → считаем из Item и обновляем
      if (!amount || amount <= 0) {
        const computed = calcTotalFromItems(order.Item || []);
        if (computed > 0) {
          amount = computed;
          await strapi.db.query('api::order.order').update({
            where: { documentId: String(documentId) },
            data: { total: computed },
          });
        }
      }

      if (!amount || amount <= 0) {
        ctx.status = 400;
        ctx.body = { error: 'Invalid order total' };
        return;
      }

      const publicId = process.env.CLOUDPAYMENTS_PUBLIC_ID || '';
      if (!publicId) {
        ctx.status = 500;
        ctx.body = { error: 'Missing CLOUDPAYMENTS_PUBLIC_ID' };
        return;
      }

      await strapi.db.query('api::order.order').update({
        where: { documentId: String(documentId) },
        data: { paymentStatus: 'pending' },
      });

      ctx.status = 200;
      ctx.body = {
        publicId,
        invoiceId: String(order.documentId),
        amount,
        currency: order.currency || 'RUB',
        description: order.orderNumber ? `TWIW order #${order.orderNumber}` : `TWIW order ${order.id}`,
      };
      return;
    }

    // ✅ 2) CLOUDPAYMENTS CALLBACK PAY
    const invoiceId = body.InvoiceId ?? body.invoiceId ?? body.invoice_id;
    const status = body.Status ?? body.status;
    const cpAmount = toNumber(body.Amount ?? body.amount);

    // CloudPayments должен всегда получить code=0 (чтобы не ретраил)
    if (!invoiceId || status !== 'Completed') return cpOk(ctx);

    const order = await strapi.db.query('api::order.order').findOne({
      where: { documentId: String(invoiceId) },
      select: ['paymentStatus', 'total'] as any,
    });

    if (!order) return cpOk(ctx);
    if (order.paymentStatus === 'paid') return cpOk(ctx);

    // Если total=0 — НЕ блочим оплату, просто примем cpAmount
    const orderTotal = toNumber(order.total);
    if (orderTotal && cpAmount && Math.abs(orderTotal - cpAmount) > 0.01) {
      strapi.log.warn(
        `[CP PAY] Amount mismatch invoiceId=${invoiceId} orderTotal=${order.total} cpAmount=${cpAmount}`
      );
      return cpOk(ctx);
    }

    await strapi.db.query('api::order.order').update({
      where: { documentId: String(invoiceId) },
      data: {
        total: orderTotal && orderTotal > 0 ? orderTotal : (cpAmount ?? orderTotal ?? 0),
        paymentStatus: 'paid',
        orderStatus: 'paid',
        transactionId: body.TransactionId ? String(body.TransactionId) : null,
      },
    });

    return cpOk(ctx);
  },

  // ─────────────────────────────────────────
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

  // ─────────────────────────────────────────
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
      select: ['documentId', 'paymentStatus', 'orderStatus', 'transactionId'] as any,
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
      transactionId: order.transactionId || null,
    };
  },
};
