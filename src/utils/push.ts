// src/utils/push.ts
type ExpoMessage = {
  to: string;
  title?: string;
  body?: string;
  data?: Record<string, any>;
  sound?: 'default' | null;
  priority?: 'default' | 'normal' | 'high';
  ttl?: number;
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export async function sendExpoPush(messages: ExpoMessage[]) {
  if (!messages?.length) return { ok: true, sent: 0 };
  // Expo принимает пачки до ~100
  const chunks: ExpoMessage[][] = [];
  for (let i = 0; i < messages.length; i += 100) {
    chunks.push(messages.slice(i, i + 100));
  }
  let sent = 0;
  for (const chunk of chunks) {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(chunk),
    });
    // можно добавить обработку receipts при желании
    await res.text().catch(() => null);
    sent += chunk.length;
  }
  return { ok: true, sent };
}
