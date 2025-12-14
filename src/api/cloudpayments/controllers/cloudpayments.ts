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

function parseMoneyLike(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  if (typeof value === 'string') {
    // "12 990 ₽" -> "12990"
    // "12,990.50" -> "12990.50"
    // "12990 RUB" -> "12990"
    const normalized = value
      .replace(/\s+/g, '')                  // убрать пробелы
      .replace(/₽|rub|eur|usd|₽/gi, '')     // убрать валюту/символы
      .replace(',', '.');                  // запятая -> точка

    const cleaned = normalized.replace(/[^0-9.]/g, ''); // оставить цифры и точку
    if (!cleaned) return null;

    const num = Number(cleaned);
    if (!Number.isFinite(num)) return null;

    return num;
  }

  return null;
}

export default {
  async check(ctx: Context) {
    ctx.body = { code: 0 };
  },

  /**
   * PAY
   * Body: { orderDocumentId: string }  (можно documentId)
   * Return: { publicId, invoiceId, amount, currency, description }
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

      // Забираем заказ целиком (без select)
      const order = await strapi.db.query('api::order.order').findOne({
        where: { documentId: String(orderDocId) },
      });

      if (!order) {
        ctx.status = 404;
        ctx.body = { error: `Order not found by documentId=${orderDocId}` };
        return;
      }

      // ---- AMOUNT ----
      // 1) Пытаемся из order.total (у тебя он точно есть)
      const rawTotal = (order as any).total;
      let amount = parseMoneyLike(rawTotal);

      // 2) fallback на другие поля (если total пустой/0)
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
          hint: 'Field "total" exists but cannot be parsed or equals 0. Check if total is filled.',
          totalValue: rawTotal,
          totalType: typeof rawTotal,
          sampleKeys: Object.keys(order || {}).slice(0, 40),
        };
        return;
      }

      // ---- CURRENCY ----
      const currency =
        pickFirstString(order, ['currency', 'currencyCode']) || 'RUB';

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

      // (опционально) ставим pending
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

      const invoiceId = String((order as any).documentId); // КЛЮЧЕВО
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

  async confirm(ctx: Context) {
    const rawBody: any = (ctx.request as any).body;
    const body =
      typeof rawBody === 'string' ? qs.parse(rawBody) : (rawBody || {});

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
    ctx.body = { code: 0 };
  },
};
