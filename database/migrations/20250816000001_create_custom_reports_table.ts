import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'custom_reports'

  public async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.integer('user_id').unsigned().references('id').inTable('users').onDelete('CASCADE')
      table
        .integer('connected_account_id')
        .unsigned()
        .references('id')
        .inTable('connected_accounts')
        .onDelete('CASCADE')
      table.string('name').notNullable()
      table.text('description').nullable()
      table.string('platform').notNullable() // google_ads, meta_ads, tiktok_ads
      table.json('filters').nullable() // JSON object containing report filters
      table.json('metrics').notNullable() // JSON array of selected metrics
      table.json('dimensions').nullable() // JSON array of selected dimensions
      table.string('date_range_type').notNullable().defaultTo('last_30_days') // last_7_days, last_30_days, last_90_days, custom
      table.date('start_date').nullable()
      table.date('end_date').nullable()
      table.string('status').notNullable().defaultTo('active') // active, archived, draft
      table.boolean('is_scheduled').defaultTo(false)
      table.string('schedule_frequency').nullable() // daily, weekly, monthly
      table.timestamp('last_generated_at').nullable()
      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  public async down() {
    this.schema.dropTable(this.tableName)
  }
}
