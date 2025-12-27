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

// total у тебя integer → работаем int
function toIntMoney(v: any): number | null {
  const n = toNumber(v);
  if (n == null) return null;
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

function normalizePaymentStatus(list: any[]) {
  // если ХОТЬ ОДНА запись paid/paid_captured → считаем paid
  const statuses = new Set(list.map((x) => String(x?.paymentStatus || '').toLowerCase()));
  if (statuses.has('paid_captured')) return 'paid_captured';
  if (statuses.has('paid')) return 'paid';
  if (statuses.has('failed')) return 'failed';
  if (statuses.has('processing')) return 'processing';
  return 'pending';
}

export default {
  async pay(ctx: Context) {
    const body = parseBody(ctx);
    const orderQuery = strapi.db.query('api::order.order') as any;

    // ✅ 1) APP INIT
    const documentId = body.documentId || body.orderDocumentId;
    if (documentId) {
      // ВАЖНО: findMany, потому что может быть draft+published с одинаковым documentId
      const orders = await orderQuery.findMany({
        where: { documentId: String(documentId) },
        select: ['id', 'documentId', 'orderNumber', 'total', 'currency', 'paymentStatus', 'publishedAt'],
        populate: { Item: true },
        orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
        limit: 10,
      });

      const order = orders?.[0];
      if (!order) {
        ctx.status = 404;
        ctx.body = { error: 'Order not found' };
        return;
      }

      // если уже paid в любой записи — блокируем
      const agg = normalizePaymentStatus(orders);
      if (agg === 'paid' || agg === 'paid_captured') {
        ctx.status = 409;
        ctx.body = { error: 'Order already paid' };
        return;
      }

      let amount = toIntMoney(order.total);

      if (!amount || amount <= 0) {
        const computed = calcTotalFromItemsInt(order.Item || []);
        if (computed > 0) {
          amount = computed;
          // обновим total у всех версий документа
          for (const o of orders) {
            await orderQuery.update({ where: { id: o.id }, data: { total: computed } });
          }
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

      // ставим pending всем записям документа (чтобы status/админка не читали другую “ветку”)
      for (const o of orders) {
        await orderQuery.update({
          where: { id: o.id },
          data: { paymentStatus: 'pending' },
        });
      }

      ctx.status = 200;
      ctx.body = {
        publicId,
        invoiceId: String(order.documentId),
        amount,
        currency: order.currency || 'RUB',
        description: order.orderNumber
          ? `TWIW order #${order.orderNumber}`
          : `TWIW order ${order.id}`,
      };
      return;
    }

    // ✅ 2) CLOUDPAYMENTS CALLBACK PAY
    const invoiceId = body.InvoiceId ?? body.invoiceId ?? body.invoice_id;
    const status = String(body.Status ?? body.status ?? '').trim();
    const cpAmount = toIntMoney(body.Amount ?? body.amount);

    try {
      strapi.log.info(`[CP CALLBACK PAY] ${JSON.stringify(body)}`);
    } catch {}

    // всегда code=0, но оплачиваем только Completed
    if (!invoiceId || status !== 'Completed' || cpAmount == null) return cpOk(ctx);

    const orders = await orderQuery.findMany({
      where: { documentId: String(invoiceId) },
      select: ['id', 'total', 'paymentStatus'],
      orderBy: [{ id: 'desc' }],
      limit: 10,
    });

    if (!orders?.length) return cpOk(ctx);

    const agg = normalizePaymentStatus(orders);
    if (agg === 'paid' || agg === 'paid_captured') return cpOk(ctx);

    const orderTotal = toIntMoney(orders[0]?.total);

    if (orderTotal && Math.abs(orderTotal - cpAmount) > 0) {
      strapi.log.warn(
        `[CP PAY] Amount mismatch invoiceId=${invoiceId} orderTotal=${orderTotal} cpAmount=${cpAmount}`
      );
      return cpOk(ctx);
    }

    // ✅ КЛЮЧ: обновляем ВСЕ записи по documentId
    for (const o of orders) {
      await orderQuery.update({
        where: { id: o.id },
        data: {
          total: orderTotal && orderTotal > 0 ? orderTotal : cpAmount,
          paymentStatus: 'paid',
          orderStatus: 'paid',
          transactionId: body.TransactionId ? String(body.TransactionId) : null,
        },
      });
    }

    return cpOk(ctx);
  },

  async fail(ctx: Context) {
    const body = parseBody(ctx);
    const invoiceId = body.InvoiceId ?? body.invoiceId ?? body.invoice_id;
    const status = String(body.Status ?? body.status ?? '').trim();

    const orderQuery = strapi.db.query('api::order.order') as any;

    try {
      strapi.log.info(`[CP CALLBACK FAIL] ${JSON.stringify(body)}`);
    } catch {}

    if (!invoiceId) return cpOk(ctx);

    const orders = await orderQuery.findMany({
      where: { documentId: String(invoiceId) },
      select: ['id', 'paymentStatus'],
      orderBy: [{ id: 'desc' }],
      limit: 10,
    });

    if (!orders?.length) return cpOk(ctx);

    const agg = normalizePaymentStatus(orders);
    if (agg === 'paid' || agg === 'paid_captured') return cpOk(ctx);

    // fail ставим всем (но только если это реально Declined/Failed)
    if (status && status !== 'Declined' && status !== 'Failed') return cpOk(ctx);

    for (const o of orders) {
      await orderQuery.update({
        where: { id: o.id },
        data: {
          paymentStatus: 'failed',
          transactionId: body.TransactionId ? String(body.TransactionId) : null,
        },
      });
    }

    return cpOk(ctx);
  },

  async status(ctx: Context) {
    const invoiceId = String(ctx.query?.invoiceId || '').trim();
    if (!invoiceId) {
      ctx.status = 400;
      ctx.body = { error: 'invoiceId is required' };
      return;
    }

    const orderQuery = strapi.db.query('api::order.order') as any;

    const orders = await orderQuery.findMany({
      where: { documentId: invoiceId },
      select: ['id', 'documentId', 'paymentStatus', 'orderStatus', 'transactionId', 'publishedAt'],
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      limit: 10,
    });

    if (!orders?.length) {
      ctx.status = 404;
      ctx.body = { ok: false, found: false, invoiceId };
      return;
    }

    const aggPay = normalizePaymentStatus(orders);
    const best = orders[0];

    ctx.status = 200;
    ctx.body = {
      ok: true,
      found: true,
      invoiceId,
      paymentStatus: aggPay,
      orderStatus:
        aggPay === 'paid' || aggPay === 'paid_captured'
          ? 'paid'
          : (best.orderStatus || 'pending'),
      transactionId: best.transactionId || null,
    };
  },
};
