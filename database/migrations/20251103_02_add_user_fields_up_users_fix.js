'use strict';

/**
 * Добавляет колонки name, surname, phone в up_users.
 * Работает и в Postgres (Cloud), и в SQLite (dev).
 */
module.exports = {
  async up(knex) {
    const hasTable = await knex.schema.hasTable('up_users');
    if (!hasTable) return;

    const hasName    = await knex.schema.hasColumn('up_users', 'name');
    const hasSurname = await knex.schema.hasColumn('up_users', 'surname');
    const hasPhone   = await knex.schema.hasColumn('up_users', 'phone');

    if (!hasName) {
      await knex.schema.alterTable('up_users', (t) => {
        t.string('name');
      });
    }

    if (!hasSurname) {
      await knex.schema.alterTable('up_users', (t) => {
        t.string('surname');
      });
    }

    if (!hasPhone) {
      await knex.schema.alterTable('up_users', (t) => {
        t.string('phone');
      });
    }
  },

  async down(knex) {
    const hasTable = await knex.schema.hasTable('up_users');
    if (!hasTable) return;

    const hasPhone   = await knex.schema.hasColumn('up_users', 'phone');
    const hasSurname = await knex.schema.hasColumn('up_users', 'surname');
    const hasName    = await knex.schema.hasColumn('up_users', 'name');

    if (hasPhone) {
      await knex.schema.alterTable('up_users', (t) => {
        t.dropColumn('phone');
      });
    }

    if (hasSurname) {
      await knex.schema.alterTable('up_users', (t) => {
        t.dropColumn('surname');
      });
    }

    if (hasName) {
      await knex.schema.alterTable('up_users', (t) => {
        t.dropColumn('name');
      });
    }
  },
};
