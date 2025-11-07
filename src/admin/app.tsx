// src/admin/app.tsx
import type { StrapiApp } from '@strapi/strapi/admin';

export default {
  config: {
    locales: [],

    // ЛОГО И FAVICON ИЗ public/
    auth: { logo: '/admin/logo.png' },
    menu: { logo: '/admin/logo.png' },
    head: { favicon: '/admin/favicon.png', title: 'TWIW Admin' },

    theme: {
      light: {
        colors: {
          primary500: '#10b981',
          buttonPrimary500: '#10b981',
          buttonPrimary600: '#0ea371',
        },
      },
      dark: {
        colors: {
          primary500: '#10b981',
          buttonPrimary500: '#10b981',
          buttonPrimary600: '#0ea371',
        },
      },
    },
  },
  bootstrap(app: StrapiApp) {},
};
