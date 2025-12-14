import type { Core } from '@strapi/strapi';
import { PassThrough } from 'stream';

const rawBodyMiddleware: Core.MiddlewareFactory = () => {
  return async (ctx, next) => {
    // только CloudPayments
    if (!ctx.request.path.startsWith('/api/cloudpayments')) {
      await next();
      return;
    }

    // если уже есть rawBody — не трогаем
    if ((ctx.request as any).rawBody != null) {
      await next();
      return;
    }

    const req = ctx.req; // это IncomingMessage (важно сохранить его свойства)

    const tee = new PassThrough();
    const chunks: Buffer[] = [];

    req.on('data', (chunk: any) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    req.on('end', () => {
      (ctx.request as any).rawBody = Buffer.concat(chunks).toString('utf8');
    });

    // прокидываем оригинальный поток в tee
    req.pipe(tee);

    // 🔥 КЛЮЧ: сохраняем свойства оригинального req, чтобы cors/koa не падали
    (tee as any).headers = req.headers;
    (tee as any).method = req.method;
    (tee as any).url = req.url;
    (tee as any).socket = req.socket;

    // подменяем req на tee (но tee выглядит как req для Koa)
    (ctx as any).req = tee;
    (ctx.request as any).req = tee;

    await next();
  };
};

export default rawBodyMiddleware;
