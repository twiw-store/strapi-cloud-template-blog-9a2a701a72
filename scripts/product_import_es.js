// scripts/product_import_es.js
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

// ───────── категории ─────────

async function findOrCreateCategoryByName(name) {
  if (!name) return null;
  const trimmed = String(name).trim();
  if (!trimmed) return null;

  const catSlug = slugify(trimmed);

  try {
    // ищем по slug
    let res = await requestWithRetry(
      () =>
        client.get('/api/categories', {
          params: { 'filters[slug][$eq]': catSlug },
        }),
      `поиске категории по slug="${catSlug}"`
    );
    if (res.data?.data?.length) return res.data.data[0].id;

    // ищем по title (eqi)
    res = await requestWithRetry(
      () =>
        client.get('/api/categories', {
          params: { 'filters[title][$eqi]': trimmed },
        }),
      `поиске категории по названию "${trimmed}"`
    );
    if (res.data?.data?.length) return res.data.data[0].id;

    // создаём (locale условно ru – не критично)
    const createRes = await requestWithRetry(
      () =>
        client.post('/api/categories', {
          data: { title: trimmed, slug: catSlug, locale: 'ru' },
        }),
      `создании категории "${trimmed}"`
    );

    return createRes.data?.data?.id ?? null;
  } catch (err) {
    console.error(
      `   ❌ Ошибка при создании/поиске категории "${name}":`,
      err.response?.data || err.message
    );
    return null;
  }
}

async function resolveCategories(categoryCell) {
  if (!categoryCell) return [];

  const names = String(categoryCell)
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);

  const ids = [];
  for (const name of names) {
    const id = await findOrCreateCategoryByName(name);
    if (id) ids.push(id);
  }
  return ids.map((id) => ({ id }));
}

// ───────── импорт одной группы товара (ES локаль) ─────────

async function importGroupEs(slug, groupRows, groupIndex) {
  try {
    console.log(
      `\n➡️ Обрабатываю ES-локаль для товара "${slug}" (группа #${
        groupIndex + 1
      }, строк: ${groupRows.length})`
    );

    const baseRow =
      groupRows.find((r) => (r.title_es || '').trim()) || groupRows[0];

    if (!baseRow) {
      console.log('   ⚠️ Нет строк для этого slug, пропускаю');
      return;
    }

    // ищем RU для логов (не обязательно)
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
      // если поиск упал — всё равно идём дальше
    }

    if (!ruRes?.data?.data?.length) {
      console.log(
        `   ⚠️ Не найден RU-товар для slug="${slug}", но ES всё равно создадим как отдельную запись`
      );
    } else {
      const ruId = ruRes.data.data[0].id;
      console.log(`   ✅ Найден RU-товар id=${ruId} для slug="${slug}"`);
    }

    const categoryRelations = await resolveCategories(baseRow.category);

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
      locale: 'es',
      slug: baseRow.slug || slug,
      title: baseRow.title_es || baseRow.title_ru || slug,
      description: baseRow.description_es || null,
      details: baseRow.details_es || null,
      sizeInfo: baseRow.sizeInfo_es || null,
      care: baseRow.care_es || null,
      about: baseRow.about_es || null,
      price: toNumberOrNull(baseRow.price) ?? 0,
      compareAtPrice: toNumberOrNull(baseRow.compareAtPrice),
      saleStart: baseRow.saleStart || null,
      saleEnd: baseRow.saleEnd || null,
      categories: categoryRelations,
    };

    if (dimensions) baseData.dimensions = dimensions;
    if (variants.length > 0) baseData.variants = variants;

    const existingEsRes = await requestWithRetry(
      () =>
        client.get('/api/products', {
          params: {
            'filters[slug][$eq]': slug,
            'filters[locale][$eq]': 'es',
          },
        }),
      `поиске ES-товара для slug="${slug}"`
    );

    let productEsId;

    if (existingEsRes.data?.data?.length) {
      productEsId = existingEsRes.data.data[0].id;
      console.log(`🔁 Обновляю ES-товар id=${productEsId}...`);
      await requestWithRetry(
        () => client.put(`/api/products/${productEsId}`, { data: baseData }),
        `обновлении ES-товара id=${productEsId}`
      );
      console.log(`   ✅ Обновлён ES-товар со slug="${slug}"`);
    } else {
      console.log(
        `➕ Создаю ES-товар (POST /api/products) для slug="${slug}"...`
      );

      const created = await requestWithRetry(
        () => client.post('/api/products', { data: baseData }),
        `создании ES-товара slug="${slug}"`
      );

      productEsId = created.data?.data?.id;
      console.log(`   ✅ Создан ES id=${productEsId}`);
    }
  } catch (err) {
    console.error(
      `   ❌ Финальная ошибка при обработке ES-товара "${slug}":`,
      err.response?.data || err.message
    );
  }
}

// ───────── запуск ─────────

async function run() {
  console.log('🚀 Запуск импорта (ES):', csvPath);

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
        await importGroupEs(slugs[i], groups[slugs[i]], i);
      }

      console.log('\n🎉 Импорт ES завершён');
      process.exit(0);
    })
    .on('error', (err) => {
      console.error('❌ Ошибка чтения CSV:', err.message);
      process.exit(1);
    });
}

run();
