import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo, hasMany } from '@adonisjs/lucid/orm'
import User from './user.js'
import CampaignData from './campaign_data.js'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import databaseSecurityService from '#services/database_security_service'

export default class ConnectedAccount extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userId: number

  @column()
  declare platform: 'google_ads' | 'meta_ads' | 'tiktok_ads'

  @column()
  declare accountId: string

  @column()
  declare refreshToken: string | null

  @column()
  declare accessToken: string | null

  @column()
  declare accessTokenHash: string | null

  @column()
  declare refreshTokenHash: string | null

  @column.dateTime()
  declare expiresAt: DateTime | null

  @column.dateTime()
  declare lastSyncAt: DateTime | null

  @column()
  declare isActive: boolean

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  @hasMany(() => CampaignData)
  declare campaignData: HasMany<typeof CampaignData>

  /**
   * Hook to encrypt tokens before saving
   */
  public async $beforeSave() {
    // Encrypt tokens before saving
    if (this.accessToken) {
      this.accessToken = databaseSecurityService.encryptField(this.accessToken, 'access_token')
    }
    
    if (this.refreshToken) {
      this.refreshToken = databaseSecurityService.encryptField(this.refreshToken, 'refresh_token')
    }
  }

  /**
   * Hook to decrypt tokens after fetching
   */
  public async $afterFind() {
    // Decrypt tokens after fetching
    if (this.accessToken) {
      this.accessToken = databaseSecurityService.decryptField(this.accessToken, 'access_token')
    }
    
    if (this.refreshToken) {
      this.refreshToken = databaseSecurityService.decryptField(this.refreshToken, 'refresh_token')
    }
  }

  /**
   * Hook to decrypt tokens after fetching multiple records
   */
  public static async $afterFetch(records: ConnectedAccount[]) {
    // Decrypt tokens for all records
    for (const record of records) {
      if (record.accessToken) {
        record.accessToken = databaseSecurityService.decryptField(
          record.accessToken,
          'access_token'
        )
      }
      
      if (record.refreshToken) {
        record.refreshToken = databaseSecurityService.decryptField(
          record.refreshToken,
          'refresh_token'
        )
      }
    }
  }

  /**
   * Computed property to check if token is expired
   */
  get isTokenExpired(): boolean {
    if (!this.expiresAt) {
      return false
    }
    return this.expiresAt < DateTime.now()
  }

  /**
   * Method to encrypt tokens
   */
  encryptTokens(): void {
    if (this.accessToken) {
      this.accessToken = databaseSecurityService.encryptField(this.accessToken, 'access_token')
    }
    
    if (this.refreshToken) {
      this.refreshToken = databaseSecurityService.encryptField(this.refreshToken, 'refresh_token')
    }
  }

  /**
   * Method to decrypt tokens
   */
  decryptTokens(): void {
    if (this.accessToken) {
      this.accessToken = databaseSecurityService.decryptField(this.accessToken, 'access_token')
    }
    
    if (this.refreshToken) {
      this.refreshToken = databaseSecurityService.decryptField(this.refreshToken, 'refresh_token')
    }
  }
}
