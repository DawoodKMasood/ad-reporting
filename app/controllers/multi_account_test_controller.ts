import type { HttpContext } from '@adonisjs/core/http'
import ConnectedAccount from '#models/connected_account'
import googleAdsOAuthService from '#services/google_ads_oauth_service'
import googleAdsService from '#services/google_ads_service'
import logger from '@adonisjs/core/services/logger'

export default class MultiAccountTestController {
  async index({ view }: HttpContext) {
    return view.render('pages/test/multi-account')
  }

  async testConnection({ auth, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()

      // Get all connected Google Ads accounts
      const accounts = await ConnectedAccount.query()
        .where('user_id', user.id)
        .where('platform', 'google_ads')
        .orderBy('created_at', 'desc')

      const results = []

      for (const account of accounts) {
        try {
          // Test API connection
          const campaigns = await googleAdsService.getCampaigns(account.id, user.id)

          results.push({
            accountId: account.accountId,
            formattedAccountId: account.formattedAccountId,
            accountName: account.accountName,
            isActive: account.isActive,
            isTestAccount: account.isTestAccount,
            isManagerAccount: account.isManagerAccount,
            campaignCount: campaigns.length,
            connectionStatus: 'success',
            lastTested: new Date().toISOString(),
          })
        } catch (error) {
          results.push({
            accountId: account.accountId,
            formattedAccountId: account.formattedAccountId,
            accountName: account.accountName,
            isActive: account.isActive,
            connectionStatus: 'error',
            error: error.message,
            lastTested: new Date().toISOString(),
          })
        }
      }

      return {
        success: true,
        accountCount: accounts.length,
        results,
      }
    } catch (error) {
      logger.error('Error testing multi-account connections:', error)
      return response.badRequest({
        error: 'Failed to test connections',
        message: error.message,
      })
    }
  }

  async debugAccountInfo({ params, auth, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const accountId = parseInt(params.id, 10)

      const account = await ConnectedAccount.query()
        .where('id', accountId)
        .where('user_id', user.id)
        .firstOrFail()

      // Get raw token info (for debugging)
      const { refreshToken } = await googleAdsOAuthService.retrieveTokens(account.id, user.id)

      // Test accessible customers
      const accessibleCustomers = await googleAdsService.getAccessibleCustomers(account.id, user.id)

      return {
        success: true,
        account: {
          id: account.id,
          accountId: account.accountId,
          formattedAccountId: account.formattedAccountId,
          accountName: account.accountName,
          displayName: account.displayName,
          isTestAccount: account.isTestAccount,
          isManagerAccount: account.isManagerAccount,
          accountTimezone: account.accountTimezone,
          accessibleCustomers: account.accessibleCustomers,
          isActive: account.isActive,
          lastSyncAt: account.lastSyncAt,
          createdAt: account.createdAt,
        },
        tokens: {
          hasRefreshToken: !!refreshToken,
          refreshTokenLength: refreshToken?.length || 0,
        },
        accessibleCustomers,
      }
    } catch (error) {
      logger.error('Error getting debug info:', error)
      return response.badRequest({
        error: 'Failed to get debug info',
        message: error.message,
      })
    }
  }

  async formatCustomerId({ params, response }: HttpContext) {
    try {
      const { customerId } = params

      return {
        success: true,
        original: customerId,
        formatted: ConnectedAccount.formatCustomerId(customerId),
        isValid: /^\d{10}$/.test(customerId),
      }
    } catch (error) {
      return response.badRequest({
        error: 'Failed to format customer ID',
        message: error.message,
      })
    }
  }
}
