// src/api/order/content-types/order/lifecycles.ts
import { randomUUID } from 'node:crypto';

type BeforeEvent = { params: { data: Record<string, any>; where?: any } };
type AfterEvent = { result: any; params?: any };
const asAny = (v: any) => v as any;

const ALLOWED_STATUS = new Set(['pending', 'paid', 'shipped', 'delivered', 'cancelled']);
const ALLOWED_LANG = new Set(['ru', 'en', 'fr', 'es'] as const);

// Версия шаблона для писем (для кэш-бастинга)
const TEMPLATE_VERSION = process.env.EMAIL_TEMPLATE_VERSION || '2025-10-31.1';

// ========== БАЗОВЫЕ УТИЛИТЫ ==========

function makeOrderNumber() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `TWIW-${y}${m}${day}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

// calcTotal уважает и it.total (если фронт уже посчитал), и price*quantity
function calcTotal(items: any[] = []) {
  const val = items.reduce((sum, it) => {
    if (it && it.total != null && it.total !== '') {
      const line = Number(it.total);
      if (Number.isFinite(line)) return sum + line;
    }

    const price = Number(it?.price || 0);
    const qty = Number(it?.quantity || 0);
    const line = price * qty;
    if (!Number.isFinite(line)) return sum;
    return sum + line;
  }, 0);

  return Math.round(Number.isFinite(val) ? val : 0);
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
  if (!s) return undefined;
  const base = s.split(/[-_]/)[0]; // ru-RU → ru
  if (ALLOWED_LANG.has(base as any)) return base as 'ru' | 'en' | 'fr' | 'es';
  if (ALLOWED_LANG.has(s as any)) return s as 'ru' | 'en' | 'fr' | 'es';
  return undefined;
}

function fmtCurrency(amount: number, currency = 'RUB', lang: 'ru' | 'en' | 'fr' | 'es' = 'ru') {
  const locales: Record<typeof lang, string> = {
    ru: 'ru-RU',
    en: 'en-US',
    fr: 'fr-FR',
    es: 'es-ES',
  };
  try {
    return new Intl.NumberFormat(locales[lang], { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

// ✅ язык / валюта — аккуратная логика, БЕЗ жёстких RU/RUB по умолчанию
async function fillLangAndCurrencyFromProfile(data: any) {
  // 1. Пытаемся достать язык из разных полей
  const langFromPayload =
    data.language ||
    data.lang ||
    data.locale ||
    (data.customer && (data.customer.language || data.customer.lang || data.customer.locale));

  const normalizedLang = normalizeLang(langFromPayload);
  if (normalizedLang) {
    data.language = normalizedLang;
  }

  // 2. Пытаемся достать валюту из разных полей
  const currencyFromPayload =
    data.currency ||
    data.selectedCurrency ||
    data.currencyCode ||
    (data.customer && (data.customer.currency || data.customerCurrency || data.customer.selectedCurrency));

  if (currencyFromPayload) {
    data.currency = String(currencyFromPayload).toUpperCase().slice(0, 3);
  }

  // 3. Если всё ещё нет языка/валюты — пробуем взять из пользователя
  try {
    let userId: string | number | undefined;
    if (typeof data.user === 'number' || typeof data.user === 'string') {
      userId = data.user;
    } else if (data?.user?.id) {
      userId = data.user.id;
    } else if (Array.isArray(data?.user?.connect) && data.user.connect[0]?.id) {
      userId = data.user.connect[0].id;
    }

    if (userId) {
      const user = await strapi.entityService.findOne('plugin::users-permissions.user', Number(userId));
      const u = user as any;

      if (!data.language && u?.language) {
        const fromUserLang = normalizeLang(u.language);
        if (fromUserLang) data.language = fromUserLang;
      }
      if (!data.currency && u?.currency) {
        data.currency = String(u.currency).toUpperCase().slice(0, 3);
      }
      if (!data.customerEmail && u?.email) {
        data.customerEmail = u.email.toLowerCase();
      }
    }
  } catch (e) {
    strapi.log.warn('[ORDER] cannot resolve user lang/currency');
  }

  strapi.log.info(
    `[ORDER] fillLangAndCurrencyFromProfile → language=${data.language || '-'}, currency=${data.currency || '-'}`
  );
}

// ✅ СИНХРОНИЗАЦИЯ paymentStatus ↔ orderStatus (чтобы CP "paid" не оставлял orderStatus=pending)
function syncPaidStatuses(data: any) {
  // если пришёл paymentStatus — он "истина"
  if ('paymentStatus' in data) {
    const ps = String(data.paymentStatus || '').trim().toLowerCase();
    if (ps === 'paid') data.orderStatus = 'paid';
    if (ps === 'failed') {
      // не меняем orderStatus на failed (его нет в ALLOWED_STATUS), оставляем как есть
    }
  }

  // если пришёл orderStatus — нормализуем и проталкиваем в paymentStatus
  if ('orderStatus' in data) {
    const os = toStatusCode(data.orderStatus);
    data.orderStatus = os;
    if (os === 'paid') data.paymentStatus = 'paid';
  }
}

// ========== EMAIL HTML ==========

function renderOrderEmailHtml(order: any) {
  const lang = normalizeLang(order?.language) || 'ru';
  const t = {
    ru: {
      thanks: 'Спасибо за заказ!',
      intro: 'Мы приняли оплату и начали сборку. Ниже детали вашего заказа.',
      items: 'Состав заказа',
      qty: 'Количество',
      total: 'Итого',
      delivery: 'Доставка',
      questions: 'Вопросы по заказу?',
      subscribe: 'Подпишитесь на канал, чтобы не пропустить новости.',
    },
    en: {
      thanks: 'Thank you for your order!',
      intro: 'We received your payment and started preparing your order. Details below.',
      items: 'Order items',
      qty: 'Qty',
      total: 'Total',
      delivery: 'Delivery',
      questions: 'Questions about your order?',
      subscribe: 'Subscribe to our channel to never miss updates.',
    },
    fr: {
      thanks: 'Merci pour votre commande !',
      intro: 'Nous avons reçu votre paiement et préparons votre commande. Détails ci-dessous.',
      items: 'Articles de la commande',
      qty: 'Qté',
      total: 'Total',
      delivery: 'Livraison',
      questions: 'Des questions sur votre commande ?',
      subscribe: 'Abonnez-vous pour ne rien manquer.',
    },
    es: {
      thanks: '¡Gracias por tu pedido!',
      intro: 'Hemos recibido tu pago y empezamos a preparar tu pedido. Detalles abajo.',
      items: 'Artículos del pedido',
      qty: 'Cant.',
      total: 'Total',
      delivery: 'Entrega',
      questions: '¿Preguntas sobre tu pedido?',
      subscribe: 'Suscríbete para no perderte ninguna novedad.',
    },
  }[lang];

  const logo = process.env.BRAND_LOGO_URL || 'https://via.placeholder.com/120x32?text=TWIW';
  const siteUrl = process.env.SITE_URL || 'https://twiw.store';
  const supportEmail = process.env.ORDER_PUBLIC_CONTACT || 'support@twiw.store';
  const items: any[] = Array.isArray(order?.Item) ? order.Item : [];

  const itemsHtml =
    items
      .map((it) => {
        const name = it?.name || it?.title || 'Товар';
        const qty = Number(it?.quantity || it?.qty || 1);
        const price = Number(it?.price || 0);
        const lineTotal = price * qty;
        const img = it?.imageUrl || it?.image || it?.images?.[0]?.url || '';
        const variant = [it?.size, it?.color].filter(Boolean).join(' • ');
        return `
        <tr>
          <td style="padding:14px 0; border-bottom:1px solid #F3F4F6;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="width:40px; vertical-align:top;">
                  ${
                    img
                      ? `<img src="${img}" width="40" height="60" style="display:block;border-radius:6px;object-fit:contain;" alt="">`
                      : ''
                  }
                </td>
                <td style="vertical-align:top; padding-right:8px;">
                  <div style="font-weight:600; font-size:14px; color:#111827; margin-bottom:4px;">${name}</div>
                  ${
                    variant
                      ? `<div style="font-size:12px; color:#6B7280; margin-bottom:2px;">${variant}</div>`
                      : ''
                  }
                  <div style="font-size:12px; color:#6B7280;">${t.qty}: ${qty}</div>
                </td>
                <td style="vertical-align:top; text-align:right; font-weight:600; color:#111827; white-space:nowrap;">
                  ${fmtCurrency(lineTotal, order.currency || 'RUB', lang)}
                </td>
              </tr>
            </table>
          </td>
        </tr>`;
      })
      .join('') || `<tr><td style="padding:12px 0; color:#6B7280">—</td></tr>`;

  const address = [
    order?.country,
    order?.city,
    order?.street,
    order?.building && `д.${order.building}`,
    order?.apartment && `кв.${order.apartment}`,
    order?.zip,
  ]
    .filter(Boolean)
    .join(', ');

  const total = Number(order?.total || 0);

  const preheader = {
    ru: 'Детали вашего заказа внутри',
    en: 'Your order details inside',
    fr: 'Détails de votre commande',
    es: 'Detalles de tu pedido',
  }[lang];

  return `<!doctype html>
<!-- TWIW Template v=${TEMPLATE_VERSION} -->
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <title>Order ${order.orderNumber}</title>
  <meta name="x-template-version" content="${TEMPLATE_VERSION}">
</head>
<body style="margin:0; background:#F9FAFB; font-family:ui-sans-serif,-apple-system,Segoe UI,Roboto,Helvetica,Arial;">
  <span style="display:none !important; visibility:hidden; opacity:0; color:transparent; height:0; width:0; overflow:hidden;">
    ${preheader}
  </span>
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:640px; background:#FFFFFF; border-radius:16px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,0.06)">
        <tr><td style="padding:24px 28px; border-bottom:1px solid #F3F4F6;">
          <table width="100%" role="presentation">
            <tr>
              <td><img src="${logo}" alt="TWIW" height="32" style="display:block"></td>
              <td align="right" style="font-size:12px; color:#6B7280;">№ ${order.orderNumber}</td>
            </tr>
          </table>
        </td></tr>

        <tr><td style="padding:24px 28px;">
          <h1 style="margin:0 0 10px; font-size:20px; color:#111827;">${t.thanks}</h1>
          <p style="margin:0; color:#374151; font-size:14px;">${t.intro}</p>
        </td></tr>

        <tr><td style="padding:0 28px 8px; font-weight:600; font-size:14px; color:#111827;">${t.items}</td></tr>
        <tr><td style="padding:0 28px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${itemsHtml}</table>
        </td></tr>

        <tr><td style="padding:16px 28px;">
          <table width="100%" role="presentation">
            <tr>
              <td style="color:#6B7280; font-size:14px;">${t.total}</td>
              <td align="right" style="font-weight:700; color:#111827; font-size:16px;">
                ${fmtCurrency(total, order.currency || 'RUB', lang)}
              </td>
            </tr>
          </table>
        </td></tr>

        <tr><td style="padding:10px 48px 18px;">
          <div style="background:#F9FAFB; border:1px solid #E5E7EB; border-radius:10px; padding:10px 12px;">
            <div style="font-weight:600; color:#111827; font-size:14px; margin-bottom:4px;">${t.delivery}</div>
            <div style="color:#374151; font-size:14px;">${order?.deliveryMethod || 'courier'}${
              address ? ` • ${address}` : ''
            }</div>
          </div>
        </td></tr>

        <tr><td style="padding:0 28px 14px; color:#6B7280; font-size:12px;">
          ${t.questions} <a href="mailto:${supportEmail}" style="color:#111827; text-decoration:none;">${supportEmail}</a>
          • <a href="${siteUrl}" style="color:#111827; text-decoration:none;">${siteUrl}</a>.
        </td></tr>

        <tr><td style="padding:0 28px 24px; color:#9CA3AF; font-size:12px;">
          ${t.subscribe}
        </td></tr>
      </table>
      <div style="padding:16px; color:#9CA3AF; font-size:11px;">© ${new Date().getFullYear()} TWIW</div>
    </td></tr>
  </table>
</body>
</html>`;
}

async function sendBothEmails(order: any) {
  const plugin = strapi.plugin('email');
  if (!plugin) {
    strapi.log.warn('[EMAIL] email plugin not installed/configured');
    return;
  }
  const emailSvc = plugin.service('email');

  const clientTo = normalizeEmail(order.customerEmail);
  const adminTo = normalizeEmail(process.env.ORDER_NOTIFY_EMAIL || '');
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const replyTo = process.env.SMTP_REPLY_TO || from;

  const lang = normalizeLang(order?.language) || 'ru';
  const subjects = {
    ru: `TWIW: заказ №${order.orderNumber} оплачен`,
    en: `TWIW: order #${order.orderNumber} paid`,
    fr: `TWIW : commande n°${order.orderNumber} payée`,
    es: `TWIW: pedido nº${order.orderNumber} pagado`,
  } as const;

  // клиенту
  if (clientTo) {
    const html = renderOrderEmailHtml(order);
    const res1 = await emailSvc.send({
      from,
      replyTo,
      to: clientTo,
      subject: subjects[lang],
      text: `Спасибо за покупку! Сумма: ${fmtCurrency(
        Number(order.total || 0),
        order.currency || 'RUB',
        lang
      )}`,
      html,
    });
    strapi.log.info(`[EMAIL→CLIENT] ok to=${clientTo} messageId=${(res1 as any)?.messageId ?? '-'}`);
  } else {
    strapi.log.warn(`[EMAIL→CLIENT] skip: empty customerEmail for ${order.orderNumber}`);
  }

  // админу
  if (adminTo) {
    const items = Array.isArray(order?.Item) ? order.Item : [];
    const lines = items
      .map(
        (it: any) =>
          `• ${it?.name || it?.title || 'Товар'} × ${Number(it?.quantity || 1)} = ${fmtCurrency(
            Number(it?.price || 0) * Number(it?.quantity || 1),
            order.currency || 'RUB',
            lang
          )}`
      )
      .join('\n');

    const res2 = await emailSvc.send({
      from,
      to: adminTo,
      subject: `Новый оплаченный заказ ${order.orderNumber}`,
      text:
        `Сумма: ${fmtCurrency(Number(order.total || 0), order.currency || 'RUB', lang)}\n` +
        `Клиент: ${order.customerEmail}\n` +
        `Доставка: ${order.deliveryMethod || '-'}\n` +
        `${lines}`,
    });
    strapi.log.info(`[EMAIL→ADMIN] ok to=${adminTo} messageId=${(res2 as any)?.messageId ?? '-'}`);
  } else {
    strapi.log.warn('[EMAIL→ADMIN] skip: ORDER_NOTIFY_EMAIL not set');
  }

  // помечаем, что письмо отправлено
  try {
    await strapi.entityService.update('api::order.order', order.id, {
      data: { emailSentAt: new Date() },
    });
    strapi.log.info(`[ORDER] email marked sent for ${order.orderNumber}`);
  } catch (e) {
    strapi.log.error('[ORDER] failed to mark emailSentAt', e);
  }
}

// ========== LIFECYCLES ==========

export default {
  async beforeCreate(event: BeforeEvent) {
    strapi.log.info('[ORDER] beforeCreate fired');
    const { data } = event.params;
    if (!data) return;

    await fillLangAndCurrencyFromProfile(data);

    // ✅ синхрон статусов до нормализации
    syncPaidStatuses(data);

    // ✅ нормализуем orderStatus, но paymentStatus уже мог протолкнуть paid
    if ('orderStatus' in data) data.orderStatus = toStatusCode(data.orderStatus);
    if (!data.orderNumber) data.orderNumber = makeOrderNumber();

    const items = Array.isArray(data.Item) ? data.Item : Array.isArray(data.items) ? data.items : [];

    if (items.length) {
      items.forEach((i) => {
        i.price = Number(i.price) || 0;
        i.quantity = Number(i.quantity) || 0;
      });
      data.total = calcTotal(items);
    }
  },

  async beforeUpdate(event: BeforeEvent) {
    strapi.log.info('[ORDER] beforeUpdate fired');
    const { data, where } = event.params;
    if (!data) return;

    const id = Number(where?.id || (data as any)?.id);
    if (id) {
      try {
        const prev = await strapi.entityService.findOne('api::order.order', id, {
          fields: ['orderStatus'],
        });
        if (prev?.orderStatus) (data as any)._prevStatus = String(prev.orderStatus);
      } catch {}
    }

    await fillLangAndCurrencyFromProfile(data);

    // ✅ синхронизация paymentStatus ↔ orderStatus (главный фикс)
    syncPaidStatuses(data);

    if ('orderStatus' in data) data.orderStatus = toStatusCode(data.orderStatus);
    if (!data.orderNumber) data.orderNumber = makeOrderNumber();

    const items = Array.isArray((data as any).Item) ? (data as any).Item : Array.isArray((data as any).items) ? (data as any).items : [];

    if (items.length) {
      items.forEach((i) => {
        i.price = Number(i.price) || 0;
        i.quantity = Number(i.quantity) || 0;
      });
      (data as any).total = calcTotal(items);
    }
  },

  async afterCreate(event: AfterEvent) {
    strapi.log.info('[ORDER] afterCreate fired');
    try {
      const order = asAny(
        await strapi.entityService.findOne('api::order.order', event.result.id, {
          populate: { Item: true },
        })
      );

      const items = Array.isArray(order?.Item) ? order.Item : [];
      const mustBe = calcTotal(items);

      if (Number(order?.total || 0) !== mustBe) {
        await strapi.entityService.update('api::order.order', order.id, {
          data: { total: mustBe },
        });
        order.total = mustBe;
        strapi.log.info('[ORDER] afterCreate fixed total to ' + mustBe);
      }

      event.result = order;
    } catch (e) {
      strapi.log.error('[ORDER] afterCreate failed', e);
    }
  },

  async afterUpdate(event: AfterEvent) {
    strapi.log.info('[ORDER] afterUpdate fired');
    let order: any;

    try {
      order = asAny(
        await strapi.entityService.findOne('api::order.order', event.result.id, {
          populate: { Item: true },
        })
      );

      const items = Array.isArray(order?.Item) ? order.Item : [];
      const mustBe = calcTotal(items);

      if (Number(order?.total || 0) !== mustBe) {
        await strapi.entityService.update('api::order.order', order.id, {
          data: { total: mustBe },
        });
        order.total = mustBe;
        strapi.log.info('[ORDER] afterUpdate fixed total to ' + mustBe);
      }
    } catch (e) {
      strapi.log.error('[ORDER] afterUpdate failed', e);
      order = event.result;
    }

    // ✉️ ПИСЬМО: когда ОПЛАЧЕНО (по любому из статусов) и email ещё не отправляли
    try {
      const paid = order?.paymentStatus === 'paid' || order?.orderStatus === 'paid';
      if (paid && !order.emailSentAt) {
        await sendBothEmails(order);
      } else {
        strapi.log.info(
          `[ORDER] email skip for ${order.orderNumber} (paymentStatus=${order.paymentStatus || '-'}, orderStatus=${
            order.orderStatus || '-'
          }, emailSentAt=${order.emailSentAt || '-'})`
        );
      }
    } catch (e) {
      strapi.log.error('[EMAIL] send failed', e);
    }

    event.result = order;
  },
};
