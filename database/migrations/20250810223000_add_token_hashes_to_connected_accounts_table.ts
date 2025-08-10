import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'connected_accounts'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('access_token_hash').nullable()
      table.string('refresh_token_hash').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('access_token_hash')
      table.dropColumn('refresh_token_hash')
    })
  }
}
