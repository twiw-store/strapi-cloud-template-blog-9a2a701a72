import type { Core } from '@strapi/strapi';
import getRawBody from 'raw-body';
import { Readable } from 'stream';

const rawBodyMiddleware: Core.MiddlewareFactory = () => {
  return async (ctx, next) => {
    if (ctx.request.path.startsWith('/api/cloudpayments')) {
      if ((ctx.request as any).rawBody == null) {
        // 1) читаем сырой body (строкой)
        const raw = await getRawBody(ctx.req, {
          length: ctx.request.length,
          limit: '2mb',
          encoding: true,
        });

        // 2) сохраняем rawBody для HMAC
        (ctx.request as any).rawBody = raw;

        // 3) ВАЖНО: восстанавливаем stream, чтобы strapi::body смог прочитать его снова
        const rebuilt = new Readable();
        rebuilt.push(raw);
        rebuilt.push(null);

        (ctx as any).req = rebuilt;
        (ctx.request as any).req = rebuilt;
      }
    }

    await next();
  };
};

export default rawBodyMiddleware;
