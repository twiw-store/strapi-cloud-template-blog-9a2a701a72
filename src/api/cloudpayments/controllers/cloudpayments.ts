// src/api/cloudpayments/controllers/cloudpayments.ts

import type { Context } from 'koa';
import qs from 'qs';

function cpOk(ctx: Context) {
  ctx.status = 200;
  ctx.body = { code: 0 };
}

function parseBody(ctx: Context) {
  const raw = (ctx.request as any).body;
  return typeof raw === 'string' ? (qs.parse(raw) as any) : raw || {};
}

function toNumber(v: any): number | null {
  const n =
    typeof v === 'number'
      ? v
      : Number(String(v ?? '').replace(/\s+/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

// total в Order schema = integer → приводим к integer
function toIntMoney(v: any): number | null {
  const n = toNumber(v);
  if (n == null) return null;
  // CP может прислать "1.00", у тебя total integer → делаем 1
  return Math.round(n);
}

function calcTotalFromItemsInt(items: any[]): number {
  if (!Array.isArray(items)) return 0;
  const sum = items.reduce((acc, it) => {
    const price = toIntMoney(it?.price) ?? 0;
    const qty = toIntMoney(it?.quantity) ?? 1;
    return acc + price * qty;
  }, 0);
  return Math.round(sum);
}

export default {
  /**
   * Один endpoint /cloudpayments/pay:
   * 1) App INIT: { documentId } -> отдаём publicId/amount/invoiceId
   * 2) CloudPayments callback Pay: { InvoiceId, Amount, Status, TransactionId, ... } -> ставим paid
   */
  async pay(ctx: Context) {
    const body = parseBody(ctx);

    // ✅ Делаем query как any, чтобы TS не трахал мозг enum-полями (paymentStatus и т.д.)
    const orderQuery = strapi.db.query('api::order.order') as any;

    // ─────────────────────────────────────────
    // ✅ 1) APP INIT (виджет)
    const documentId = body.documentId || body.orderDocumentId;
    if (documentId) {
      const order = await orderQuery.findOne({
        where: { documentId: String(documentId) },
        select: ['documentId', 'id', 'orderNumber', 'total', 'currency', 'paymentStatus'],
        populate: { Item: true },
      });

      if (!order) {
        ctx.status = 404;
        ctx.body = { error: 'Order not found' };
        return;
      }

      if (order.paymentStatus === 'paid' || order.paymentStatus === 'paid_captured') {
        ctx.status = 409;
        ctx.body = { error: 'Order already paid' };
        return;
      }

      let amount = toIntMoney(order.total);

      // если total = 0 → считаем из Item и обновляем total
      if (!amount || amount <= 0) {
        const computed = calcTotalFromItemsInt(order.Item || []);
        if (computed > 0) {
          amount = computed;
          await orderQuery.update({
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

      // ставим pending (не paid)
      await orderQuery.update({
        where: { documentId: String(documentId) },
        data: { paymentStatus: 'pending' },
      });

      ctx.status = 200;
      ctx.body = {
        publicId,
        invoiceId: String(order.documentId),
        amount, // integer
        currency: order.currency || 'RUB',
        description: order.orderNumber
          ? `TWIW order #${order.orderNumber}`
          : `TWIW order ${order.id}`,
      };
      return;
    }

    // ─────────────────────────────────────────
    // ✅ 2) CLOUDPAYMENTS CALLBACK PAY
    const invoiceId = body.InvoiceId ?? body.invoiceId ?? body.invoice_id;
    const status = String(body.Status ?? body.status ?? '').trim();
    const cpAmount = toIntMoney(body.Amount ?? body.amount);

    try {
      strapi.log.info(`[CP CALLBACK PAY] ${JSON.stringify(body)}`);
    } catch {}

    // CP всегда должен получить code=0, иначе ретраи
    // ВАЖНО: оплачиваем ТОЛЬКО если Completed
    if (!invoiceId || status !== 'Completed' || cpAmount == null) return cpOk(ctx);

    const order = await orderQuery.findOne({
      where: { documentId: String(invoiceId) },
      select: ['paymentStatus', 'total'],
    });

    if (!order) return cpOk(ctx);
    if (order.paymentStatus === 'paid' || order.paymentStatus === 'paid_captured') return cpOk(ctx);

    const orderTotal = toIntMoney(order.total);

    // мягкая проверка суммы (если total > 0)
    if (orderTotal && Math.abs(orderTotal - cpAmount) > 0) {
      strapi.log.warn(
        `[CP PAY] Amount mismatch invoiceId=${invoiceId} orderTotal=${order.total} cpAmount=${cpAmount}`
      );
      return cpOk(ctx);
    }

    await orderQuery.update({
      where: { documentId: String(invoiceId) },
      data: {
        total: orderTotal && orderTotal > 0 ? orderTotal : cpAmount,
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

    const orderQuery = strapi.db.query('api::order.order') as any;

    try {
      strapi.log.info(`[CP CALLBACK FAIL] ${JSON.stringify(body)}`);
    } catch {}

    if (!invoiceId) return cpOk(ctx);

    const order = await orderQuery.findOne({
      where: { documentId: String(invoiceId) },
      select: ['paymentStatus'],
    });

    if (!order) return cpOk(ctx);
    if (order.paymentStatus === 'paid' || order.paymentStatus === 'paid_captured') return cpOk(ctx);

    await orderQuery.update({
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

    const orderQuery = strapi.db.query('api::order.order') as any;

    const order = await orderQuery.findOne({
      where: { documentId: invoiceId },
      select: ['documentId', 'paymentStatus', 'orderStatus', 'transactionId'],
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
