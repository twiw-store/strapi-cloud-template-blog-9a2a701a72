export default [
  'strapi::errors',

  {
    name: 'strapi::cors',
    config: {
      origin: ['*'],
    },
  },

  'strapi::security',
  'strapi::poweredBy',
  'strapi::logger',
  'strapi::query',

  'strapi::body', // обычный body-parser, как и должен быть

  'strapi::session',
  'strapi::favicon',
  'strapi::public',
];
