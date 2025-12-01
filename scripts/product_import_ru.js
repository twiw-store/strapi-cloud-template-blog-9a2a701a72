// scripts/product_import_ru.js
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

// ───────── категории ─────────

async function findOrCreateCategoryByName(name) {
  if (!name) return null;
  const trimmed = String(name).trim();
  if (!trimmed) return null;

  const catSlug = slugify(trimmed);

  try {
    // ищем по slug
    let res = await client.get('/api/categories', {
      params: { 'filters[slug][$eq]': catSlug },
    });
    if (res.data?.data?.length) return res.data.data[0].id;

    // ищем по title (eqi)
    res = await client.get('/api/categories', {
      params: { 'filters[title][$eqi]': trimmed },
    });
    if (res.data?.data?.length) return res.data.data[0].id;

    // создаём
    const createRes = await client.post('/api/categories', {
      data: { title: trimmed, slug: catSlug, locale: 'ru' },
    });

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

// ───────── цвета ─────────

async function findOrCreateColorByName(name) {
  if (!name) return null;
  const trimmed = String(name).trim();
  if (!trimmed) return null;

  const colorSlug = slugify(trimmed);

  try {
    // ищем по slug
    let res = await client.get('/api/colors', {
      params: { 'filters[slug][$eq]': colorSlug },
    });
    if (res.data?.data?.length) return res.data.data[0].id;

    // ищем по title (eqi)
    res = await client.get('/api/colors', {
      params: { 'filters[title][$eqi]': trimmed },
    });
    if (res.data?.data?.length) return res.data.data[0].id;

    // создаём (locale можно ru, если включена локализация)
    const createRes = await client.post('/api/colors', {
      data: { title: trimmed, slug: colorSlug, locale: 'ru' },
    });

    return createRes.data?.data?.id ?? null;
  } catch (err) {
    console.error(
      `   ❌ Ошибка при создании/поиске цвета "${name}":`,
      err.response?.data || err.message
    );
    return null;
  }
}

async function resolveColors(colorsCell) {
  if (!colorsCell) return [];

  const names = String(colorsCell)
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);

  const ids = [];
  for (const name of names) {
    const id = await findOrCreateColorByName(name);
    if (id) ids.push(id);
  }
  return ids.map((id) => ({ id }));
}

// ───────── импорт одной группы товара ─────────

async function importGroup(slug, groupRows, groupIndex) {
  try {
    console.log(
      `\n➡️ Обрабатываю товар "${slug}" (группа #${groupIndex + 1}, строк: ${groupRows.length})`
    );

    // берем строку, где есть title_ru, иначе первую
    const baseRow =
      groupRows.find((r) => (r.title_ru || '').trim()) || groupRows[0];

    if (!baseRow) {
      console.log('   ⚠️ Нет строк для этого slug, пропускаю');
      return;
    }

    // категории
    const categoryRelations = await resolveCategories(baseRow.category);

    // цвета
    const colorRelations = await resolveColors(baseRow.colors);

    // габариты / вес (если используешь)
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

    // ВАРИАНТЫ ИЗ ВСЕХ СТРОК ЭТОЙ ГРУППЫ
    const variants = groupRows
      .map((row) => ({
        sku: row.variant_sku || null,
        externalCode: row.variant_externalCode || null,
        barcode: row.variant_barcode || null,
        size: row.variant_size || null,
      }))
      .filter((v) => v.sku || v.externalCode || v.barcode || v.size);

    const baseData = {
      locale: 'ru',
      slug: baseRow.slug || slug,

      title: baseRow.title_ru || slug,
      description: baseRow.description_ru || null,
      details: baseRow.details_ru || null,
      sizeInfo: baseRow.sizeInfo_ru || null,
      care: baseRow.care_ru || null,
      about: baseRow.about_ru || null,

      price: toNumberOrNull(baseRow.price) ?? 0,
      compareAtPrice: toNumberOrNull(baseRow.compareAtPrice),
      saleStart: baseRow.saleStart || null,
      saleEnd: baseRow.saleEnd || null,

      categories: categoryRelations,
      colors: colorRelations,
    };

    if (dimensions) baseData.dimensions = dimensions;
    if (variants.length > 0) baseData.variants = variants;

    // upsert по slug + locale=ru
    const existingRes = await client.get('/api/products', {
      params: {
        'filters[slug][$eq]': slug,
        'filters[locale][$eq]': 'ru',
      },
    });

    let productId;

    if (existingRes.data?.data?.length) {
      productId = existingRes.data.data[0].id;
      console.log(`🔁 Обновляю RU-товар id=${productId}...`);
      await client.put(`/api/products/${productId}`, { data: baseData });
      console.log(`   ✅ Обновлён RU-товар со slug="${slug}"`);
    } else {
      console.log('➕ Создаю новый RU-товар...');
      const created = await client.post('/api/products', { data: baseData });
      productId = created.data?.data?.id;
      console.log(`   ✅ Создан RU id=${productId}`);
    }
  } catch (err) {
    console.error(
      `   ❌ Ошибка при обработке товара "${slug}":`,
      err.response?.data || err.message
    );
  }
}

// ───────── запуск ─────────

async function run() {
  console.log('🚀 Запуск импорта (RU):', csvPath);

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
        await importGroup(slugs[i], groups[slugs[i]], i);
      }

      console.log('\n🎉 Импорт RU завершён');
      process.exit(0);
    })
    .on('error', (err) => {
      console.error('❌ Ошибка чтения CSV:', err.message);
      process.exit(1);
    });
}

run();
