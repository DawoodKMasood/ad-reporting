import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import googleAdsService from '#services/google_ads_service'
import logger from '@adonisjs/core/services/logger'

export default class FixTemporaryAccountIds extends BaseCommand {
  static commandName = 'google_ads:fix_temporary_ids'
  static description = 'Fix Google Ads connected accounts that have temporary or mock account IDs'

  static options: CommandOptions = {
    startApp: true,
    allowUnknownFlags: false,
    staysAlive: false,
  }

  async run() {
    this.logger.info('Starting to fix temporary Google Ads account IDs...')
    
    try {
      // Fix all temporary account IDs
      const results = await googleAdsService.fixAllTemporaryAccountIds()
      
      // Display results
      this.logger.info(`\n📊 Fix Results Summary:`)
      this.logger.info(`✅ Successfully fixed: ${results.filter(r => r.success).length} accounts`)
      this.logger.info(`❌ Failed to fix: ${results.filter(r => !r.success).length} accounts`)
      this.logger.info(`📋 Total processed: ${results.length} accounts\n`)
      
      // Display detailed results
      if (results.length > 0) {
        this.logger.info('📝 Detailed Results:')
        
        for (const result of results) {
          if (result.success) {
            this.logger.info(`✅ Account ${result.connectedAccountId}: ${result.oldAccountId} → ${result.newAccountId}`)
          } else {
            this.logger.error(`❌ Account ${result.connectedAccountId}: ${result.oldAccountId} - ${result.error}`)
          }
        }
      } else {
        this.logger.info('🎉 No accounts with temporary IDs found. All accounts are already properly configured!')
      }
      
      this.logger.info('\n🏁 Fix process completed successfully!')
    } catch (error: any) {
      this.logger.error('❌ Error during fix process:', error.message)
      this.exitCode = 1
    }
  }
}
