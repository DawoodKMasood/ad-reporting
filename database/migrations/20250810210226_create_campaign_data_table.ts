import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'campaign_data'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('connected_account_id')
        .unsigned()
        .references('id')
        .inTable('connected_accounts')
        .onDelete('CASCADE')
      table.string('campaign_id').notNullable()
      table.string('campaign_name').notNullable()
      table.date('date').notNullable()
      table.decimal('spend', 12, 2).defaultTo(0)
      table.integer('impressions').defaultTo(0)
      table.integer('clicks').defaultTo(0)
      table.integer('conversions').defaultTo(0)
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
