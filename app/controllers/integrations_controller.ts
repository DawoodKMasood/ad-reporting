import type { HttpContext } from '@adonisjs/core/http'
import ConnectedAccount from '#models/connected_account'
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
      availablePlatforms
    })
  }

  async show({ params, auth, response, view }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      
      const connectedAccount = await ConnectedAccount.query()
        .where('id', params.id)
        .where('user_id', user.id)
        .firstOrFail()
      
      return view.render('pages/integrations/show', {
        user,
        connectedAccount
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
          message: error.messages,
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
      
      const accountId = payload.id || parseInt(params.id, 10)
      
      if (!accountId || isNaN(accountId)) {
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
      
      const accountId = payload.id || parseInt(params.id, 10)
      
      if (!accountId || isNaN(accountId)) {
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
      
      const isApiRequest = request.header('Accept')?.includes('application/json')
      if (isApiRequest) {
        return response.badRequest({
          error: 'Failed to sync data',
          message: error.message
        })
      }
      
      return response.redirect().back()
    }
  }

  async updateAccountName({ params, request, auth, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const { displayName } = request.body()
      
      const accountId = parseInt(params.id, 10)
      
      if (!accountId || isNaN(accountId)) {
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
      const accessibleCustomers = await googleAdsService.getAccessibleCustomers(firstAccount.id, user.id)
      
      return {
        success: true,
        data: accessibleCustomers,
        connectedAccounts: connectedAccounts.map(account => ({
          id: account.id,
          accountId: account.accountId,
          formattedAccountId: account.formattedAccountId,
          accountName: account.accountName,
          displayName: account.displayName,
          isActive: account.isActive,
          isTestAccount: account.isTestAccount,
          isManagerAccount: account.isManagerAccount
        }))
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
