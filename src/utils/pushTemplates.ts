// src/utils/pushTemplates.ts
type Lang = 'ru' | 'en' | 'fr' | 'es';

const Fallback: Lang = 'en';

const T = {
  order_created: {
    ru: { title: 'Заказ принят', body: (n: string) => `Ваш заказ №${n} оформлен. Мы уже собираем его.` },
    en: { title: 'Order received', body: (n: string) => `Your order #${n} has been placed.` },
    fr: { title: 'Commande reçue', body: (n: string) => `Votre commande n°${n} a été passée.` },
    es: { title: 'Pedido recibido', body: (n: string) => `Tu pedido #${n} ha sido realizado.` },
  },
  order_paid: {
    ru: { title: 'Оплата подтверждена', body: (n: string) => `Оплата заказа №${n} прошла успешно.` },
    en: { title: 'Payment confirmed', body: (n: string) => `Order #${n} payment confirmed.` },
    fr: { title: 'Paiement confirmé', body: (n: string) => `Paiement de la commande n°${n} confirmé.` },
    es: { title: 'Pago confirmado', body: (n: string) => `Pago del pedido #${n} confirmado.` },
  },
  order_shipped: {
    ru: { title: 'Заказ отправлен', body: (n: string) => `Заказ №${n} передан службе доставки.` },
    en: { title: 'Order shipped', body: (n: string) => `Order #${n} has been shipped.` },
    fr: { title: 'Commande expédiée', body: (n: string) => `La commande n°${n} a été expédiée.` },
    es: { title: 'Pedido enviado', body: (n: string) => `El pedido #${n} ha sido enviado.` },
  },
  order_delivered: {
    ru: { title: 'Заказ доставлен', body: (n: string) => `Заказ №${n} доставлен. Спасибо, что с TWIW.` },
    en: { title: 'Delivered', body: (n: string) => `Order #${n} has been delivered.` },
    fr: { title: 'Livré', body: (n: string) => `La commande n°${n} a été livrée.` },
    es: { title: 'Entregado', body: (n: string) => `El pedido #${n} ha sido entregado.` },
  },
} as const;

export function orderMsg(kind: keyof typeof T, lang?: string, orderNumber?: string) {
  const L = (lang?.toLowerCase() as Lang) || Fallback;
  const dict = T[kind][T[kind][L] ? L : Fallback];
  const title = dict.title;
  const body = dict.body(orderNumber || '');
  return { title, body };
}
