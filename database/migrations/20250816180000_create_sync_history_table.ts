import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'sync_history'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('connected_account_id')
        .unsigned()
        .references('id')
        .inTable('connected_accounts')
        .onDelete('CASCADE')
      table.timestamp('synced_at').notNullable()
      table.enu('status', ['completed', 'failed', 'in_progress']).notNullable()
      table.integer('records_synced').defaultTo(0)
      table.integer('duration_ms').defaultTo(0)
      table.text('error_message').nullable()
      table.timestamp('created_at').notNullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
