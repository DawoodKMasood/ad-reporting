import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import User from './user.js'
import ConnectedAccount from './connected_account.js'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

export default class CustomReport extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userId: number

  @column()
  declare connectedAccountId: number

  @column()
  declare name: string

  @column()
  declare description: string | null

  @column()
  declare platform: 'google_ads' | 'meta_ads' | 'tiktok_ads'

  @column({
    consume: (value: string | null) => {
      if (!value) return null;
      try {
        return typeof value === 'string' ? JSON.parse(value) : value;
      } catch {
        return null;
      }
    },
    prepare: (value: any) => JSON.stringify(value)
  })
  declare filters: Record<string, any> | null

  @column({
    consume: (value: string) => {
      try {
        return typeof value === 'string' ? JSON.parse(value) : value;
      } catch {
        return [];
      }
    },
    prepare: (value: any) => JSON.stringify(value)
  })
  declare metrics: string[]

  @column({
    consume: (value: string | null) => {
      if (!value) return null;
      try {
        return typeof value === 'string' ? JSON.parse(value) : value;
      } catch {
        return null;
      }
    },
    prepare: (value: any) => JSON.stringify(value)
  })
  declare dimensions: string[] | null

  @column()
  declare dateRangeType: 'last_7_days' | 'last_30_days' | 'last_90_days' | 'custom'

  @column.date()
  declare startDate: DateTime | null

  @column.date()
  declare endDate: DateTime | null

  @column()
  declare status: 'active' | 'archived' | 'draft'

  @column()
  declare isScheduled: boolean

  @column()
  declare scheduleFrequency: 'daily' | 'weekly' | 'monthly' | null

  @column.dateTime()
  declare lastGeneratedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  @belongsTo(() => ConnectedAccount)
  declare connectedAccount: BelongsTo<typeof ConnectedAccount>

  /**
   * Get platform display name
   */
  get platformDisplayName(): string {
    const platformNames: { [key: string]: string } = {
      google_ads: 'Google Ads',
      meta_ads: 'Meta Ads',
      tiktok_ads: 'TikTok Ads',
    }
    return platformNames[this.platform] || this.platform.charAt(0).toUpperCase() + this.platform.slice(1)
  }

  /**
   * Get date range display text
   */
  get dateRangeDisplay(): string {
    switch (this.dateRangeType) {
      case 'last_7_days':
        return 'Last 7 days'
      case 'last_30_days':
        return 'Last 30 days'
      case 'last_90_days':
        return 'Last 90 days'
      case 'custom':
        if (this.startDate && this.endDate) {
          return `${this.startDate.toFormat('MMM dd, yyyy')} - ${this.endDate.toFormat('MMM dd, yyyy')}`
        }
        return 'Custom range'
      default:
        return 'Unknown range'
    }
  }

  /**
   * Get metrics display text
   */
  get metricsDisplay(): string {
    return this.metrics.join(', ')
  }

  /**
   * Check if report is recently generated
   */
  get isRecentlyGenerated(): boolean {
    if (!this.lastGeneratedAt) return false
    return this.lastGeneratedAt > DateTime.now().minus({ hours: 24 })
  }
}
