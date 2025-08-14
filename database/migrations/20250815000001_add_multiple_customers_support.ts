import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'connected_accounts'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      // Add columns for multiple customer support
      table.string('display_name').nullable() // User-friendly name for the account
      table.boolean('is_manager_account').defaultTo(false) // Whether this is a manager account
      table.string('parent_account_id').nullable() // Reference to parent manager account ID
      table.json('accessible_customers').nullable() // Store all accessible customers for this OAuth connection
      table.string('account_name').nullable() // Official account name from Google Ads
      table.string('account_timezone').nullable() // Account timezone
      table.boolean('is_test_account').defaultTo(false) // Whether this is a test account
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('display_name')
      table.dropColumn('is_manager_account')
      table.dropColumn('parent_account_id')
      table.dropColumn('accessible_customers')
      table.dropColumn('account_name')
      table.dropColumn('account_timezone')
      table.dropColumn('is_test_account')
    })
  }
}
