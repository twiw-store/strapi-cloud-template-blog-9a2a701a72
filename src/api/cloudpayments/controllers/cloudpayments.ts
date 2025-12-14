import type { Context } from 'koa';
import qs from 'qs';
import crypto from 'crypto';

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
    if (!Number.isFinite(num)) return null;

    return num;
  }

  return null;
}

function getHeader(ctx: any, name: string) {
  return String(ctx?.request?.headers?.[name.toLowerCase()] ?? '');
}

/**
 * 🔐 CloudPayments HMAC check
 */
function verifyCloudPaymentsHmac(ctx: any, parsedBody: any) {
  const secret = process.env.CLOUDPAYMENTS_API_PASSWORD || '';
  if (!secret) return false;

  // 🔍 RAW BODY CHECK (для теста, потом можно убрать)
  strapi.log.info(
    '[CloudPayments] rawBody exists:',
    Boolean((ctx.request as any).rawBody)
  );

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

  const a = Buffer.from(received);
  const b = Buffer.from(computed);
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}

export default {
  // ───────────────── CHECK ─────────────────
  async check(ctx: Context) {
    const raw = (ctx.request as any).body;
    const body = typeof raw === 'string' ? qs.parse(raw) : raw || {};

    if (!verifyCloudPaymentsHmac(ctx, body)) {
      ctx.status = 403;
      ctx.body = { code: 13, message: 'Invalid HMAC' };
      return;
    }

    const invoiceId = body.InvoiceId ?? body.invoiceId;
    if (!invoiceId) {
      ctx.body = { code: 10, message: 'Missing InvoiceId' };
      return;
    }

    const order = await strapi.db.query('api::order.order').findOne({
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

    const amount = parseMoneyLike(body.Amount);
    if (amount != null) {
      const total = parseMoneyLike(order.total);
      if (total == null || Math.abs(total - amount) > 0.0001) {
        ctx.body = { code: 12, message: 'Amount mismatch' };
        return;
      }
    }

    ctx.body = { code: 0 };
  },

  // ───────────────── PAY ─────────────────
  async pay(ctx: Context) {
    const body = (ctx.request as any).body || {};
    const docId = body.documentId || body.orderDocumentId;

    if (!docId) {
      ctx.status = 400;
      ctx.body = { error: 'documentId required' };
      return;
    }

    const order = await strapi.db.query('api::order.order').findOne({
      where: { documentId: String(docId) },
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
      ctx.body = { error: 'Missing CloudPayments public id' };
      return;
    }

    await strapi.db.query('api::order.order').update({
      where: { documentId: String(docId) },
      data: { paymentStatus: 'pending' },
    });

    ctx.body = {
      publicId,
      invoiceId: String(order.documentId),
      amount,
      currency: order.currency || 'RUB',
      description: `TWIW order #${order.orderNumber}`,
    };
  },

  // ───────────────── CONFIRM ─────────────────
  async confirm(ctx: Context) {
    const raw = (ctx.request as any).body;
    const body = typeof raw === 'string' ? qs.parse(raw) : raw || {};

    if (!verifyCloudPaymentsHmac(ctx, body)) {
      ctx.status = 403;
      ctx.body = { code: 13, message: 'Invalid HMAC' };
      return;
    }

    const invoiceId = body.InvoiceId ?? body.invoiceId;
    if (!invoiceId) {
      ctx.body = { code: 0 };
      return;
    }

    const order = await strapi.db.query('api::order.order').findOne({
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
        transactionId: String(body.TransactionId || ''),
      },
    });

    ctx.body = { code: 0 };
  },

  // ───────────────── FAIL ─────────────────
  async fail(ctx: Context) {
    const raw = (ctx.request as any).body;
    const body = typeof raw === 'string' ? qs.parse(raw) : raw || {};

    if (!verifyCloudPaymentsHmac(ctx, body)) {
      ctx.status = 403;
      ctx.body = { code: 13 };
      return;
    }

    const invoiceId = body.InvoiceId ?? body.invoiceId;
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
