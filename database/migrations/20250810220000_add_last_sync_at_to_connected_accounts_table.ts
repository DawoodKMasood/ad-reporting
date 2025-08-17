import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'connected_accounts'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.timestamp('last_sync_at').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('last_sync_at')
    })
  }
}
