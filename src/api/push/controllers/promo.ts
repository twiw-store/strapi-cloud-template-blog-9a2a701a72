// src/api/push/controllers/promo.ts
import type { Context } from 'koa';
import type { ExpoPushMessage } from 'expo-server-sdk';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

function chunk<T>(arr: T[], size = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export default {
  async send(ctx: Context) {
    const body = ctx.request.body as {
      title?: string;
      body?: string;
      data?: Record<string, any>;
      tokens?: string[];
      userIds?: (string | number)[];
      tags?: string[];
      ttl?: number;
      priority?: 'default' | 'normal' | 'high';
    };

    const title = body.title ?? 'TWIW';
    const messageBody = body.body ?? '';
    const data = body.data ?? {};
    const ttl = Number.isFinite(body.ttl) ? Number(body.ttl) : 60 * 60 * 24 * 7; // 7 дней
    const priority = body.priority ?? 'high';

    let tokens: string[] = Array.isArray(body.tokens) ? body.tokens.slice() : [];

    // Если пришли userIds — подтянем их токены из push-device
    if (Array.isArray(body.userIds) && body.userIds.length > 0) {
      try {
        const rows = await strapi.db.query('api::push-device.push-device').findMany({
          where: { userId: { $in: body.userIds.map(String) } },
          select: ['token'],
          limit: 5000,
        });
        tokens.push(
          ...rows
            .map((r: any) => r?.token)
            .filter((t: any) => typeof t === 'string' && t.startsWith('ExponentPushToken[')),
        );
      } catch (e) {
        strapi.log.warn('[PUSH][promo] failed to fetch tokens by userIds');
      }
    }

    // Фильтр по тегам (если нужно)
    if (Array.isArray(body.tags) && body.tags.length > 0) {
      try {
        const rows = await strapi.db.query('api::push-device.push-device').findMany({
          where: { tags: { $containsi: body.tags } },
          select: ['token'],
          limit: 5000,
        });
        tokens.push(
          ...rows
            .map((r: any) => r?.token)
            .filter((t: any) => typeof t === 'string' && t.startsWith('ExponentPushToken[')),
        );
      } catch (e) {
        strapi.log.warn('[PUSH][promo] failed to fetch tokens by tags');
      }
    }

    // Дедуп токенов
    tokens = Array.from(new Set(tokens)).filter(t => t && t.startsWith('ExponentPushToken['));

    if (tokens.length === 0) {
      ctx.send({ ok: true, sent: 0, detail: 'no tokens' });
      return;
    }

    // ВАЖНО: тип должен быть ExpoPushMessage, а литералы — через 'as const'
    const messages: ExpoPushMessage[] = tokens.map((to) => ({
      to,
      title,
      body: messageBody,
      data,
      sound: 'default' as const,   // <-- фикс: литерал, не string
      priority: priority as 'default' | 'normal' | 'high', // безопасное приведение
      ttl,
    }));

    let sent = 0;
    const chunks = chunk(messages, 100);
    for (const c of chunks) {
      try {
        const res = await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(c),
        });
        // ответ не типизируем — нам важно только не уронить процесс
        await res.text().catch(() => null);
        sent += c.length;
      } catch (e) {
        strapi.log.error('[PUSH][promo] send chunk failed', e);
      }
    }

    ctx.send({ ok: true, sent, tokens: tokens.length });
  },
};
