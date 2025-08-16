import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo, hasMany } from '@adonisjs/lucid/orm'
import User from './user.js'
import CampaignData from './campaign_data.js'
import CustomReport from './custom_report.js'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import databaseSecurityService from '#services/database_security_service'
import logger from '@adonisjs/core/services/logger'

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

  @column()
  declare displayName: string | null

  @column()
  declare isManagerAccount: boolean

  @column()
  declare parentAccountId: string | null

  @column({
    consume: (value: string | null) => {
      if (!value) return null;
      try {
        return typeof value === 'string' ? JSON.parse(value) : value;
      } catch {
        return null;
      }
    }
  })
  declare accessibleCustomers: string[] | null

  @column()
  declare accountName: string | null

  @column()
  declare accountTimezone: string | null

  @column()
  declare isTestAccount: boolean

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  @hasMany(() => CampaignData)
  declare campaignData: HasMany<typeof CampaignData>

  @hasMany(() => CustomReport)
  declare customReports: HasMany<typeof CustomReport>

  /**
   * Hook to encrypt tokens before saving
   */
  public async $beforeSave() {
    try {
      // Encrypt tokens before saving
      if (this.accessToken && !this.isAccessTokenEncrypted()) {
        logger.info(`Encrypting access token for account ${this.id}`)
        this.accessToken = databaseSecurityService.encryptField(this.accessToken, 'access_token')
      }
      
      if (this.refreshToken && !this.isRefreshTokenEncrypted()) {
        logger.info(`Encrypting refresh token for account ${this.id}`)
        this.refreshToken = databaseSecurityService.encryptField(this.refreshToken, 'refresh_token')
      }
    } catch (error) {
      logger.error('Error encrypting tokens in $beforeSave hook:', error)
      // Don't throw error to avoid breaking the save operation
    }
  }

  /**
   * Hook to decrypt tokens after fetching
   */
  public async $afterFind() {
    try {
      // Decrypt tokens after fetching
      if (this.accessToken && this.isAccessTokenEncrypted()) {
        this.accessToken = databaseSecurityService.decryptField(this.accessToken, 'access_token')
      }
      
      if (this.refreshToken && this.isRefreshTokenEncrypted()) {
        this.refreshToken = databaseSecurityService.decryptField(this.refreshToken, 'refresh_token')
      }
    } catch (error) {
      logger.error('Error decrypting tokens in $afterFind hook:', error)
      // Don't throw error to avoid breaking the fetch operation
    }
  }

  /**
   * Hook to decrypt tokens after fetching multiple records
   */
  public static async $afterFetch(records: ConnectedAccount[]) {
    // Decrypt tokens for all records
    for (const record of records) {
      try {
        if (record.accessToken && record.isAccessTokenEncrypted()) {
          record.accessToken = databaseSecurityService.decryptField(
            record.accessToken,
            'access_token'
          )
        }
        
        if (record.refreshToken && record.isRefreshTokenEncrypted()) {
          record.refreshToken = databaseSecurityService.decryptField(
            record.refreshToken,
            'refresh_token'
          )
        }
      } catch (error) {
        logger.error(`Error decrypting tokens for account ${record.id} in $afterFetch hook:`, error)
        // Don't throw error to avoid breaking the fetch operation
      }
    }
  }

  /**
   * Check if access token appears to be encrypted
   */
  private isAccessTokenEncrypted(): boolean {
    if (!this.accessToken) return false
    
    // Base64 encoded encrypted data will not contain spaces and will be longer than typical access tokens
    // Also check if it looks like a Google access token (starts with ya29.)
    return !this.accessToken.startsWith('ya29.') && 
           !this.accessToken.includes(' ') && 
           this.accessToken.length > 100 &&
           /^[A-Za-z0-9+/=]+$/.test(this.accessToken)
  }

  /**
   * Check if refresh token appears to be encrypted
   */
  private isRefreshTokenEncrypted(): boolean {
    if (!this.refreshToken) return false
    
    // Similar check for refresh tokens
    // Google refresh tokens typically start with 1//
    return !this.refreshToken.startsWith('1//') && 
           !this.refreshToken.includes(' ') && 
           this.refreshToken.length > 100 &&
           /^[A-Za-z0-9+/=]+$/.test(this.refreshToken)
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
   * Method to encrypt tokens manually
   */
  encryptTokens(): void {
    if (this.accessToken && !this.isAccessTokenEncrypted()) {
      this.accessToken = databaseSecurityService.encryptField(this.accessToken, 'access_token')
    }
    
    if (this.refreshToken && !this.isRefreshTokenEncrypted()) {
      this.refreshToken = databaseSecurityService.encryptField(this.refreshToken, 'refresh_token')
    }
  }

  /**
   * Method to decrypt tokens manually
   */
  decryptTokens(): void {
    if (this.accessToken && this.isAccessTokenEncrypted()) {
      this.accessToken = databaseSecurityService.decryptField(this.accessToken, 'access_token')
    }
    
    if (this.refreshToken && this.isRefreshTokenEncrypted()) {
      this.refreshToken = databaseSecurityService.decryptField(this.refreshToken, 'refresh_token')
    }
  }

  /**
   * Format customer ID to XXX-XXX-XXXX format
   */
  get formattedAccountId(): string {
    if (!this.accountId || this.accountId.length !== 10) {
      return this.accountId
    }
    return `${this.accountId.slice(0, 3)}-${this.accountId.slice(3, 6)}-${this.accountId.slice(6)}`
  }

  /**
   * Get display name for the account
   */
  get accountDisplayName(): string {
    if (this.displayName) {
      return this.displayName
    }
    if (this.accountName) {
      return this.accountName
    }
    return `${this.platform.replace('_', ' ')} Account`
  }

  /**
   * Static method to format any customer ID
   */
  static formatCustomerId(customerId: string): string {
    if (!customerId || customerId.length !== 10) {
      return customerId
    }
    return `${customerId.slice(0, 3)}-${customerId.slice(3, 6)}-${customerId.slice(6)}`
  }
}