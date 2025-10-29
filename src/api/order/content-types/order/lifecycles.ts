// src/api/order/content-types/order/lifecycles.ts
import { randomUUID } from 'node:crypto';

type BeforeEvent = { params: { data: Record<string, any> } };
type AfterEvent = { result: any };
const asAny = (v: any) => v as any;

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

function fmtCurrency(amount: number, currency = 'RUB') {
  try {
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

function renderOrderEmailHtml(order: any) {
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
            <div style="font-size:12px; color:#6B7280">Количество: ${qty}</div>
          </div>
        </td>
        <td style="padding:12px 0; text-align:right; font-weight:600; color:#111827;">${fmtCurrency(lineTotal, order.currency || 'RUB')}</td>
      </tr>
    `;
  }).join('') || `<tr><td style="padding:12px 0; color:#6B7280">Позиции не найдены</td><td></td></tr>`;

  const address = [
    order?.country, order?.city, order?.street,
    order?.building && `д.${order.building}`,
    order?.apartment && `кв.${order.apartment}`,
    order?.zip
  ].filter(Boolean).join(', ');

  const total = Number(order?.total || 0);

  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>Заказ ${order.orderNumber}</title></head>
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
          <h1 style="margin:0 0 8px; font-size:20px; color:#111827;">Спасибо за заказ!</h1>
          <p style="margin:0; color:#374151; font-size:14px;">Мы приняли оплату и начали сборку. Ниже детали вашего заказа.</p>
        </td></tr>
        <tr><td style="padding:0 28px 8px; font-weight:600; font-size:14px; color:#111827;">Состав заказа</td></tr>
        <tr><td style="padding:0 28px 8px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${itemsHtml}</table>
        </td></tr>
        <tr><td style="padding:16px 28px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="color:#6B7280; font-size:14px;">Итого</td>
                <td align="right" style="font-weight:700; color:#111827; font-size:16px;">${fmtCurrency(total, order.currency || 'RUB')}</td>
            </tr>
          </table>
        </td></tr>
        <tr><td style="padding:8px 28px 20px;">
          <div style="background:#F9FAFB; border:1px solid #E5E7EB; border-radius:12px; padding:12px 14px;">
            <div style="font-weight:600; color:#111827; font-size:14px; margin-bottom:4px;">Доставка</div>
            <div style="color:#374151; font-size:14px;">${order?.deliveryMethod || 'курьер'}${address ? ` • ${address}` : ''}</div>
          </div>
        </td></tr>
        <tr><td style="padding:0 28px 24px; color:#6B7280; font-size:12px;">
          Вопросы по заказу? Пиши на <a href="mailto:${supportEmail}" style="color:#111827; text-decoration:none;">${supportEmail}</a>
          или заходи на <a href="${siteUrl}" style="color:#111827; text-decoration:none;">${siteUrl}</a>.
        </td></tr>
      </table>
      <div style="padding:16px; color:#9CA3AF; font-size:11px;">© ${new Date().getFullYear()} TWIW</div>
    </td></tr>
  </table>
</body></html>`;
}

async function sendBothEmails(order: any) {
  const emailSvc = strapi.plugin('email').service('email');

  const clientTo = normalizeEmail(order.customerEmail);
  const adminTo  = normalizeEmail(process.env.ORDER_NOTIFY_EMAIL || '');

  // клиенту HTML
  if (clientTo) {
    const html = renderOrderEmailHtml(order);
    const res1 = await emailSvc.send({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      replyTo: process.env.SMTP_REPLY_TO || process.env.SMTP_USER,
      to: clientTo,
      subject: `TWIW: заказ №${order.orderNumber} оплачен`,
      text: `Спасибо за покупку! Сумма: ${order.total} ${order.currency || 'RUB'}.`,
      html,
    });
    strapi.log.info(`[EMAIL→CLIENT] ok to=${clientTo} messageId=${res1?.messageId}`);
  } else {
    strapi.log.warn(`[EMAIL→CLIENT] пропуск: пустой customerEmail для ${order.orderNumber}`);
  }

  // админу текст
  if (adminTo) {
    const items = Array.isArray(order?.Item) ? order.Item : [];
    const lines = items.map((it: any) =>
      `• ${it?.name || it?.title || 'Товар'} × ${it?.quantity || 1} = ${fmtCurrency(Number(it?.price||0) * Number(it?.quantity||1), order.currency || 'RUB')}`
    ).join('\n');

    const res2 = await emailSvc.send({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: adminTo,
      subject: `Новый оплаченный заказ ${order.orderNumber}`,
      text: `Сумма: ${fmtCurrency(Number(order.total||0), order.currency||'RUB')}\nКлиент: ${order.customerEmail}\nДоставка: ${order.deliveryMethod || '-'}\n${lines}`,
    });
    strapi.log.info(`[EMAIL→ADMIN] ok to=${adminTo} messageId=${res2?.messageId}`);
  } else {
    strapi.log.warn('[EMAIL→ADMIN] пропуск: ORDER_NOTIFY_EMAIL не задан');
  }

  await strapi.entityService.update('api::order.order', order.id, {
    data: { emailSentAt: new Date() },
  });
  strapi.log.info(`[ORDER] email marked sent for ${order.orderNumber}`);
}

export default {
  async beforeCreate(event: BeforeEvent) {
    const { data } = event.params;
    console.log('[ORDER] beforeCreate incoming =', JSON.stringify(data));

    if (!data.orderNumber || data.orderNumber === '-' || data.orderNumber === '') {
      data.orderNumber = makeOrderNumber();
      console.log('[ORDER] beforeCreate SET orderNumber =', data.orderNumber);
    }
    if (!data.orderStatus) data.orderStatus = 'pending';

    const items = Array.isArray(data.Item)
      ? data.Item
      : Array.isArray(data.items)
      ? data.items
      : [];

    if (items.length) {
      const total = calcTotal(items);
      data.total = total;
      console.log('[ORDER] beforeCreate calc total =', total);
    }
  },

  async beforeUpdate(event: BeforeEvent) {
    const { data } = event.params;
    if (!data) return;

    if (!data.orderNumber || data.orderNumber === '-' || data.orderNumber === '') {
      data.orderNumber = makeOrderNumber();
      console.log('[ORDER] beforeUpdate SET orderNumber =', data.orderNumber);
    }

    const items = Array.isArray(data.Item)
      ? data.Item
      : Array.isArray(data.items)
      ? data.items
      : [];

    if (items.length) {
      const total = calcTotal(items);
      data.total = total;
      console.log('[ORDER] beforeUpdate calc total =', total);
    }
  },

  async afterCreate(event: AfterEvent) {
    const { result } = event;
    console.log('[ORDER] afterCreate result id/num/total =', result?.id, result?.orderNumber, result?.total);

    try {
      const order = asAny(await strapi.entityService.findOne('api::order.order', result.id, {
        populate: { Item: true },
      }));

      const items = Array.isArray(order?.Item) ? order.Item : [];
      const mustBe = calcTotal(items);

      if (Number(order?.total || 0) !== mustBe) {
        await strapi.entityService.update('api::order.order', order.id, { data: { total: mustBe } });
        order.total = mustBe;
        console.log('[ORDER] afterCreate FIXED total to', mustBe);
      }

      // не отправляем письма здесь
      event.result = order;
    } catch (e) {
      console.error('[ORDER] afterCreate populate/total failed', e);
    }
  },

  async afterUpdate(event: AfterEvent) {
    let order: any;
    try {
      order = asAny(await strapi.entityService.findOne('api::order.order', event.result.id, {
        populate: { Item: true },
      }));

      const items = Array.isArray(order?.Item) ? order.Item : [];
      const mustBe = calcTotal(items);

      if (Number(order?.total || 0) !== mustBe) {
        await strapi.entityService.update('api::order.order', order.id, { data: { total: mustBe } });
        order.total = mustBe;
        console.log('[ORDER] afterUpdate FIXED total to', mustBe);
      }
    } catch (e) {
      console.error('[ORDER] afterUpdate total fix failed', e);
      order = event.result;
    }

    try {
      if (order.orderStatus === 'paid' && !order.emailSentAt) {
        await sendBothEmails(order);
      } else {
        console.log(`[ORDER] email skip for ${order.orderNumber} (status=${order.orderStatus}, emailSentAt=${order.emailSentAt})`);
      }
    } catch (e) {
      strapi.log.error('[EMAIL] send failed', e);
    }

    event.result = order;
  },
};
