export default [
  // ✅ ОБЯЗАТЕЛЬНО ПЕРВЫМ
  'global::raw-body',

  'strapi::errors',

  {
    name: 'strapi::cors',
    config: {
      origin: ['*'], // dev-режим: разрешить всё
    },
  },

  'strapi::security',
  'strapi::poweredBy',
  'strapi::logger',
  'strapi::query',

  // ⛔ body-parser ДОЛЖЕН ИДТИ ПОСЛЕ raw-body
  'strapi::body',

  'strapi::session',
  'strapi::favicon',
  'strapi::public',
];
