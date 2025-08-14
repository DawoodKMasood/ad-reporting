import type { HttpContext } from '@adonisjs/core/http'
import ConnectedAccount from '#models/connected_account'
import googleAdsOAuthService from '#services/google_ads_oauth_service'
import logger from '@adonisjs/core/services/logger'

export default class AccountManagementController {
  /**
   * Manually set customer ID for a connected account
   */
  async setCustomerId({ request, response, auth }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const { connectedAccountId, customerId } = request.body()
      
      if (!connectedAccountId || !customerId) {
        return response.badRequest({
          success: false,
          error: 'Missing parameters',
          message: 'Both connectedAccountId and customerId are required'
        })
      }
      
      // Validate customer ID format (must be 10 digits)
      if (!/^\d{10}$/.test(customerId)) {
        return response.badRequest({
          success: false,
          error: 'Invalid customer ID format',
          message: 'Customer ID must be exactly 10 digits (e.g., 1234567890)'
        })
      }
      
      // Find the connected account
      const connectedAccount = await ConnectedAccount.query()
        .where('id', connectedAccountId)
        .where('user_id', user.id)
        .firstOrFail()
      
      const oldAccountId = connectedAccount.accountId
      
      // Update with the provided customer ID
      connectedAccount.accountId = customerId
      await connectedAccount.save()
      
      logger.info('Manually updated customer ID', {
        connectedAccountId,
        oldAccountId,
        newAccountId: customerId,
        userId: user.id
      })
      
      return response.ok({
        success: true,
        message: `Customer ID updated from ${oldAccountId} to ${customerId}`,
        connectedAccountId,
        oldAccountId,
        newAccountId: customerId
      })
      
    } catch (error: any) {
      logger.error('Error setting customer ID:', error)
      return response.internalServerError({
        success: false,
        error: 'Failed to set customer ID',
        message: error.message
      })
    }
  }

  /**
   * Try to automatically fetch customer ID (simplified approach)
   */
  async tryAutoFetchCustomerId({ request, response, auth }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const { connectedAccountId } = request.body()
      
      if (!connectedAccountId) {
        return response.badRequest({
          success: false,
          error: 'Missing parameter',
          message: 'connectedAccountId is required'
        })
      }
      
      // Find the connected account
      const connectedAccount = await ConnectedAccount.query()
        .where('id', connectedAccountId)
        .where('user_id', user.id)
        .firstOrFail()
      
      logger.info(`Attempting to auto-fetch customer ID for account ${connectedAccountId}`)
      
      try {
        // Get tokens
        const tokens = await googleAdsOAuthService.retrieveTokens(connectedAccountId, user.id)
        
        if (!tokens.refreshToken) {
          throw new Error('No refresh token available')
        }
        
        // Try to fetch customer ID
        const realCustomerId = await googleAdsOAuthService.getCustomerId(
          tokens.accessToken,
          tokens.refreshToken
        )
        
        const oldAccountId = connectedAccount.accountId
        
        // Update with the fetched customer ID
        connectedAccount.accountId = realCustomerId
        await connectedAccount.save()
        
        logger.info('Successfully auto-fetched customer ID', {
          connectedAccountId,
          oldAccountId,
          newAccountId: realCustomerId
        })
        
        return response.ok({
          success: true,
          message: `Customer ID automatically updated from ${oldAccountId} to ${realCustomerId}`,
          connectedAccountId,
          oldAccountId,
          newAccountId: realCustomerId
        })
        
      } catch (fetchError: any) {
        logger.error(`Failed to auto-fetch customer ID for account ${connectedAccountId}:`, fetchError)
        
        return response.badRequest({
          success: false,
          error: 'Auto-fetch failed',
          message: fetchError.message,
          suggestion: 'Please manually set your customer ID using the /integrations/set-customer-id endpoint'
        })
      }
      
    } catch (error: any) {
      logger.error('Error in auto-fetch customer ID:', error)
      return response.internalServerError({
        success: false,
        error: 'Failed to auto-fetch customer ID',
        message: error.message
      })
    }
  }

  /**
   * Fix mock account IDs by fetching real customer IDs from Google Ads API
   */
  async fixMockAccounts({ response, auth }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      
      // Find all connected accounts with mock IDs or temporary IDs
      const mockAccounts = await ConnectedAccount.query()
        .where('user_id', user.id)
        .where('platform', 'google_ads')
        .where(query => {
          query.where('account_id', 'LIKE', 'google_ads_account_%')
               .orWhere('account_id', 'LIKE', 'temp_google_ads_%')
        })
      
      if (mockAccounts.length === 0) {
        return response.ok({
          success: true,
          message: 'No mock accounts found to fix',
          fixed: 0
        })
      }
      
      logger.info(`Found ${mockAccounts.length} mock accounts to fix`)
      
      const fixedAccounts = []
      const failedAccounts = []
      
      for (const account of mockAccounts) {
        try {
          logger.info(`Fixing mock account ${account.id} with account_id: ${account.accountId}`)
          
          // Get tokens for this account
          const tokens = await googleAdsOAuthService.retrieveTokens(account.id, user.id)
          
          if (!tokens.refreshToken) {
            logger.warn(`No refresh token for account ${account.id}, skipping`)
            failedAccounts.push({
              accountId: account.id,
              error: 'No refresh token available'
            })
            continue
          }
          
          // Fetch real customer ID
          const realCustomerId = await googleAdsOAuthService.getCustomerId(
            tokens.accessToken,
            tokens.refreshToken
          )
          
          logger.info(`Retrieved real customer ID ${realCustomerId} for account ${account.id}`)
          
          const oldAccountId = account.accountId
          
          // Update account with real customer ID
          account.accountId = realCustomerId
          await account.save()
          
          fixedAccounts.push({
            connectedAccountId: account.id,
            oldAccountId: oldAccountId,
            newAccountId: realCustomerId
          })
          
          logger.info(`Successfully fixed account ${account.id}: ${oldAccountId} -> ${realCustomerId}`)
          
        } catch (error: any) {
          logger.error(`Failed to fix account ${account.id}:`, error)
          failedAccounts.push({
            accountId: account.id,
            error: error.message
          })
        }
      }
      
      return response.ok({
        success: true,
        message: `Fixed ${fixedAccounts.length} accounts, ${failedAccounts.length} failed`,
        fixed: fixedAccounts.length,
        failed: failedAccounts.length,
        fixedAccounts,
        failedAccounts
      })
      
    } catch (error: any) {
      logger.error('Error fixing mock accounts:', error)
      return response.internalServerError({
        success: false,
        error: 'Failed to fix mock accounts',
        message: error.message
      })
    }
  }

  /**
   * Delete all mock accounts (for cleanup)
   */
  async deleteMockAccounts({ response, auth }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      
      // Find and delete all mock accounts and temporary accounts
      const deletedCount = await ConnectedAccount.query()
        .where('user_id', user.id)
        .where('platform', 'google_ads')
        .where(query => {
          query.where('account_id', 'LIKE', 'google_ads_account_%')
               .orWhere('account_id', 'LIKE', 'temp_google_ads_%')
        })
        .delete()
      
      logger.info(`Deleted ${deletedCount} mock accounts for user ${user.id}`)
      
      return response.ok({
        success: true,
        message: `Deleted ${deletedCount} mock accounts`,
        deleted: deletedCount
      })
      
    } catch (error: any) {
      logger.error('Error deleting mock accounts:', error)
      return response.internalServerError({
        success: false,
        error: 'Failed to delete mock accounts',
        message: error.message
      })
    }
  }

  /**
   * List all connected accounts for debugging
   */
  async listAccounts({ response, auth }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      
      const accounts = await ConnectedAccount.query()
        .where('user_id', user.id)
        .select(['id', 'platform', 'account_id', 'is_active', 'created_at', 'updated_at'])
      
      return response.ok({
        success: true,
        accounts: accounts.map(account => ({
          id: account.id,
          platform: account.platform,
          accountId: account.accountId,
          isMock: account.accountId.startsWith('google_ads_account_'),
          isTemporary: account.accountId.startsWith('temp_google_ads_'),
          needsCustomerId: account.accountId.startsWith('google_ads_account_') || account.accountId.startsWith('temp_google_ads_'),
          isActive: account.isActive,
          createdAt: account.createdAt,
          updatedAt: account.updatedAt
        }))
      })
      
    } catch (error: any) {
      logger.error('Error listing accounts:', error)
      return response.internalServerError({
        success: false,
        error: 'Failed to list accounts',
        message: error.message
      })
    }
  }
}
