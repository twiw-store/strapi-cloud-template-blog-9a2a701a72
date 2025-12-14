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
      .replace(/\s+/g, '')              // убрать пробелы
      .replace(/₽|rub|eur|usd/gi, '')   // убрать валюты/символы
      .replace(',', '.');              // запятая -> точка

    const cleaned = normalized.replace(/[^0-9.]/g, ''); // оставить цифры и точку
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
 * CloudPayments HMAC (base64) — приходит в заголовке X-Content-HMAC
 * Считаем HMAC-SHA256 по RAW body. Если rawBody нет — best-effort (может не совпасть).
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

  const a = Buffer.from(received);
  const b = Buffer.from(computed);
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}

export default {
  /**
   * CHECK (CloudPayments -> ваш сервер)
   * Должен:
   *  - проверить подпись
   *  - найти заказ по InvoiceId
   *  - сверить Amount/Currency (если пришли)
   *  - запретить повторную оплату paid-заказа
   */
  async check(ctx: Context) {
    const rawBody: any = (ctx.request as any).body;
    const body = typeof rawBody === 'string' ? qs.parse(rawBody) : (rawBody || {});

    if (!verifyCloudPaymentsHmac(ctx, body)) {
      ctx.status = 403;
      ctx.body = { code: 13, message: 'Invalid HMAC' };
      return;
    }

    const invoiceId = body.InvoiceId ?? body.invoiceId ?? body.invoice_id;
    const amount = parseMoneyLike(body.Amount ?? body.amount);
    const currency = pickFirstString(body, ['Currency', 'currency']) || null;

    if (!invoiceId) {
      ctx.body = { code: 10, message: 'Missing InvoiceId' };
      return;
    }

    const orderDocId = String(invoiceId);

    const order = await strapi.db.query('api::order.order').findOne({
      where: { documentId: orderDocId },
      select: ['id', 'documentId', 'total', 'currency', 'paymentStatus'] as any,
    });

    if (!order) {
      ctx.body = { code: 10, message: 'Order not found' };
      return;
    }

    if ((order as any).paymentStatus === 'paid') {
      ctx.body = { code: 11, message: 'Order already paid' };
      return;
    }

    if (amount != null) {
      const orderAmount = parseMoneyLike((order as any).total);
      if (orderAmount == null || Math.abs(orderAmount - amount) > 0.0001) {
        ctx.body = { code: 12, message: 'Amount mismatch' };
        return;
      }
    }

    if (currency) {
      const orderCurrency = String((order as any).currency || '').toUpperCase();
      if (orderCurrency && orderCurrency !== String(currency).toUpperCase()) {
        ctx.body = { code: 12, message: 'Currency mismatch' };
        return;
      }
    }

    ctx.body = { code: 0 };
  },

  /**
   * PAY (ваше приложение -> ваш сервер)
   * ВАЖНО:
   *  - В проде этот endpoint НЕ должен быть public (routes: auth:true)
   *  - amount из body лучше убрать в проде (считать и хранить total на сервере)
   */
  async pay(ctx: Context) {
    try {
      const body = (ctx.request as any).body || {};

      const orderDocId =
        body.orderDocumentId ||
        body.documentId ||
        body.InvoiceId ||
        body.invoiceId;

      if (!orderDocId) {
        ctx.status = 400;
        ctx.body = { error: 'orderDocumentId (or documentId) is required' };
        return;
      }

      // 1) Находим заказ по documentId
      const order = await strapi.db.query('api::order.order').findOne({
        where: { documentId: String(orderDocId) },
      });

      if (!order) {
        ctx.status = 404;
        ctx.body = { error: `Order not found by documentId=${orderDocId}` };
        return;
      }

      // ---- AMOUNT ----
      // (DEV/FALLBACK) если клиент передал amount — используем, но в проде лучше запретить
      const amountFromBodyRaw = body.amount ?? body.Amount ?? body.total ?? body.Total;
      const amountFromBody = parseMoneyLike(amountFromBodyRaw);

      const rawTotal = (order as any).total;
      let amount = amountFromBody && amountFromBody > 0 ? amountFromBody : parseMoneyLike(rawTotal);

      if (!amount || amount <= 0) {
        amount = pickFirstNumber(order, [
          'totalAmount',
          'amount',
          'sum',
          'totalPrice',
          'grandTotal',
          'finalTotal',
          'priceTotal',
        ]);
      }

      if (!amount || amount <= 0) {
        ctx.status = 400;
        ctx.body = {
          error: 'Order amount is missing or invalid',
          hint: 'Pass "amount" in /pay body OR store total in Order before calling /pay',
          orderTotal: rawTotal,
          orderTotalType: typeof rawTotal,
          bodyAmount: amountFromBodyRaw ?? null,
          bodyAmountParsed: amountFromBody ?? null,
          sampleKeys: Object.keys(order || {}).slice(0, 40),
        };
        return;
      }

      // ---- CURRENCY ----
      const currency = pickFirstString(order, ['currency', 'currencyCode']) || 'RUB';

      // ---- PUBLIC ID ----
      const publicId =
        process.env.CLOUDPAYMENTS_PUBLIC_ID ||
        process.env.CLOUDPAYMENTS_PUBLIC_KEY ||
        process.env.CLOUDPAYMENTS_PUBLIC_PK ||
        '';

      if (!publicId) {
        ctx.status = 500;
        ctx.body = {
          error: 'Missing CLOUDPAYMENTS_PUBLIC_ID in Strapi Cloud env variables',
          hint: 'Add CLOUDPAYMENTS_PUBLIC_ID in Strapi Cloud → Project → Settings → Environment variables',
        };
        return;
      }

      // ставим pending (если не paid)
      try {
        if ((order as any).paymentStatus !== 'paid') {
          await strapi.db.query('api::order.order').update({
            where: { documentId: String(orderDocId) },
            data: { paymentStatus: 'pending' },
          });
        }
      } catch {
        // не критично
      }

      const invoiceId = String((order as any).documentId); // КЛЮЧЕВО: documentId
      const description =
        (order as any).orderNumber
          ? `TWIW order #${(order as any).orderNumber}`
          : `TWIW order ${(order as any).id ?? ''}`.trim();

      ctx.body = {
        publicId,
        invoiceId,
        amount: Number(amount),
        currency,
        description,
      };
    } catch (err: any) {
      strapi.log.error(`[CloudPayments] pay error: ${err?.message || err}`);
      ctx.status = 500;
      ctx.body = {
        error: 'CloudPayments pay failed',
        message: err?.message || String(err),
      };
    }
  },

  /**
   * CONFIRM (CloudPayments -> ваш сервер)
   * Должен:
   *  - проверить подпись
   *  - найти заказ по InvoiceId
   *  - идемпотентность (paid не трогать)
   *  - сверить Amount/Currency
   *  - поставить paid + transactionId
   */
  async confirm(ctx: Context) {
    const rawBody: any = (ctx.request as any).body;
    const body = typeof rawBody === 'string' ? qs.parse(rawBody) : (rawBody || {});

    if (!verifyCloudPaymentsHmac(ctx, body)) {
      ctx.status = 403;
      ctx.body = { code: 13, message: 'Invalid HMAC' };
      return;
    }

    const transactionId = body.TransactionId ?? body.transactionId ?? body.transaction_id;
    const invoiceId = body.InvoiceId ?? body.invoiceId ?? body.invoice_id;

    if (!invoiceId) {
      strapi.log.warn(`[CloudPayments] confirm: missing InvoiceId. body=${JSON.stringify(body)}`);
      ctx.body = { code: 0 };
      return;
    }

    const orderDocId = String(invoiceId);

    const existing = await strapi.db.query('api::order.order').findOne({
      where: { documentId: orderDocId },
      select: ['id', 'documentId', 'total', 'currency', 'paymentStatus'] as any,
    });

    if (!existing) {
      strapi.log.warn(`[CloudPayments] confirm: Order not found by documentId=${orderDocId}`);
      ctx.body = { code: 0 };
      return;
    }

    // идемпотентность
    if ((existing as any).paymentStatus === 'paid') {
      ctx.body = { code: 0 };
      return;
    }

    // сверка суммы/валюты (если пришли)
    const amount = parseMoneyLike(body.Amount ?? body.amount);
    const currency = pickFirstString(body, ['Currency', 'currency']) || null;

    if (amount != null) {
      const orderAmount = parseMoneyLike((existing as any).total);
      if (orderAmount == null || Math.abs(orderAmount - amount) > 0.0001) {
        strapi.log.warn(`[CloudPayments] confirm amount mismatch doc=${orderDocId}`);
        ctx.body = { code: 12, message: 'Amount mismatch' };
        return;
      }
    }

    if (currency) {
      const orderCurrency = String((existing as any).currency || '').toUpperCase();
      if (orderCurrency && orderCurrency !== String(currency).toUpperCase()) {
        strapi.log.warn(`[CloudPayments] confirm currency mismatch doc=${orderDocId}`);
        ctx.body = { code: 12, message: 'Currency mismatch' };
        return;
      }
    }

    const updated = await strapi.db.query('api::order.order').update({
      where: { documentId: orderDocId },
      data: {
        paymentStatus: 'paid',
        transactionId: transactionId ? String(transactionId) : null,
      },
    });

    strapi.log.info(`[CloudPayments] confirm OK documentId=${orderDocId} tx=${transactionId}`);

    ctx.body = {
      code: 0,
      updatedDocumentId: orderDocId,
      updatedId: (updated as any)?.id ?? null,
    };
  },

  /**
   * FAIL (CloudPayments -> ваш сервер)
   * Должен:
   *  - проверить подпись
   *  - найти заказ по InvoiceId
   *  - если не paid -> поставить failed
   */
  async fail(ctx: Context) {
    const rawBody: any = (ctx.request as any).body;
    const body = typeof rawBody === 'string' ? qs.parse(rawBody) : (rawBody || {});

    if (!verifyCloudPaymentsHmac(ctx, body)) {
      ctx.status = 403;
      ctx.body = { code: 13, message: 'Invalid HMAC' };
      return;
    }

    const invoiceId = body.InvoiceId ?? body.invoiceId ?? body.invoice_id;
    const transactionId = body.TransactionId ?? body.transactionId ?? body.transaction_id;

    if (!invoiceId) {
      ctx.body = { code: 0 };
      return;
    }

    const orderDocId = String(invoiceId);

    const order = await strapi.db.query('api::order.order').findOne({
      where: { documentId: orderDocId },
      select: ['id', 'documentId', 'paymentStatus'] as any,
    });

    if (!order) {
      ctx.body = { code: 0 };
      return;
    }

    // paid не трогаем
    if ((order as any).paymentStatus !== 'paid') {
      await strapi.db.query('api::order.order').update({
        where: { documentId: orderDocId },
        data: {
          paymentStatus: 'failed',
          transactionId: transactionId ? String(transactionId) : null,
        },
      });
    }

    ctx.body = { code: 0 };
  },
};
