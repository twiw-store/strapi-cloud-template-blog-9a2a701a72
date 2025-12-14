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

function getHeader(ctx: any, name: string) {
  return String(ctx?.request?.headers?.[name.toLowerCase()] ?? '');
}

/**
 * 🔐 CloudPayments HMAC
 */
function verifyCloudPaymentsHmac(ctx: any, parsedBody: any) {
  const secret = process.env.CLOUDPAYMENTS_API_PASSWORD || '';
  if (!secret) return false;

  const received = getHeader(ctx, 'x-content-hmac');
  if (!received) return false;

  const raw =
    (ctx.request as any).rawBody ??
    (typeof (ctx.request as any).body === 'string'
      ? (ctx.request as any).body
      : JSON.stringify(parsedBody ?? (ctx.request as any).body ?? {}));

  const computed = crypto
    .createHmac('sha256', secret)
    .update(raw, 'utf8')
    .digest('base64');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(received),
      Buffer.from(computed)
    );
  } catch {
    return false;
  }
}

// ───────────────── controller ─────────────────

export default {
  // ───────────── CHECK ─────────────
  async check(ctx: Context) {
    strapi.log.info(
      `[CloudPayments] rawBody exists: ${Boolean(
        (ctx.request as any).rawBody
      )}`
    );

    const raw = (ctx.request as any).body;
    const body = typeof raw === 'string' ? qs.parse(raw) : raw || {};

    if (!verifyCloudPaymentsHmac(ctx, body)) {
      ctx.status = 403;
      ctx.body = { code: 13, message: 'Invalid HMAC' };
      return;
    }

    const invoiceId =
      body.InvoiceId ?? body.invoiceId ?? body.invoice_id;

    if (!invoiceId) {
      ctx.body = { code: 10, message: 'Missing InvoiceId' };
      return;
    }

    const order = await strapi.db
      .query('api::order.order')
      .findOne({
        where: { documentId: String(invoiceId) },
        select: ['total', 'currency', 'paymentStatus'] as any,
      });

    if (!order) {
      ctx.body = { code: 10, message: 'Order not found' };
      return;
    }

    if (order.paymentStatus === 'paid') {
      ctx.body = { code: 11, message: 'Already paid' };
      return;
    }

    const amount = parseMoneyLike(body.Amount ?? body.amount);
    if (amount != null) {
      const total = parseMoneyLike(order.total);
      if (total == null || Math.abs(total - amount) > 0.0001) {
        ctx.body = { code: 12, message: 'Amount mismatch' };
        return;
      }
    }

    ctx.body = { code: 0 };
  },

  // ───────────── PAY ─────────────
  async pay(ctx: Context) {
    const body = (ctx.request as any).body || {};
    const documentId =
      body.documentId || body.orderDocumentId;

    if (!documentId) {
      ctx.status = 400;
      ctx.body = { error: 'documentId is required' };
      return;
    }

    const order = await strapi.db
      .query('api::order.order')
      .findOne({
        where: { documentId: String(documentId) },
      });

    if (!order) {
      ctx.status = 404;
      ctx.body = { error: 'Order not found' };
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

    if (order.paymentStatus !== 'paid') {
      await strapi.db.query('api::order.order').update({
        where: { documentId: String(documentId) },
        data: { paymentStatus: 'pending' },
      });
    }

    ctx.body = {
      publicId,
      invoiceId: String(order.documentId),
      amount,
      currency: order.currency || 'RUB',
      description: order.orderNumber
        ? `TWIW order #${order.orderNumber}`
        : `TWIW order ${order.id}`,
    };
  },

  // ───────────── CONFIRM ─────────────
  async confirm(ctx: Context) {
    const raw = (ctx.request as any).body;
    const body = typeof raw === 'string' ? qs.parse(raw) : raw || {};

    if (!verifyCloudPaymentsHmac(ctx, body)) {
      ctx.status = 403;
      ctx.body = { code: 13, message: 'Invalid HMAC' };
      return;
    }

    const invoiceId =
      body.InvoiceId ?? body.invoiceId ?? body.invoice_id;

    if (!invoiceId) {
      ctx.body = { code: 0 };
      return;
    }

    const order = await strapi.db
      .query('api::order.order')
      .findOne({
        where: { documentId: String(invoiceId) },
        select: ['paymentStatus'] as any,
      });

    if (!order || order.paymentStatus === 'paid') {
      ctx.body = { code: 0 };
      return;
    }

    await strapi.db.query('api::order.order').update({
      where: { documentId: String(invoiceId) },
      data: {
        paymentStatus: 'paid',
        transactionId: body.TransactionId
          ? String(body.TransactionId)
          : null,
      },
    });

    ctx.body = { code: 0 };
  },

  // ───────────── FAIL ─────────────
  async fail(ctx: Context) {
    const raw = (ctx.request as any).body;
    const body = typeof raw === 'string' ? qs.parse(raw) : raw || {};

    if (!verifyCloudPaymentsHmac(ctx, body)) {
      ctx.status = 403;
      ctx.body = { code: 13 };
      return;
    }

    const invoiceId =
      body.InvoiceId ?? body.invoiceId ?? body.invoice_id;

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
