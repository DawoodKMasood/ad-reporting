import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import ConnectedAccount from './connected_account.js'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import databaseSecurityService from '#services/database_security_service'

export default class CampaignData extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare connectedAccountId: number

  @column()
  declare campaignId: string

  @column()
  declare campaignName: string

  @column()
  declare campaignType: string | null

  @column()
  declare campaignSubType: string | null

  @column()
  declare adGroupType: string | null

  @column.date()
  declare date: DateTime

  @column()
  declare spend: number

  @column()
  declare impressions: number

  @column()
  declare clicks: number

  @column()
  declare conversions: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => ConnectedAccount)
  declare connectedAccount: BelongsTo<typeof ConnectedAccount>

  /**
   * Hook to encrypt sensitive data before saving
   */
  public async $beforeSave() {
    // Encrypt the campaign name before saving
    if (this.campaignName) {
      this.campaignName = databaseSecurityService.encryptField(this.campaignName, 'campaign_name')
    }
  }

  /**
   * Hook to decrypt sensitive data after fetching
   */
  public async $afterFind() {
    // Decrypt the campaign name after fetching
    if (this.campaignName) {
      this.campaignName = databaseSecurityService.decryptField(this.campaignName, 'campaign_name')
    }
  }

  /**
   * Hook to decrypt sensitive data after fetching multiple records
   */
  public static async $afterFetch(records: CampaignData[]) {
    // Decrypt the campaign name for all records
    for (const record of records) {
      if (record.campaignName) {
        record.campaignName = databaseSecurityService.decryptField(
          record.campaignName,
          'campaign_name'
        )
      }
    }
  }

  /**
   * Computed property for Click-Through Rate (CTR)
   * CTR = (Clicks / Impressions) * 100
   */
  get ctr(): number {
    if (this.impressions === 0) {
      return 0
    }
    return (this.clicks / this.impressions) * 100
  }

  /**
   * Computed property for Cost Per Click (CPC)
   * CPC = Spend / Clicks
   */
  get cpc(): number {
    if (this.clicks === 0) {
      return 0
    }
    return this.spend / this.clicks
  }
}
