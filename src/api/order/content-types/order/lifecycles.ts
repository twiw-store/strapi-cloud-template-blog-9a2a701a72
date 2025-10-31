// src/api/order/content-types/order/lifecycles.ts
import { randomUUID } from 'node:crypto';

type BeforeEvent = { params: { data: Record<string, any> } };
type AfterEvent = { result: any };
const asAny = (v: any) => v as any;

const ALLOWED_STATUS = new Set(['pending', 'paid', 'shipped', 'delivered', 'cancelled']);
const ALLOWED_LANG = new Set(['ru', 'en', 'fr', 'es'] as const);

function makeOrderNumber() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `TWIW-${y}${m}${day}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

function calcTotal(items: any[] = []) {
  return Math.round(
    items.reduce((sum, it) =>
      sum + Number(it?.price || 0) * Number(it?.quantity || 0)
    , 0)
  );
}

function normalizeEmail(e?: string) {
  return typeof e === 'string' ? e.trim().toLowerCase() : '';
}

function toStatusCode(raw?: string) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (['оплачен','оплачено','payed','paid'].includes(s)) return 'paid';
  if (['в обработке','ожидает','pending','awaiting'].includes(s)) return 'pending';
  if (['отгружен','отправлен','shipped','sent'].includes(s)) return 'shipped';
  if (['доставлен','delivered'].includes(s)) return 'delivered';
  if (['отменен','отменён','cancelled','canceled'].includes(s)) return 'cancelled';
  return ALLOWED_STATUS.has(s) ? s : 'pending';
}

function normalizeLang(raw?: string) {
  const s = String(raw ?? '').trim().toLowerCase();
  return (ALLOWED_LANG.has(s as any) ? s : 'ru') as 'ru' | 'en' | 'fr' | 'es';
}

function fmtCurrency(amount: number, currency = 'RUB', lang: 'ru'|'en'|'fr'|'es' = 'ru') {
  const locales: Record<typeof lang, string> = { ru: 'ru-RU', en: 'en-US', fr: 'fr-FR', es: 'es-ES' };
  try {
    return new Intl.NumberFormat(locales[lang], { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

function renderOrderEmailHtml(order: any) {
  const lang = normalizeLang(order?.language);
  const t = {
    ru: {
      thanks: 'Спасибо за заказ!',
      intro: 'Мы приняли оплату и начали сборку. Ниже детали вашего заказа.',
      items: 'Состав заказа',
      qty: 'Количество',
      total: 'Итого',
      delivery: 'Доставка',
      questions: 'Вопросы по заказу?',
    },
    en: {
      thanks: 'Thank you for your order!',
      intro: 'We received your payment and started preparing your order. Details below.',
      items: 'Order items',
      qty: 'Qty',
      total: 'Total',
      delivery: 'Delivery',
      questions: 'Questions about your order?',
    },
    fr: {
      thanks: 'Merci pour votre commande !',
      intro: 'Nous avons reçu votre paiement et préparons votre commande. Détails ci-dessous.',
      items: 'Articles de la commande',
      qty: 'Qté',
      total: 'Total',
      delivery: 'Livraison',
      questions: 'Des questions sur votre commande ?',
    },
    es: {
      thanks: '¡Gracias por tu pedido!',
      intro: 'Hemos recibido tu pago y empezamos a preparar tu pedido. Detalles abajo.',
      items: 'Artículos del pedido',
      qty: 'Cant.',
      total: 'Total',
      delivery: 'Entrega',
      questions: '¿Preguntas sobre tu pedido?',
    },
  }[lang];

  const logo = process.env.BRAND_LOGO_URL || 'https://via.placeholder.com/120x32?text=TWIW';
  const siteUrl = process.env.SITE_URL || 'https://twiw.store';
  const supportEmail = process.env.ORDER_PUBLIC_CONTACT || 'support@twiw.store';
  const items: any[] = Array.isArray(order?.Item) ? order.Item : [];

  const itemsHtml = items.map((it) => {
    const name = it?.name || it?.title || 'Товар';
    const qty = it?.quantity || it?.qty || 1;
    const price = Number(it?.price || 0);
    const lineTotal = price * qty;
    const img = it?.imageUrl || it?.image || it?.images?.[0]?.url || '';
    const variant = [it?.size, it?.color].filter(Boolean).join(' • ');
    return `
      <tr>
        <td style="padding:12px 0; display:flex; gap:12px; align-items:center;">
          ${img ? `<img src="${img}" width="64" height="64" style="border-radius:8px; object-fit:cover" alt="">` : ''}
          <div>
            <div style="font-weight:600; font-size:14px; color:#111827">${name}</div>
            ${variant ? `<div style="font-size:12px; color:#6B7280">${variant}</div>` : ''}
            <div style="font-size:12px; color:#6B7280">${t.qty}: ${qty}</div>
          </div>
        </td>
        <td style="padding:12px 0; text-align:right; font-weight:600; color:#111827;">${fmtCurrency(lineTotal, order.currency || 'RUB', lang)}</td>
      </tr>
    `;
  }).join('') || `<tr><td style="padding:12px 0; color:#6B7280">—</td><td></td></tr>`;

  const address = [
    order?.country, order?.city, order?.street,
    order?.building && `д.${order.building}`,
    order?.apartment && `кв.${order.apartment}`,
    order?.zip
  ].filter(Boolean).join(', ');

  const total = Number(order?.total || 0);

  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><title>Order ${order.orderNumber}</title></head>
<body style="margin:0; background:#F9FAFB; font-family:ui-sans-serif,-apple-system,Segoe UI,Roboto,Helvetica,Arial;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:640px; background:#FFFFFF; border-radius:16px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,0.06)">
        <tr><td style="padding:24px 28px; border-bottom:1px solid #F3F4F6;">
          <table width="100%"><tr>
            <td><img src="${logo}" alt="TWIW" height="32" style="display:block"></td>
            <td align="right" style="font-size:12px; color:#6B7280;">№ ${order.orderNumber}</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:24px 28px;">
          <h1 style="margin:0 0 8px; font-size:20px; color:#111827;">${t.thanks}</h1>
          <p style="margin:0; color:#374151; font-size:14px;">${t.intro}</p>
        </td></tr>
        <tr><td style="padding:0 28px 8px; font-weight:600; font-size:14px; color:#111827;">${t.items}</td></tr>
        <tr><td style="padding:0 28px 8px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${itemsHtml}</table>
        </td></tr>
        <tr><td style="padding:16px 28px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="color:#6B7280; font-size:14px;">${t.total}</td>
                <td align="right" style="font-weight:700; color:#111827; font-size:16px;">${fmtCurrency(total, order.currency || 'RUB', lang)}</td>
            </tr>
          </table>
        </td></tr>
        <tr><td style="padding:8px 28px 20px;">
          <div style="background:#F9FAFB; border:1px solid #E5E7EB; border-radius:12px; padding:12px 14px;">
            <div style="font-weight:600; color:#111827; font-size:14px; margin-bottom:4px;">${t.delivery}</div>
            <div style="color:#374151; font-size:14px;">${order?.deliveryMethod || 'courier'}${address ? ` • ${address}` : ''}</div>
          </div>
        </td></tr>
        <tr><td style="padding:0 28px 24px; color:#6B7280; font-size:12px;">
          ${t.questions} <a href="mailto:${process.env.ORDER_PUBLIC_CONTACT || 'support@twiw.store'}" style="color:#111827; text-decoration:none;">${process.env.ORDER_PUBLIC_CONTACT || 'support@twiw.store'}</a>
          • <a href="${process.env.SITE_URL || 'https://twiw.store'}" style="color:#111827; text-decoration:none;">${process.env.SITE_URL || 'https://twiw.store'}</a>.
        </td></tr>
      </table>
      <div style="padding:16px; color:#9CA3AF; font-size:11px;">© ${new Date().getFullYear()} TWIW</div>
    </td></tr>
  </table>
</body></html>`;
}

async function sendBothEmails(order: any) {
  const plugin = strapi.plugin('email');
  if (!plugin) {
    strapi.log.warn('[EMAIL] email plugin not installed/configured');
    return;
  }
  const emailSvc = plugin.service('email');

  const clientTo = normalizeEmail(order.customerEmail);
  const adminTo  = normalizeEmail(process.env.ORDER_NOTIFY_EMAIL || '');

  const lang = normalizeLang(order?.language);
  const subjects = {
    ru: `TWIW: заказ №${order.orderNumber} оплачен`,
    en: `TWIW: order #${order.orderNumber} paid`,
    fr: `TWIW : commande n°${order.orderNumber} payée`,
    es: `TWIW: pedido nº${order.orderNumber} pagado`,
  } as const;

  // клиенту HTML
  if (clientTo) {
    const html = renderOrderEmailHtml(order);
    const res1 = await emailSvc.send({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      replyTo: process.env.SMTP_REPLY_TO || process.env.SMTP_USER,
      to: clientTo,
      subject: subjects[lang],
      text: `Спасибо за покупку! Сумма: ${order.total} ${order.currency || 'RUB'}.`,
      html,
    });
    strapi.log.info(`[EMAIL→CLIENT] ok to=${clientTo} messageId=${res1?.messageId ?? '-'}`);
  } else {
    strapi.log.warn(`[EMAIL→CLIENT] skip: empty customerEmail for ${order.orderNumber}`);
  }

  // админу текст
  if (adminTo) {
    const items = Array.isArray(order?.Item) ? order.Item : [];
    const lines = items.map((it: any) =>
      `• ${it?.name || it?.title || 'Товар'} × ${it?.quantity || 1} = ${fmtCurrency(Number(it?.price||0) * Number(it?.quantity||1), order.currency || 'RUB', lang)}`
    ).join('\n');

    const res2 = await emailSvc.send({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: adminTo,
      subject: `Новый оплаченный заказ ${order.orderNumber}`,
      text: `Сумма: ${fmtCurrency(Number(order.total||0), order.currency||'RUB', lang)}\nКлиент: ${order.customerEmail}\nДоставка: ${order.deliveryMethod || '-'}\n${lines}`,
    });
    strapi.log.info(`[EMAIL→ADMIN] ok to=${adminTo} messageId=${res2?.messageId ?? '-'}`);
  } else {
    strapi.log.warn('[EMAIL→ADMIN] skip: ORDER_NOTIFY_EMAIL not set');
  }

  await strapi.entityService.update('api::order.order', order.id, {
    data: { emailSentAt: new Date() },
  });
  strapi.log.info(`[ORDER] email marked sent for ${order.orderNumber}`);
}

export default {
  async beforeCreate(event: BeforeEvent) {
    const { data } = event.params;
    if (!data) return;

    // язык/валюта/статус по умолчанию + нормализация
    data.language = normalizeLang(data.language);
    if (!data.currency) data.currency = 'RUB';
    data.orderStatus = toStatusCode(data.orderStatus);

    // номер заказа
    if (!data.orderNumber || data.orderNumber === '-' || data.orderNumber === '') {
      data.orderNumber = makeOrderNumber();
    }

    // total из Item/items
    const items = Array.isArray(data.Item)
      ? data.Item
      : Array.isArray(data.items)
      ? data.items
      : [];
    if (items.length) data.total = calcTotal(items);
  },

  async beforeUpdate(event: BeforeEvent) {
    const { data } = event.params;
    if (!data) return;

    if ('language' in data) data.language = normalizeLang(data.language);
    if ('orderStatus' in data) data.orderStatus = toStatusCode(data.orderStatus);

    if (!data.orderNumber || data.orderNumber === '-' || data.orderNumber === '') {
      data.orderNumber = makeOrderNumber();
    }

    const items = Array.isArray(data.Item)
      ? data.Item
      : Array.isArray(data.items)
      ? data.items
      : [];
    if (items.length) data.total = calcTotal(items);
  },

  async afterCreate(event: AfterEvent) {
    try {
      const order = asAny(await strapi.entityService.findOne('api::order.order', event.result.id, {
        populate: { Item: true },
      }));

      const items = Array.isArray(order?.Item) ? order.Item : [];
      const mustBe = calcTotal(items);

      if (Number(order?.total || 0) !== mustBe) {
        await strapi.entityService.update('api::order.order', order.id, { data: { total: mustBe } });
        order.total = mustBe;
        strapi.log.info('[ORDER] afterCreate fixed total to', mustBe);
      }

      event.result = order; // оставить populate
    } catch (e) {
      strapi.log.error('[ORDER] afterCreate populate/total failed', e);
    }
  },

  async afterUpdate(event: AfterEvent) {
    let order: any = event.result;

    try {
      order = asAny(await strapi.entityService.findOne('api::order.order', event.result.id, {
        populate: { Item: true },
      }));

      const items = Array.isArray(order?.Item) ? order.Item : [];
      const mustBe = calcTotal(items);

      if (Number(order?.total || 0) !== mustBe) {
        await strapi.entityService.update('api::order.order', order.id, { data: { total: mustBe } });
        order.total = mustBe;
        strapi.log.info('[ORDER] afterUpdate fixed total to', mustBe);
      }
    } catch (e) {
      strapi.log.error('[ORDER] afterUpdate total fix failed', e);
    }

    // только при paid и если письмо ещё не отправляли
    try {
      if (order.orderStatus === 'paid' && !order.emailSentAt) {
        await sendBothEmails(order);
      } else {
        strapi.log.info(`[ORDER] email skip for ${order.orderNumber} (status=${order.orderStatus}, emailSentAt=${order.emailSentAt || '-'})`);
      }
    } catch (e) {
      strapi.log.error('[EMAIL] send failed', e);
    }

    event.result = order;
  },
};
