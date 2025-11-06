import type { Schema, Struct } from '@strapi/strapi';

export interface CheckoutOrderItem extends Struct.ComponentSchema {
  collectionName: 'components_checkout_order_items';
  info: {
    displayName: 'Item';
  };
  attributes: {
    barcode: Schema.Attribute.String;
    colors: Schema.Attribute.String;
    externalCode: Schema.Attribute.String;
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
    sku: Schema.Attribute.String;
    title: Schema.Attribute.String;
  };
}

export interface ProductDimensions extends Struct.ComponentSchema {
  collectionName: 'components_product_dimensions';
  info: {
    description: '\u0413\u0430\u0431\u0430\u0440\u0438\u0442\u044B/\u0432\u0435\u0441';
    displayName: 'Dimensions';
  };
  attributes: {
    weightKg: Schema.Attribute.Decimal;
  };
}

export interface ProductVariant extends Struct.ComponentSchema {
  collectionName: 'components_product_variants';
  info: {
    description: '\u0412\u0430\u0440\u0438\u0430\u043D\u0442 \u0442\u043E\u0432\u0430\u0440\u0430';
    displayName: 'Variant';
  };
  attributes: {
    barcode: Schema.Attribute.String;
    externalCode: Schema.Attribute.String;
    size: Schema.Attribute.String;
    sku: Schema.Attribute.String;
    stock: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
  };
}

declare module '@strapi/strapi' {
  export module Public {
    export interface ComponentSchemas {
      'checkout.order-item': CheckoutOrderItem;
      'product.dimensions': ProductDimensions;
      'product.variant': ProductVariant;
    }
  }
}
