import type { HttpContext } from '@adonisjs/core/http'
import ConnectedAccount from '#models/connected_account'
import CampaignData from '#models/campaign_data'
import { connectValidator, disconnectValidator, syncValidator } from '#validators/integrations'
import logger from '@adonisjs/core/services/logger'
import googleAdsService from '#services/google_ads_service'
import googleAdsOAuthService from '#services/google_ads_oauth_service'

export default class IntegrationsController {
  async index({ view, auth }: HttpContext) {
    const user = auth.getUserOrFail()

    const connectedAccounts = await ConnectedAccount.query()
      .where('user_id', user.id)
      .orderBy('created_at', 'desc')

    const availablePlatforms = [
      {
        name: 'google_ads',
        displayName: 'Google Ads',
        description: 'Connect your Google Ads account to track campaign performance',
        connected: connectedAccounts.some((account) => account.platform === 'google_ads'),
      },
      {
        name: 'meta_ads',
        displayName: 'Meta Ads',
        description: 'Connect Facebook & Instagram ads (Coming Soon)',
        connected: connectedAccounts.some((account) => account.platform === 'meta_ads'),
        disabled: true,
      },
      {
        name: 'tiktok_ads',
        displayName: 'TikTok Ads',
        description: 'Connect your TikTok for Business (Coming Soon)',
        connected: connectedAccounts.some((account) => account.platform === 'tiktok_ads'),
        disabled: true,
      },
    ]

    return view.render('pages/integrations/index', {
      user,
      connectedAccounts,
      availablePlatforms,
    })
  }

  async show({ params, auth, response, view }: HttpContext) {
    try {
      const user = auth.getUserOrFail()

      const connectedAccount = await ConnectedAccount.query()
        .where('id', params.id)
        .where('user_id', user.id)
        .firstOrFail()

      // Get summary metrics for the last 30 days
      let accountMetrics = {
        totalSpend: 0,
        totalImpressions: 0,
        totalClicks: 0,
        totalConversions: 0
      }

      let syncIssues = {
        hasData: false,
        isManagerWithNoChildren: false,
        lastSyncError: null
      }

      try {
        const campaignData = await googleAdsService.getEnrichedCampaignData(
          connectedAccount.id,
          user.id,
          { type: 'last_30_days' }
        )
        
        syncIssues.hasData = campaignData.length > 0
        
        // Calculate totals
        accountMetrics = campaignData.reduce((acc, data) => ({
          totalSpend: acc.totalSpend + (data.spend || 0),
          totalImpressions: acc.totalImpressions + (data.impressions || 0),
          totalClicks: acc.totalClicks + (data.clicks || 0),
          totalConversions: acc.totalConversions + (data.conversions || 0)
        }), accountMetrics)
        
      } catch (metricsError: any) {
        logger.warn('Could not fetch account metrics:', metricsError)
        syncIssues.lastSyncError = metricsError.message
        
        // Check if this is a manager account with no children case
        if (connectedAccount.isManagerAccount && 
            metricsError.message && 
            metricsError.message.includes('no accessible child accounts')) {
          syncIssues.isManagerWithNoChildren = true
        }
      }

      return view.render('pages/integrations/show', {
        user,
        connectedAccount,
        accountMetrics,
        syncIssues,
      })
    } catch (error) {
      logger.error('Error fetching connected account details:', error)
      return response.notFound('Connected account not found')
    }
  }

  async connect({ request, auth, response, session }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const payload = await request.validateUsing(connectValidator)

      if (payload.platform !== 'google_ads') {
        const isApiRequest = request.header('Accept')?.includes('application/json')

        if (isApiRequest) {
          return response.badRequest({
            error: 'Unsupported platform',
            message: `Platform ${payload.platform} is not supported`,
          })
        }
        return response.redirect().back()
      }

      const state = `${user.id}-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`
      session.put('oauth_state', state)

      const authUrl = googleAdsOAuthService.generateAuthUrl(user.id, state)

      const isApiRequest = request.header('Accept')?.includes('application/json')

      if (isApiRequest) {
        return {
          success: true,
          redirectUrl: authUrl,
          message: 'OAuth2 flow initiated successfully',
        }
      }

      return response.redirect().toPath(authUrl)
    } catch (error) {
      logger.error('Error initiating OAuth2 flow:', error)

      const isApiRequest = request.header('Accept')?.includes('application/json')
      if (isApiRequest) {
        return response.badRequest({
          error: 'Validation failed',
          message: error.messages
        })
      }

      return response.redirect().back()
    }
  }

  async callback({ request, auth, response, session, params }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const { code, state } = request.qs()
      const { platform } = params

      const storedState = session.get('oauth_state')

      if (!state || state !== storedState) {
        return response.badRequest({
          error: 'Invalid state parameter',
          message: 'Possible CSRF attack detected'
        })
      }

      session.forget('oauth_state')

      if (!code) {
        return response.badRequest({
          error: 'Missing authorization code',
          message: 'Authorization code is required'
        })
      }

      if (platform !== 'google_ads') {
        return response.badRequest({
          error: 'Unsupported platform',
          message: `Platform ${platform} is not supported`
        })
      }

      const tokens = await googleAdsOAuthService.exchangeCodeForTokens(code)

      let connectedAccounts: any[]
      try {
        connectedAccounts = await googleAdsOAuthService.storeTokensForAllCustomers(
          user.id,
          tokens.accessToken,
          tokens.refreshToken!,
          tokens.expiryDate
        )
      } catch (customerIdError: any) {
        const isApiRequest = request.header('Accept')?.includes('application/json')
        if (isApiRequest) {
          return response.badRequest({
            error: 'Failed to retrieve Google Ads account information',
            message: 'Unable to fetch your Google Ads customer ID',
            details: customerIdError.message
          })
        }
        return response.redirect().toRoute('integrations.index')
      }

      const isApiRequest = request.header('Accept')?.includes('application/json')
      if (isApiRequest) {
        return {
          success: true,
          accounts: connectedAccounts,
          message: `${connectedAccounts.length} account(s) connected successfully`
        }
      }

      return response.redirect().toRoute('integrations.index')
    } catch (error) {
      logger.error('Error handling OAuth2 callback:', error)

      const isApiRequest = request.header('Accept')?.includes('application/json')
      if (isApiRequest) {
        return response.badRequest({
          error: 'OAuth2 callback failed',
          message: error.message
        })
      }

      return response.redirect().toRoute('integrations.index')
    }
  }

  async disconnect({ params, request, auth, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const payload = await request.validateUsing(disconnectValidator)

      const accountId = payload.id || Number.parseInt(params.id, 10)

      if (!accountId || Number.isNaN(accountId)) {
        const isApiRequest = request.header('Accept')?.includes('application/json')
        if (isApiRequest) {
          return response.badRequest({
            error: 'Invalid account ID',
            message: 'Account ID must be a valid number'
          })
        }
        return response.redirect().back()
      }

      const connectedAccount = await ConnectedAccount.query()
        .where('id', accountId)
        .where('user_id', user.id)
        .firstOrFail()

      await connectedAccount.delete()

      const isApiRequest = request.header('Accept')?.includes('application/json')
      if (isApiRequest) {
        return {
          success: true,
          message: 'Account disconnected successfully'
        }
      }

      return response.redirect().back()
    } catch (error) {
      logger.error('Error disconnecting account:', error)

      const isApiRequest = request.header('Accept')?.includes('application/json')
      if (isApiRequest) {
        return response.badRequest({
          error: 'Failed to disconnect account',
          message: error.message
        })
      }

      return response.redirect().back()
    }
  }

  async sync({ params, request, auth, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const payload = await request.validateUsing(syncValidator)

      const accountId = payload.id || Number.parseInt(params.id, 10)

      if (!accountId || Number.isNaN(accountId)) {
        const isApiRequest = request.header('Accept')?.includes('application/json')
        if (isApiRequest) {
          return response.badRequest({
            error: 'Invalid account ID',
            message: 'Account ID must be a valid number'
          })
        }
        return response.redirect().back()
      }

      const connectedAccount = await ConnectedAccount.query()
        .where('id', accountId)
        .where('user_id', user.id)
        .firstOrFail()

      const enrichedData = await googleAdsService.getEnrichedCampaignData(
        connectedAccount.id,
        user.id,
        { type: 'last_7_days' }
      )

      const isApiRequest = request.header('Accept')?.includes('application/json')
      if (isApiRequest) {
        return {
          success: true,
          message: 'Data sync completed successfully',
          account: connectedAccount,
          dataCount: enrichedData.length
        }
      }

      return response.redirect().back()
    } catch (error) {
      logger.error('Error syncing account data:', error)

      // Better error formatting to provide more details to the user
      let errorMessage = 'Unknown error occurred during sync'
      let errorDetails = {}
      
      if (error?.message) {
        errorMessage = error.message
      }
      
      if (error?.details) {
        errorDetails = error.details
      } else if (error?.response) {
        errorDetails = error.response
      } else {
        errorDetails = { error: error?.toString() || 'Unknown error' }
      }

      const isApiRequest = request.header('Accept')?.includes('application/json')
      if (isApiRequest) {
        return response.badRequest({
          error: 'Failed to sync data',
          message: errorMessage,
          details: errorDetails,
        })
      }

      // For web requests, we could add a flash message here
      return response.redirect().back()
    }
  }

  async updateAccountName({ params, request, auth, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const { displayName } = request.body()

      const accountId = Number.parseInt(params.id, 10)

      if (!accountId || Number.isNaN(accountId)) {
        const isApiRequest = request.header('Accept')?.includes('application/json')
        if (isApiRequest) {
          return response.badRequest({
            error: 'Invalid account ID',
            message: 'Account ID must be a valid number'
          })
        }
        return response.redirect().back()
      }

      const connectedAccount = await ConnectedAccount.query()
        .where('id', accountId)
        .where('user_id', user.id)
        .firstOrFail()

      connectedAccount.displayName = displayName
      await connectedAccount.save()

      const isApiRequest = request.header('Accept')?.includes('application/json')
      if (isApiRequest) {
        return {
          success: true,
          message: 'Account name updated successfully',
          account: connectedAccount
        }
      }

      return response.redirect().back()
    } catch (error) {
      logger.error('Error updating account name:', error)

      const isApiRequest = request.header('Accept')?.includes('application/json')
      if (isApiRequest) {
        return response.badRequest({
          error: 'Failed to update account name',
          message: error.message
        })
      }

      return response.redirect().back()
    }
  }

  async getSyncStatus({ params, auth, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const connectedAccount = await ConnectedAccount.query()
        .where('id', params.id)
        .where('user_id', user.id)
        .firstOrFail()

      // Check if there's any campaign data
      const campaignDataCount = await CampaignData.query()
        .where('connected_account_id', connectedAccount.id)
        .count('* as total')

      const hasData = campaignDataCount[0].$extras.total > 0
      
      return {
        success: true,
        account: {
          id: connectedAccount.id,
          accountId: connectedAccount.accountId,
          formattedAccountId: connectedAccount.formattedAccountId,
          accountName: connectedAccount.accountName,
          displayName: connectedAccount.displayName,
          isActive: connectedAccount.isActive,
          isTestAccount: connectedAccount.isTestAccount,
          isManagerAccount: connectedAccount.isManagerAccount,
          lastSyncAt: connectedAccount.lastSyncAt,
          hasData,
          dataCount: campaignDataCount[0].$extras.total
        }
      }
    } catch (error) {
      logger.error('Error getting sync status:', error)
      return response.badRequest({
        error: 'Failed to get sync status',
        message: error.message
      })
    }
  }

  async getAccessibleCustomers({ auth, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()

      // Get all Google Ads connected accounts for this user
      const connectedAccounts = await ConnectedAccount.query()
        .where('user_id', user.id)
        .where('platform', 'google_ads')
        .orderBy('created_at', 'desc')

      if (connectedAccounts.length === 0) {
        return response.badRequest({
          error: 'No connected accounts found',
          message: 'Please connect a Google Ads account first'
        })
      }

      // Use the first account to get accessible customers
      const firstAccount = connectedAccounts[0]
      const accessibleCustomers = await googleAdsService.getAccessibleCustomers(
        firstAccount.id,
        user.id
      )

      return {
        success: true,
        data: accessibleCustomers,
        connectedAccounts: connectedAccounts.map((account) => ({
          id: account.id,
          accountId: account.accountId,
          formattedAccountId: account.formattedAccountId,
          accountName: account.accountName,
          displayName: account.displayName,
          isActive: account.isActive,
          isTestAccount: account.isTestAccount,
          isManagerAccount: account.isManagerAccount,
        })),
      }
    } catch (error) {
      logger.error('Error fetching accessible customers:', error)
      return response.badRequest({
        error: 'Failed to fetch accessible customers',
        message: error.message
      })
    }
  }
}