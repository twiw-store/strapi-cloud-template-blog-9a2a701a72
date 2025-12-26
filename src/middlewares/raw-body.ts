import type { Core } from '@strapi/strapi';
import { Readable } from 'stream';

const rawBodyMiddleware: Core.MiddlewareFactory = () => {
  return async (ctx, next) => {
    // Только CloudPayments endpoints
    if (!ctx.request.path.startsWith('/api/cloudpayments')) {
      return next();
    }

    // Уже есть rawBody — не трогаем
    if ((ctx.request as any).rawBody != null) {
      return next();
    }

    const req = ctx.req;

    // Считываем тело ПОЛНОСТЬЮ до next()
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const buf = Buffer.concat(chunks);
    const raw = buf.toString('utf8');

    (ctx.request as any).rawBody = raw;

    // ВАЖНО forcing: даём Strapi body-parser новый поток
    const cloned = Readable.from(buf);

    // Прокидываем обязательные поля, чтобы Koa/Strapi не ломались
    (cloned as any).headers = req.headers;
    (cloned as any).method = req.method;
    (cloned as any).url = req.url;
    (cloned as any).socket = req.socket;

    // Обновим content-length (часто критично)
    (cloned as any).headers = {
      ...(req.headers || {}),
      'content-length': String(buf.length),
    };

    (ctx as any).req = cloned;
    (ctx.request as any).req = cloned;

    return next();
  };
};

export default rawBodyMiddleware;
