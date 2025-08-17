import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import ConnectedAccount from './connected_account.js'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

export default class SyncHistory extends BaseModel {
  static table = 'sync_history'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare connectedAccountId: number

  @column.dateTime()
  declare syncedAt: DateTime

  @column()
  declare status: 'completed' | 'failed' | 'in_progress'

  @column()
  declare recordsSynced: number

  @column()
  declare durationMs: number

  @column()
  declare errorMessage: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => ConnectedAccount)
  declare connectedAccount: BelongsTo<typeof ConnectedAccount>

  /**
   * Computed property for duration in seconds
   */
  get durationSeconds(): number {
    return this.durationMs / 1000
  }

  /**
   * Computed property for formatted duration
   */
  get formattedDuration(): string {
    if (this.durationMs === 0) {
      return 'N/A'
    }

    const seconds = Math.floor(this.durationMs / 1000)
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60

    if (minutes > 0) {
      return `${minutes}m ${remainingSeconds}s`
    }
    return `${remainingSeconds}s`
  }
}
