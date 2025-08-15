import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'campaign_data'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.text('metadata').nullable().comment('JSON metadata for manager account child info')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('metadata')
    })
  }
}
