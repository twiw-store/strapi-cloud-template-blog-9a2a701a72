import type { Schema, Struct } from '@strapi/strapi';

export interface CheckoutOrderItem extends Struct.ComponentSchema {
  collectionName: 'components_checkout_order_items';
  info: {
    displayName: 'Item';
  };
  attributes: {
    colors: Schema.Attribute.String;
    images: Schema.Attribute.Media<
      'images' | 'files' | 'videos' | 'audios',
      true
    >;
    imageUrl: Schema.Attribute.String;
    price: Schema.Attribute.Decimal;
    productId: Schema.Attribute.String;
    productSlug: Schema.Attribute.String;
    quantity: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<1>;
    sizes: Schema.Attribute.String;
    title: Schema.Attribute.String;
  };
}

declare module '@strapi/strapi' {
  export module Public {
    export interface ComponentSchemas {
      'checkout.order-item': CheckoutOrderItem;
    }
  }
}
