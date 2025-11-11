// src/api/order/content-types/order/lifecycles.ts
import { randomUUID } from 'node:crypto';

type BeforeEvent = { params: { data: Record<string, any>; where?: any } };
type AfterEvent  = { result: any; params?: any };
const asAny = (v: any) => v as any;

const ALLOWED_STATUS = new Set(['pending', 'paid', 'shipped', 'delivered', 'cancelled']);
const ALLOWED_LANG   = new Set(['ru', 'en', 'fr', 'es'] as const);

// Версия шаблона для кэш-бастинга писем
const TEMPLATE_VERSION = process.env.EMAIL_TEMPLATE_VERSION || '2025-10-31.1';

// ─────────────── utils: номера, суммы, нормализация ───────────────
function makeOrderNumber() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `TWIW-${y}${m}${day}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

// ➜ Надёжный парсер суммы с поддержкой разных полей
function toNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function getQty(it: any) {
  const q = toNum(it?.quantity ?? it?.qty ?? 1);
  return q > 0 ? q : 1;
}
function getUnitPrice(it: any) {
  // price / unitPrice / finalPrice / currentPrice
  const direct =
    it?.price ??
    it?.unitPrice ??
    it?.finalPrice ??
    it?.currentPrice;

  if (direct !== undefined) return toNum(direct);

  // если есть только totalPrice на строку — делим на qty
  if (it?.totalPrice !== undefined) {
    const q  = getQty(it);
    const tp = toNum(it.totalPrice);
    return q ? tp / q : tp;
  }
  return 0;
}
function calcTotal(items: any[] = []) {
  const sum = items.reduce((acc, it) => acc + getUnitPrice(it) * getQty(it), 0);
  return Math.round(sum);
}

function normalizeEmail(e?: string) {
  return typeof e === 'string' ? e.trim().toLowerCase() : '';
}
function toStatusCode(raw?: string) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (['оплачен', 'оплачено', 'payed', 'paid'].includes(s)) return 'paid';
  if (['в обработке', 'ожидает', 'pending', 'awaiting'].includes(s)) return 'pending';
  if (['отгружен', 'отправлен', 'shipped', 'sent'].includes(s)) return 'shipped';
  if (['доставлен', 'delivered'].includes(s)) return 'delivered';
  if (['отменен', 'отменён', 'cancelled', 'canceled'].includes(s)) return 'cancelled';
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

/**
 * Язык/валюта из payload → customer → user → дефолты
 */
async function fillLangAndCurrencyFromProfile(data: any) {
  if (data.language) data.language = normalizeLang(data.language);
  if (!data.language && data?.customer?.language) data.language = normalizeLang(data.customer.language);
  if (!data.currency && data?.customer?.currency) data.currency = String(data.customer.currency).toUpperCase();

  try {
    let userId: string | number | undefined;
    if (typeof data.user === 'number' || typeof data.user === 'string') userId = data.user;
    else if (data?.user?.id) userId = data.user.id;
    else if (Array.isArray(data?.user?.connect) && data.user.connect[0]?.id) userId = data.user.connect[0].id;

    if (userId) {
      const user = await strapi.entityService.findOne('plugin::users-permissions.user', Number(userId));
      const u = user as any;
      if (!data.language && typeof u?.language === 'string') data.language = normalizeLang(u.language);
      if (!data.currency && typeof u?.currency === 'string') data.currency = String(u.currency).toUpperCase();
      if (!data.customerEmail && typeof u?.email === 'string') data.customerEmail = normalizeEmail(u.email);
    }
  } catch {
    strapi.log.warn('[ORDER] cannot resolve user language/currency from profile');
  }

  if (!data.language) data.language = 'ru';
  if (!data.currency) data.currency = 'RUB';
}

// ─────────────── EMAIL HTML ───────────────
function renderOrderEmailHtml(order: any) {
  const lang = normalizeLang(order?.language);
  const t = {
    ru: { thanks: 'Спасибо за заказ!', intro: 'Мы приняли оплату и начали сборку. Ниже детали вашего заказа.', items: 'Состав заказа', qty: 'Количество', total: 'Итого', delivery: 'Доставка', questions: 'Вопросы по заказу?', subscribe: 'Подпишитесь на канал, чтобы не пропустить новости.' },
    en: { thanks: 'Thank you for your order!', intro: 'We received your payment and started preparing your order. Details below.', items: 'Order items', qty: 'Qty', total: 'Total', delivery: 'Delivery', questions: 'Questions about your order?', subscribe: 'Subscribe to our channel to never miss updates.' },
    fr: { thanks: 'Merci pour votre commande !', intro: 'Nous avons reçu votre paiement et préparons votre commande. Détails ci-dessous.', items: 'Articles de la commande', qty: 'Qté', total: 'Total', delivery: 'Livraison', questions: 'Des questions sur votre commande ?', subscribe: 'Abonnez-vous pour ne rien manquer.' },
    es: { thanks: '¡Gracias por tu pedido!', intro: 'Hemos recibido tu pago y empezamos a preparar tu pedido. Detalles abajo.', items: 'Artículos del pedido', qty: 'Cant.', total: 'Total', delivery: 'Entrega', questions: '¿Preguntas sobre tu pedido?', subscribe: 'Suscríbete para no perderte ninguna novedad.' },
  }[lang];

  const logo = process.env.BRAND_LOGO_URL || 'https://via.placeholder.com/120x32?text=TWIW';
  const siteUrl = process.env.SITE_URL || 'https://twiw.store';
  const supportEmail = process.env.ORDER_PUBLIC_CONTACT || 'support@twiw.store';
  const items: any[] = Array.isArray(order?.Item) ? order.Item : [];

  const itemsHtml =
    items.map((it) => {
      const name = it?.name || it?.title || 'Товар';
      const qty  = getQty(it);
      const price = getUnitPrice(it);
      const lineTotal = price * qty;
      const img = it?.imageUrl || it?.image || it?.images?.[0]?.url || '';
      const variant = [it?.size, it?.color].filter(Boolean).join(' • ');
      return `
        <tr>
          <td style="padding:14px 0; border-bottom:1px solid #F3F4F6;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="width:40px; vertical-align:top;">
                  ${img ? `<img src="${img}" width="40" height="60" style="display:block;border-radius:6px;object-fit:contain;" alt="">` : ''}
                </td>
                <td style="vertical-align:top; padding-right:8px;">
                  <div style="font-weight:600; font-size:14px; color:#111827; margin-bottom:4px;">${name}</div>
                  ${variant ? `<div style="font-size:12px; color:#6B7280; margin-bottom:2px;">${variant}</div>` : ''}
                  <div style="font-size:12px; color:#6B7280;">${t.qty}: ${qty}</div>
                </td>
                <td style="vertical-align:top; text-align:right; font-weight:600; color:#111827; white-space:nowrap;">
                  ${fmtCurrency(lineTotal, order.currency || 'RUB', lang)}
                </td>
              </tr>
            </table>
          </td>
        </tr>`;
    }).join('') || `<tr><td style="padding:12px 0; color:#6B7280">—</td></tr>`;

  const address = [order?.country, order?.city, order?.street, order?.building && `д.${order.building}`, order?.apartment && `кв.${order.apartment}`, order?.zip]
    .filter(Boolean).join(', ');

  const total = Number(order?.total || 0);

  const preheader = { ru: 'Детали вашего заказа внутри', en: 'Your order details inside', fr: 'Détails de votre commande', es: 'Detalles de tu pedido' }[lang];

  return `<!doctype html>
<!-- TWIW Template v=${TEMPLATE_VERSION} -->
<html lang="${lang}">
<head><meta charset="utf-8"><title>Order ${order.orderNumber}</title><meta name="x-template-version" content="${TEMPLATE_VERSION}"></head>
<body style="margin:0; background:#F9FAFB; font-family:ui-sans-serif,-apple-system,Segoe UI,Roboto,Helvetica,Arial;">
  <span style="display:none !important; visibility:hidden; opacity:0; color:transparent; height:0; width:0; overflow:hidden;">${preheader}</span>
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:640px; background:#FFFFFF; border-radius:16px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,0.06)">
        <tr><td style="padding:24px 28px; border-bottom:1px solid #F3F4F6;">
          <table width="100%" role="presentation"><tr>
            <td><img src="${logo}" alt="TWIW" height="32" style="display:block"></td>
            <td align="right" style="font-size:12px; color:#6B7280;">№ ${order.orderNumber}</td>
          </tr></table>
        </td></tr>

        <tr><td style="padding:24px 28px;">
          <h1 style="margin:0 0 10px; font-size:20px; color:#111827;">${t.thanks}</h1>
          <p style="margin:0; color:#374151; font-size:14px;">${t.intro}</p>
        </td></tr>

        <tr><td style="padding:0 28px 8px; font-weight:600; font-size:14px; color:#111827;">${t.items}</td></tr>
        <tr><td style="padding:0 28px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${itemsHtml}</table></td></tr>

        <tr><td style="padding:16px 28px;">
          <table width="100%" role="presentation"><tr>
            <td style="color:#6B7280; font-size:14px;">${t.total}</td>
            <td align="right" style="font-weight:700; color:#111827; font-size:16px;">${fmtCurrency(total, order.currency || 'RUB', lang)}</td>
          </tr></table>
        </td></tr>

        <tr><td style="padding:10px 48px 18px;">
          <div style="background:#F9FAFB; border:1px solid #E5E7EB; border-radius:10px; padding:10px 12px;">
            <div style="font-weight:600; color:#111827; font-size:14px; margin-bottom:4px;">Доставка</div>
            <div style="color:#374151; font-size:14px;">${order?.deliveryMethod || 'courier'}${address ? ` • ${address}` : ''}</div>
          </div>
        </td></tr>

        <tr><td style="padding:0 28px 14px; color:#6B7280; font-size:12px;">${t.questions} <a href="mailto:${supportEmail}" style="color:#111827; text-decoration:none;">${supportEmail}</a> • <a href="${siteUrl}" style="color:#111827; text-decoration:none;">${siteUrl}</a>.</td></tr>
        <tr><td style="padding:0 28px 24px; color:#9CA3AF; font-size:12px;">${t.subscribe}</td></tr>
      </table>
      <div style="padding:16px; color:#9CA3AF; font-size:11px;">© ${new Date().getFullYear()} TWIW</div>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─────────────── EMAIL send (клиент + админ) ───────────────
async function sendBothEmails(order: any) {
  const plugin = strapi.plugin('email');
  if (!plugin) { strapi.log.warn('[EMAIL] plugin not configured'); return; }
  const emailSvc = plugin.service('email');

  const clientTo = normalizeEmail(order.customerEmail);
  const adminTo  = normalizeEmail(process.env.ORDER_NOTIFY_EMAIL || '');
  const from     = process.env.SMTP_FROM || process.env.SMTP_USER;
  const replyTo  = process.env.SMTP_REPLY_TO || from;

  const lang = normalizeLang(order?.language);
  const subjects = {
    ru: `TWIW: заказ №${order.orderNumber} оплачен`,
    en: `TWIW: order #${order.orderNumber} paid`,
    fr: `TWIW : commande n°${order.orderNumber} payée`,
    es: `TWIW: pedido nº${order.orderNumber} pagado`,
  } as const;

  if (clientTo) {
    const html = renderOrderEmailHtml(order);
    const r = await emailSvc.send({
      from, replyTo, to: clientTo,
      subject: subjects[lang],
      text: `Спасибо за покупку! Сумма: ${fmtCurrency(Number(order.total||0), order.currency || 'RUB', lang)}`,
      html,
    });
    strapi.log.info(`[EMAIL→CLIENT] ok to=${clientTo} messageId=${r?.messageId ?? '-'}`);
  } else {
    strapi.log.warn(`[EMAIL→CLIENT] skip: empty customerEmail for ${order.orderNumber}`);
  }

  if (adminTo) {
    const items = Array.isArray(order?.Item) ? order.Item : [];
    const lines = items.map((it: any) =>
      `• ${it?.name || it?.title || 'Товар'} × ${getQty(it)} = ${fmtCurrency(getUnitPrice(it)*getQty(it), order.currency || 'RUB', lang)}`
    ).join('\n');

    const r2 = await emailSvc.send({
      from, to: adminTo,
      subject: `Новый оплаченный заказ ${order.orderNumber}`,
      text:
        `Сумма: ${fmtCurrency(Number(order.total||0), order.currency||'RUB', lang)}\n` +
        `Клиент: ${order.customerEmail}\n` +
        `Доставка: ${order.deliveryMethod || '-'}\n` +
        `${lines}`,
    });
    strapi.log.info(`[EMAIL→ADMIN] ok to=${adminTo} messageId=${r2?.messageId ?? '-'}`);
  } else {
    strapi.log.warn('[EMAIL→ADMIN] skip: ORDER_NOTIFY_EMAIL not set');
  }

  try {
    await strapi.entityService.update('api::order.order', order.id, { data: { emailSentAt: new Date() }});
  } catch (e) {
    strapi.log.error('[ORDER] failed to mark emailSentAt', e);
  }
}

// ─────────────── PUSH ───────────────
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
function pushOrderText(kind: 'created'|'paid'|'shipped'|'delivered', lang?: string, n?: string) {
  const L = (lang || 'en').toLowerCase();
  const pick = (d: any) => d[L] || d.en;
  const title = pick({
    ru: { created: 'Заказ принят', paid: 'Оплата подтверждена', shipped: 'Заказ отправлен', delivered: 'Заказ доставлен' },
    en: { created: 'Order received', paid: 'Payment confirmed', shipped: 'Order shipped', delivered: 'Delivered' },
    fr: { created: 'Commande reçue', paid: 'Paiement confirmé', shipped: 'Commande expédiée', delivered: 'Livré' },
    es: { created: 'Pedido recibido', paid: 'Pago confirmado', shipped: 'Pedido enviado', delivered: 'Entregado' },
  })[kind];
  const body = pick({
    ru: { created: (x: string) => `Ваш заказ №${x} оформлен. Мы уже собираем его.`, paid: (x: string) => `Оплата заказа №${x} прошла успешно.`, shipped: (x: string) => `Заказ №${x} передан службе доставки.`, delivered: (x: string) => `Заказ №${x} доставлен. Спасибо, что с TWIW.` },
    en: { created: (x: string) => `Your order #${x} has been placed.`, paid: (x: string) => `Order #${x} payment confirmed.`, shipped: (x: string) => `Order #${x} has been shipped.`, delivered: (x: string) => `Order #${x} has been delivered.` },
    fr: { created: (x: string) => `Votre commande n°${x} a été passée.`, paid: (x: string) => `Paiement de la commande n°${x} confirmé.`, shipped: (x: string) => `La commande n°${x} a été expédiée.`, delivered: (x: string) => `La commande n°${x} a été livrée.` },
    es: { created: (x: string) => `Tu pedido #${x} ha sido realizado.`, paid: (x: string) => `Pago del pedido #${x} confirmado.`, shipped: (x: string) => `El pedido #${x} ha sido enviado.`, delivered: (x: string) => `El pedido #${x} ha sido entregado.` },
  })[kind](n || '');
  return { title, body };
}
async function findUserDeviceTokens(userId?: number | string | null) {
  try {
    if (!userId) return [];
    const rows = await strapi.db.query('api::push-device.push-device').findMany({
      where: { userId: String(userId) },
      select: ['token', 'lang', 'marketingOptIn'],
      limit: 1000,
    });
    return (rows || [])
      .filter((r: any) => r?.token?.startsWith('ExponentPushToken['))
      .map((r: any) => ({ token: r.token, lang: r.lang || 'en' }));
  } catch {
    strapi.log.warn('[PUSH] table push-device not found or query failed');
    return [];
  }
}
async function sendPush(kind: 'created'|'paid'|'shipped'|'delivered', order: any) {
  const userId = order?.customer?.id || order?.user?.id || order?.userId || null;
  const lang = order?.language || order?.locale || 'en';
  const orderNumber = order?.orderNumber || String(order?.id);
  const devices = await findUserDeviceTokens(userId);
  if (!devices.length) return;

  const { title, body } = pushOrderText(kind, lang, orderNumber);
  const messages = devices.map(d => ({ to: d.token, title, body, data: { screen: 'OrderDetails', orderId: order?.id, orderNumber }, sound: 'default', priority: 'high', ttl: 3600 * 24 * 7 }));
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    try {
      const res = await fetch(EXPO_PUSH_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(chunk) });
      await res.text().catch(() => null);
    } catch (e) { strapi.log.error('[PUSH] send failed', e); }
  }
}

// ─────────────── LIFECYCLES ───────────────
export default {
  async beforeCreate(event: BeforeEvent) {
    const { data } = event.params;
    if (!data) return;

    strapi.log.info('[PROBE] keys=' + Object.keys(data).join(','));
  strapi.log.info('[PROBE] raw=' + JSON.stringify(data).slice(0, 1000));
  data.total = 999999;

    await fillLangAndCurrencyFromProfile(data);
    data.orderStatus = toStatusCode(data.orderStatus);

    if (!data.orderNumber || data.orderNumber === '-' || data.orderNumber === '') {
      data.orderNumber = makeOrderNumber();
    }

    const items = Array.isArray(data.Item) ? data.Item : Array.isArray(data.items) ? data.items : [];
    strapi.log.info('[ORDER][beforeCreate] incoming items = ' + JSON.stringify(items?.slice(0, 3)));
    if (items.length) {
      const total = calcTotal(items);
      data.total = total;
      strapi.log.info(`[ORDER][beforeCreate] total=${total}`);
    }
  },

  async beforeUpdate(event: BeforeEvent) {
    const { data, where } = event.params;
    if (!data) return;

    // сохранить предыдущий статус
    try {
      const id = Number(where?.id || data?.id);
      if (id) {
        const prev = await strapi.entityService.findOne('api::order.order', id, { fields: ['orderStatus'] });
        if (prev?.orderStatus) (data as any)._prevStatus = String(prev.orderStatus);
      }
    } catch {}

    await fillLangAndCurrencyFromProfile(data);
    if ('orderStatus' in data) data.orderStatus = toStatusCode(data.orderStatus);

    if (!data.orderNumber || data.orderNumber === '-' || data.orderNumber === '') {
      data.orderNumber = makeOrderNumber();
    }

    const items = Array.isArray(data.Item) ? data.Item : Array.isArray(data.items) ? data.items : [];
    strapi.log.info('[ORDER][beforeUpdate] incoming items = ' + JSON.stringify(items?.slice(0, 3)));
    if (items.length) {
      const total = calcTotal(items);
      data.total = total;
      strapi.log.info(`[ORDER][beforeUpdate] total=${total}`);
    }
  },

  async afterCreate(event: AfterEvent) {
    try {
      let order = asAny(await strapi.entityService.findOne('api::order.order', event.result.id, { populate: { Item: true, user: true, customer: true } }));
      const items  = Array.isArray(order?.Item) ? order.Item : [];
      const mustBe = calcTotal(items);

      if (Number(order?.total || 0) !== mustBe) {
        await strapi.entityService.update('api::order.order', order.id, { data: { total: mustBe } });
        order.total = mustBe;
        strapi.log.info('[ORDER] afterCreate fixed total to ' + mustBe);
      }

      try { await sendPush('created', order); } catch (e) { strapi.log.error('[PUSH] afterCreate failed', e); }

      event.result = order; // вернуть с populate
    } catch (e) {
      strapi.log.error('[ORDER] afterCreate populate/total failed', e);
    }
  },

  async afterUpdate(event: AfterEvent) {
    let order: any = event.result;
    let prevStatus: string | undefined;

    try {
      prevStatus = event?.params?.data?._prevStatus;

      order = asAny(await strapi.entityService.findOne('api::order.order', event.result.id, { populate: { Item: true, user: true, customer: true } }));
      const items  = Array.isArray(order?.Item) ? order.Item : [];
      const mustBe = calcTotal(items);

      if (Number(order?.total || 0) !== mustBe) {
        await strapi.entityService.update('api::order.order', order.id, { data: { total: mustBe } });
        order.total = mustBe;
        strapi.log.info('[ORDER] afterUpdate fixed total to ' + mustBe);
      }
    } catch (e) {
      strapi.log.error('[ORDER] afterUpdate total fix failed', e);
    }

    try {
      if (order.orderStatus === 'paid' && !order.emailSentAt) {
        await sendBothEmails(order);
      } else {
        strapi.log.info(`[ORDER] email skip for ${order.orderNumber} (status=${order.orderStatus}, emailSentAt=${order.emailSentAt || '-'})`);
      }
    } catch (e) { strapi.log.error('[EMAIL] send failed', e); }

    try {
      const next = String(order?.orderStatus || '');
      const prev = String(prevStatus || '');
      if (prev !== next) {
        if (next === 'paid')        await sendPush('paid', order);
        else if (next === 'shipped')   await sendPush('shipped', order);
        else if (next === 'delivered') await sendPush('delivered', order);
      }
    } catch (e) { strapi.log.error('[PUSH] afterUpdate failed', e); }

    event.result = order;
  },
};
