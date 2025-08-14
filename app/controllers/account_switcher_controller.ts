import type { HttpContext } from '@adonisjs/core/http'
import ConnectedAccount from '#models/connected_account'
import logger from '@adonisjs/core/services/logger'

export default class AccountSwitcherController {
  async index({ auth, response }: HttpContext) {
    try {
      console.log('🟢 AccountSwitcherController.index called');
      
      const user = auth.getUserOrFail()
      console.log('🟢 User authenticated:', user.id);
      
      const connectedAccounts = await ConnectedAccount.query()
        .where('user_id', user.id)
        .where('platform', 'google_ads')
        .where('is_active', true)
        .orderBy('created_at', 'desc')
      
      console.log('🟢 Found connected accounts:', connectedAccounts.length);
      
      const formattedAccounts = connectedAccounts.map(account => {
        try {
          return {
            id: account.id,
            accountId: account.accountId,
            formattedAccountId: account.formattedAccountId,
            displayName: account.accountDisplayName,
            accountName: account.accountName,
            isTestAccount: account.isTestAccount || false,
            isManagerAccount: account.isManagerAccount || false,
            accountTimezone: account.accountTimezone || 'UTC',
            lastSyncAt: account.lastSyncAt,
            isActive: account.isActive
          }
        } catch (error) {
          console.error('🔴 Error formatting account:', account.id, error);
          return {
            id: account.id,
            accountId: account.accountId,
            formattedAccountId: account.accountId,
            displayName: `Account ${account.accountId}`,
            accountName: account.accountName,
            isTestAccount: false,
            isManagerAccount: false,
            accountTimezone: 'UTC',
            lastSyncAt: account.lastSyncAt,
            isActive: account.isActive
          }
        }
      })
      
      console.log('🟢 Returning formatted accounts:', formattedAccounts);
      
      return response.json({
        success: true,
        accounts: formattedAccounts
      })
    } catch (error) {
      console.error('🔴 Error in AccountSwitcherController.index:', error);
      logger.error('Error fetching connected accounts:', error)
      return response.badRequest({
        error: 'Failed to fetch accounts',
        message: error.message
      })
    }
  }

  async switch({ params, auth, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const accountId = parseInt(params.id, 10)
      
      if (!accountId || isNaN(accountId)) {
        return response.badRequest({
          error: 'Invalid account ID',
          message: 'Account ID must be a valid number'
        })
      }
      
      const connectedAccount = await ConnectedAccount.query()
        .where('id', accountId)
        .where('user_id', user.id)
        .where('platform', 'google_ads')
        .firstOrFail()
      
      return response.json({
        success: true,
        account: {
          id: connectedAccount.id,
          accountId: connectedAccount.accountId,
          formattedAccountId: connectedAccount.formattedAccountId,
          displayName: connectedAccount.accountDisplayName,
          accountName: connectedAccount.accountName,
          isTestAccount: connectedAccount.isTestAccount,
          isManagerAccount: connectedAccount.isManagerAccount
        },
        message: `Switched to ${connectedAccount.accountDisplayName}`
      })
    } catch (error) {
      logger.error('Error switching account:', error)
      return response.badRequest({
        error: 'Failed to switch account',
        message: error.message
      })
    }
  }

  async getAccountMetrics({ params, auth, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const accountId = parseInt(params.id, 10)
      
      if (!accountId || isNaN(accountId)) {
        return response.badRequest({
          error: 'Invalid account ID',
          message: 'Account ID must be a valid number'
        })
      }
      
      const connectedAccount = await ConnectedAccount.query()
        .where('id', accountId)
        .where('user_id', user.id)
        .where('platform', 'google_ads')
        .firstOrFail()
      
      // Return mock metrics for now to avoid dependency issues
      return response.json({
        success: true,
        metrics: {
          spend: 0,
          impressions: 0,
          clicks: 0,
          conversions: 0,
          ctr: 0,
          cpc: 0,
          campaignCount: 0
        }
      })
    } catch (error) {
      logger.error('Error fetching account metrics:', error)
      return response.badRequest({
        error: 'Failed to fetch metrics',
        message: error.message
      })
    }
  }
}
