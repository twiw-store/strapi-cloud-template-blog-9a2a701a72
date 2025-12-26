// src/api/cloudpayments/controllers/cloudpayments.ts
import type { Context } from 'koa';
import qs from 'qs';
import crypto from 'crypto';

// ───────────────── utils ─────────────────

function parseMoneyLike(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  if (typeof value === 'string') {
    const normalized = value
      .replace(/\s+/g, '')
      .replace(/₽|rub|eur|usd/gi, '')
      .replace(',', '.');

    const cleaned = normalized.replace(/[^0-9.]/g, '');
    if (!cleaned) return null;

    const num = Number(cleaned);
    return Number.isFinite(num) ? num : null;
  }

  return null;
}

function pickCurrency(body: any) {
  const c = body?.Currency ?? body?.currency ?? null;
  return c ? String(c).toUpperCase() : null;
}

function getHeader(ctx: any, name: string) {
  const key = String(name || '').toLowerCase();
  const v = ctx?.request?.headers?.[key];
  return Array.isArray(v) ? String(v[0] ?? '') : String(v ?? '');
}

/**
 * Достаём RAW body как строку для HMAC.
 * В проде rawBody часто приходит Buffer'ом — это нормально.
 */
function getRawBodyString(ctx: any): string | null {
  const rb = (ctx.request as any).rawBody;

  if (typeof rb === 'string') return rb;
  if (Buffer.isBuffer(rb)) return rb.toString('utf8');

  // иногда middleware кладёт в другое поле
  const rb2 = (ctx.request as any).rawBodyBuffer;
  if (Buffer.isBuffer(rb2)) return rb2.toString('utf8');

  return null;
}

/**
 * 🔐 CloudPayments HMAC
 * CP подписывает именно RAW body (строку form-urlencoded / json),
 * а заголовок X-Content-HMAC — base64(hmac_sha256(raw, secret))
 */
function verifyCloudPaymentsHmac(ctx: any) {
  const secret = process.env.CLOUDPAYMENTS_API_PASSWORD || '';
  if (!secret) return false;

  const received = getHeader(ctx, 'x-content-hmac');
  if (!received) return false;

  const raw = getRawBodyString(ctx);
  if (!raw) return false;

  const computed = crypto.createHmac('sha256', secret).update(raw, 'utf8').digest('base64');

  try {
    // сравниваем БАЙТЫ, а не строки
    const a = Buffer.from(received, 'base64');
    const b = Buffer.from(computed, 'base64');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function cpOk(ctx: Context) {
  ctx.body = { code: 0 };
}
function cpErr(ctx: Context, code: number, message?: string) {
  ctx.body = message ? { code, message } : { code };
}

function amountsMismatch(orderTotal: any, receivedAmount: number) {
  const total = parseMoneyLike(orderTotal);
  if (total == null) return true;
  return Math.abs(total - receivedAmount) > 0.01;
}

// ───────────────── controller ─────────────────

export default {
  async check(ctx: Context) {
    const raw = (ctx.request as any).body;
    const body = typeof raw === 'string' ? qs.parse(raw) : raw || {};

    // Обычно CP рекомендует выключать Check.
    // Если включишь — можешь включить HMAC и здесь:
    // if (!verifyCloudPaymentsHmac(ctx)) { ctx.status = 403; cpErr(ctx, 13, 'Invalid HMAC'); return; }

    const invoiceId = body.InvoiceId ?? body.invoiceId ?? body.invoice_id;
    if (!invoiceId) {
      cpErr(ctx, 10, 'Missing InvoiceId');
      return;
    }

    const order = await strapi.db.query('api::order.order').findOne({
      where: { documentId: String(invoiceId) },
      select: ['total', 'currency', 'paymentStatus'] as any,
    });

    if (!order) {
      cpErr(ctx, 10, 'Order not found');
      return;
    }

    if (order.paymentStatus === 'paid') {
      cpErr(ctx, 11, 'Already paid');
      return;
    }

    const amount = parseMoneyLike(body.Amount ?? body.amount);
    if (amount != null && amountsMismatch(order.total, amount)) {
      cpErr(ctx, 12, 'Amount mismatch');
      return;
    }

    const currency = pickCurrency(body);
    if (currency) {
      const orderCurrency = String(order.currency || '').toUpperCase();
      if (orderCurrency && orderCurrency !== currency) {
        cpErr(ctx, 12, 'Currency mismatch');
        return;
      }
    }

    cpOk(ctx);
  },

  async pay(ctx: Context) {
    const body = (ctx.request as any).body || {};
    const documentId = body.documentId || body.orderDocumentId;

    if (!documentId) {
      ctx.status = 400;
      ctx.body = { error: 'documentId is required' };
      return;
    }

    const order = await strapi.db.query('api::order.order').findOne({
      where: { documentId: String(documentId) },
      select: ['documentId', 'id', 'orderNumber', 'total', 'currency', 'paymentStatus'] as any,
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

    const amount = parseMoneyLike(order.total);
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

    ctx.body = {
      publicId,
      invoiceId: String(order.documentId),
      amount,
      currency: order.currency || 'RUB',
      description: order.orderNumber ? `TWIW order #${order.orderNumber}` : `TWIW order ${order.id}`,
    };
  },

  async confirm(ctx: Context) {
    const raw = (ctx.request as any).body;
    const body = typeof raw === 'string' ? qs.parse(raw) : raw || {};

    if (!verifyCloudPaymentsHmac(ctx)) {
      ctx.status = 403;
      cpErr(ctx, 13, 'Invalid HMAC');
      return;
    }

    const invoiceId = body.InvoiceId ?? body.invoiceId ?? body.invoice_id;
    if (!invoiceId) {
      cpOk(ctx);
      return;
    }

    const order = await strapi.db.query('api::order.order').findOne({
      where: { documentId: String(invoiceId) },
      select: ['total', 'currency', 'paymentStatus'] as any,
    });

    if (!order) {
      cpOk(ctx);
      return;
    }

    if (order.paymentStatus === 'paid') {
      cpOk(ctx);
      return;
    }

    const amount = parseMoneyLike(body.Amount ?? body.amount);
    if (amount != null && amountsMismatch(order.total, amount)) {
      strapi.log.warn(
        `[CP confirm] amount mismatch invoiceId=${invoiceId} orderTotal=${order.total} cpAmount=${amount}`
      );
      cpOk(ctx);
      return;
    }

    const currency = pickCurrency(body);
    if (currency) {
      const orderCurrency = String(order.currency || '').toUpperCase();
      if (orderCurrency && orderCurrency !== currency) {
        strapi.log.warn(
          `[CP confirm] currency mismatch invoiceId=${invoiceId} orderCurrency=${orderCurrency} cpCurrency=${currency}`
        );
        cpOk(ctx);
        return;
      }
    }

    await strapi.db.query('api::order.order').update({
      where: { documentId: String(invoiceId) },
      data: {
        paymentStatus: 'paid',
        orderStatus: 'paid',
        transactionId: body.TransactionId ? String(body.TransactionId) : null,
      },
    });

    cpOk(ctx);
  },

  async fail(ctx: Context) {
    const raw = (ctx.request as any).body;
    const body = typeof raw === 'string' ? qs.parse(raw) : raw || {};

    if (!verifyCloudPaymentsHmac(ctx)) {
      ctx.status = 403;
      cpErr(ctx, 13, 'Invalid HMAC');
      return;
    }

    const invoiceId = body.InvoiceId ?? body.invoiceId ?? body.invoice_id;
    if (!invoiceId) {
      cpOk(ctx);
      return;
    }

    const existing = await strapi.db.query('api::order.order').findOne({
      where: { documentId: String(invoiceId) },
      select: ['paymentStatus'] as any,
    });

    if (!existing) {
      cpOk(ctx);
      return;
    }

    if (existing.paymentStatus === 'paid' || existing.paymentStatus === 'failed') {
      cpOk(ctx);
      return;
    }

    await strapi.db.query('api::order.order').update({
      where: { documentId: String(invoiceId) },
      data: {
        paymentStatus: 'failed',
        transactionId: body.TransactionId ? String(body.TransactionId) : null,
      },
    });

    cpOk(ctx);
  },

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
      ctx.body = { ok: false, invoiceId, found: false };
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
