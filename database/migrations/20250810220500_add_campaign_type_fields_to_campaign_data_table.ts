import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'campaign_data'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('campaign_type').nullable()
      table.string('campaign_sub_type').nullable()
      table.string('ad_group_type').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('campaign_type')
      table.dropColumn('campaign_sub_type')
      table.dropColumn('ad_group_type')
    })
  }
}