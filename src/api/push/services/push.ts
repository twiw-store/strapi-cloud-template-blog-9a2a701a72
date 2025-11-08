import { Expo, ExpoPushMessage } from 'expo-server-sdk';
const expo = new Expo();

type Target =
  | { tokens: string[] }
  | { userIds: (number | string)[] }
  | { segment?: { country?: string[]; lang?: string[]; tags?: string[]; marketing?: boolean } };

type PushPayload = {
  title: string;
  body: string;
  data?: Record<string, any>;
  sound?: 'default' | null;  // <- корректный тип звука для Expo
  ttlSeconds?: number;
};

async function resolveTokens(target: Target): Promise<string[]> {
  const repo = strapi.db.query('api::push-device.push-device');

  if ('tokens' in target) return target.tokens;

  if ('userIds' in target) {
    const rows = await repo.findMany({
      where: { user: { id: { $in: target.userIds } }, marketingOptIn: true },
      select: ['token'],
    });
    return rows.map((r: any) => r.token);
  }

  const where: any = {};
  if (target.segment?.marketing !== undefined) where.marketingOptIn = target.segment.marketing;
  if (target.segment?.country?.length) where.country = { $in: target.segment.country };
  if (target.segment?.lang?.length) where.lang = { $in: target.segment.lang };
  if (target.segment?.tags?.length) where.tags = { $contains: target.segment.tags };

  const rows = await repo.findMany({ where, select: ['token'] });
  return rows.map((r: any) => r.token);
}

export async function sendPush(target: Target, payload: PushPayload) {
  const tokens = (await resolveTokens(target)).filter(t => Expo.isExpoPushToken(t));
  if (!tokens.length) return { enqueued: 0, tickets: [] };

  // ЯВНО указываем тип сообщений
  const messages: ExpoPushMessage[] = tokens.map(token => ({
    to: token,
    title: payload.title,
    body: payload.body,
    data: payload.data ?? {},
    // Expo types: 'default' | null
    sound: payload.sound ?? null,
    ttl: payload.ttlSeconds ?? 3600,
    // Expo types: 'default' | 'normal' | 'high'
    priority: 'high',
    // при желании можно добавить channelId для Android:
    // channelId: 'default',
  }));

  const chunks = expo.chunkPushNotifications(messages);
  const tickets: any[] = [];
  for (const chunk of chunks) {
    const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
    tickets.push(...ticketChunk);
  }
  return { enqueued: tokens.length, tickets };
}

export default { sendPush };
