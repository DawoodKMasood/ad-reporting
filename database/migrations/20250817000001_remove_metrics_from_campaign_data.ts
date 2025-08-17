import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'campaign_data'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('impressions')
      table.dropColumn('clicks')
      table.dropColumn('conversions')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.integer('impressions').defaultTo(0)
      table.integer('clicks').defaultTo(0)
      table.integer('conversions').defaultTo(0)
    })
  }
}
