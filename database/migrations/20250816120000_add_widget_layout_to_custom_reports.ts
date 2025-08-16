import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'custom_reports'

  public async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.json('widget_layout').nullable() // JSON array of widget configurations for drag and drop
    })
  }

  public async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('widget_layout')
    })
  }
}
