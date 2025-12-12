// scripts/product_import_en.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');
const axios = require('axios');

const STRAPI_URL =
  process.env.STRAPI_URL || 'https://leading-triumph-e47eec5f69.strapiapp.com';
const API_TOKEN = process.env.STRAPI_API_TOKEN;

if (!API_TOKEN) {
  console.error('❌ STRAPI_API_TOKEN не задан в .env');
  process.exit(1);
}

const csvPath = path.join(__dirname, '../data/products.csv');

const client = axios.create({
  baseURL: STRAPI_URL,
  headers: {
    Authorization: `Bearer ${API_TOKEN}`,
    'Content-Type': 'application/json',
  },
});

// ───────────────────── helpers ─────────────────────

function slugify(str) {
  if (!str) return '';
  return String(str)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-]/g, '')
    .replace(/\-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toNumberOrNull(value) {
  if (!value) return null;
  const num = Number(String(value).replace(',', '.'));
  return Number.isNaN(num) ? null : num;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNetworkError(err) {
  const code = err.code;
  const msg = err.message || '';
  return (
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    code === 'ENOTFOUND' ||
    msg.includes('Client network socket disconnected before secure TLS connection')
  );
}

async function requestWithRetry(fn, description, maxAttempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isNetworkError(err) || attempt === maxAttempts) {
        console.error(
          `   ❌ Ошибка при ${description} (попытка ${attempt}/${maxAttempts}):`,
          err.response?.data || err.message
        );
        throw err;
      }
      const delay = 500 * attempt;
      console.warn(
        `   ⚠️ Сетевая ошибка при ${description}, retry через ${delay} мс (попытка ${attempt}/${maxAttempts})...`
      );
      await sleep(delay);
    }
  }
  throw lastError;
}

// ───────── импорт одной группы товара (EN локаль) ─────────

async function importGroupEn(slug, groupRows, groupIndex) {
  try {
    console.log(
      `\n➡️ Обрабатываю EN-локаль для товара "${slug}" (группа #${
        groupIndex + 1
      }, строк: ${groupRows.length})`
    );

    const baseRow =
      groupRows.find((r) => (r.title_en || '').trim()) || groupRows[0];

    if (!baseRow) {
      console.log('   ⚠️ Нет строк для этого slug, пропускаю');
      return;
    }

    // ищем RU (для логов, не обязательно)
    let ruRes;
    try {
      ruRes = await requestWithRetry(
        () =>
          client.get('/api/products', {
            params: {
              'filters[slug][$eq]': slug,
              'filters[locale][$eq]': 'ru',
            },
          }),
        `поиске RU-товара для slug="${slug}"`
      );
    } catch {
      // если даже поиск упал – продолжаем, EN всё равно можно создать
    }

    if (!ruRes?.data?.data?.length) {
      console.log(
        `   ⚠️ Не найден RU-товар для slug="${slug}", но EN всё равно создадим как отдельную запись`
      );
    } else {
      const ruId = ruRes.data.data[0].id;
      console.log(`   ✅ Найден RU-товар id=${ruId} для slug="${slug}"`);
    }

    const dimWeight = toNumberOrNull(baseRow.dimension_weight);
    const dimLength = toNumberOrNull(baseRow.dimension_length);
    const dimWidth = toNumberOrNull(baseRow.dimension_width);
    const dimHeight = toNumberOrNull(baseRow.dimension_height);

    let dimensions = null;
    if (
      dimWeight !== null ||
      dimLength !== null ||
      dimWidth !== null ||
      dimHeight !== null
    ) {
      dimensions = {
        weight: dimWeight,
        length: dimLength,
        width: dimWidth,
        height: dimHeight,
      };
    }

    const variants = groupRows
      .map((row) => ({
        sku: row.variant_sku || null,
        externalCode: row.variant_externalCode || null,
        barcode: row.variant_barcode || null,
        size: row.variant_size || null,
      }))
      .filter((v) => v.sku || v.externalCode || v.barcode || v.size);

    const baseData = {
      locale: 'en',
      slug: baseRow.slug || slug,

      title: baseRow.title_en || baseRow.title_ru || slug,
      description: baseRow.description_en || null,
      details: baseRow.details_en || null,
      sizeInfo: baseRow.sizeInfo_en || null,
      care: baseRow.care_en || null,
      about: baseRow.about_en || null,

      price: toNumberOrNull(baseRow.price) ?? 0,
      compareAtPrice: toNumberOrNull(baseRow.compareAtPrice),
      saleStart: baseRow.saleStart || null,
      saleEnd: baseRow.saleEnd || null,

      // 🟢 ВАЖНО: категории не трогаем, чтобы не ловить 404 на relation
      // categories: categoryRelations,

      // 🟢 Просто подтягиваем цвет из CSV
      colors: baseRow.colors || null,
    };

    if (dimensions) baseData.dimensions = dimensions;
    if (variants.length > 0) baseData.variants = variants;

    const existingEnRes = await requestWithRetry(
      () =>
        client.get('/api/products', {
          params: {
            'filters[slug][$eq]': slug,
            'filters[locale][$eq]': 'en',
          },
        }),
      `поиске EN-товара для slug="${slug}"`
    );

    let productEnId;

    if (existingEnRes.data?.data?.length) {
      productEnId = existingEnRes.data.data[0].id;
      console.log(`🔁 Обновляю EN-товар id=${productEnId}...`);
      await requestWithRetry(
        () => client.put(`/api/products/${productEnId}`, { data: baseData }),
        `обновлении EN-товара id=${productEnId}`
      );
      console.log(`   ✅ Обновлён EN-товар со slug="${slug}"`);
    } else {
      console.log(
        `➕ Создаю EN-товар (POST /api/products) для slug="${slug}"...`
      );

      const created = await requestWithRetry(
        () => client.post('/api/products', { data: baseData }),
        `создании EN-товара slug="${slug}"`
      );

      productEnId = created.data?.data?.id;
      console.log(`   ✅ Создан EN id=${productEnId}`);
    }
  } catch (err) {
    console.error(
      `   ❌ Финальная ошибка при обработке EN-товара "${slug}":`,
      err.response?.data || err.message
    );
  }
}

// ───────── запуск ─────────

async function run() {
  console.log('🚀 Запуск импорта (EN):', csvPath);

  const rows = [];

  fs.createReadStream(csvPath)
    .pipe(
      parse({
        columns: true,
        skip_empty_lines: true,
        trim: true,
      })
    )
    .on('data', (row) => rows.push(row))
    .on('end', async () => {
      const groups = {};
      for (const row of rows) {
        if (!row.slug?.trim()) continue;
        const slug = row.slug.trim();
        if (!groups[slug]) groups[slug] = [];
        groups[slug].push(row);
      }

      const slugs = Object.keys(groups);
      console.log(`📦 Найдено групп товаров: ${slugs.length}`);

      for (let i = 0; i < slugs.length; i++) {
        await importGroupEn(slugs[i], groups[slugs[i]], i);
      }

      console.log('\n🎉 Импорт EN завершён');
      process.exit(0);
    })
    .on('error', (err) => {
      console.error('❌ Ошибка чтения CSV:', err.message);
      process.exit(1);
    });
}

run();
