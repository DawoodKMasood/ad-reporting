import type { HttpContext } from '@adonisjs/core/http'
import ConnectedAccount from '#models/connected_account'
import { connectValidator, disconnectValidator, syncValidator } from '#validators/integrations'
import logger from '@adonisjs/core/services/logger'
import googleAdsService from '#services/google_ads_service'

export default class IntegrationsController {
  /**
   * Display a list of available ad platforms and user's connected accounts
   */
  async index({ view, auth }: HttpContext) {
    const user = auth.getUserOrFail()
    
    // Get all connected accounts for the user
    const connectedAccounts = await ConnectedAccount.query()
      .where('user_id', user.id)
      .orderBy('created_at', 'desc')
    
    // Available platforms (could be moved to a config file)
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

  /**
   * Display details of a specific connected account
   */
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

  /**
   * Initiate OAuth2 flow for a specific platform (starting with Google Ads)
   */
  async connect({ request, auth, response, session }: HttpContext) {
    try {
      logger.info('Initiating OAuth2 flow', {
        method: request.method(),
        url: request.url(),
        headers: request.headers()
      })
      
      const user = auth.getUserOrFail()
      logger.info('User authenticated', { userId: user.id })
      
      const payload = await request.validateUsing(connectValidator)
      logger.info('Validation passed', { payload })
      
      // For now, we only support Google Ads
      if (payload.platform !== 'google_ads') {
        logger.warn('Unsupported platform requested', { platform: payload.platform })
        // Check if it's an API request
        const isApiRequest = request.header('Accept')?.includes('application/json') ||
          request.header('Content-Type')?.includes('application/json')
        
        if (isApiRequest) {
          return response.badRequest({
            error: 'Unsupported platform',
            message: `Platform ${payload.platform} is not supported`,
          })
        } else {
          // For web requests, redirect back with error
          return response.redirect().back()
        }
      }
      
      // Import the Google Ads OAuth service
      const googleAdsOAuthService = await import('#services/google_ads_oauth_service')
      
      // Generate OAuth2 URL with proper state parameter
      const state = `${user.id}-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`
      logger.info('Generating auth URL with state', { state })
      
      // Store state in session for security verification
      session.put('oauth_state', state)
      
      // Generate the authorization URL using the Google Ads OAuth service
      const authUrl = googleAdsOAuthService.default.generateAuthUrl(user.id, state)
      logger.info('Generated auth URL', { authUrl })
      
      // Return JSON for API requests or redirect for web requests
      const isApiRequest = request.header('Accept')?.includes('application/json') ||
        request.header('Content-Type')?.includes('application/json')
      logger.info('Request type detection', { isApiRequest, accept: request.header('Accept'), contentType: request.header('Content-Type') })
      
      if (isApiRequest) {
        logger.info('Returning JSON response for API request')
        return {
          success: true,
          redirectUrl: authUrl,
          message: 'OAuth2 flow initiated successfully',
        }
      }
      
      logger.info('Redirecting to Google auth URL for web request')
      return response.redirect().toPath(authUrl)
    } catch (error) {
      logger.error('Error initiating OAuth2 flow:', error)
      
      const isApiRequest = request.header('Accept')?.includes('application/json') ||
        request.header('Content-Type')?.includes('application/json')
      if (isApiRequest) {
        return response.badRequest({
          error: 'Validation failed',
          message: error.messages,
        })
      }
      
      // For web requests, redirect back with error
      return response.redirect().back()
    }
  }

  /**
   * Handle OAuth2 callback from ad platforms
   */
  async callback({ request, auth, response, session, params }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const { code, state } = request.qs()
      const { platform } = params
      
      logger.info('OAuth2 callback received', { code: !!code, state, platform })
      
      // Verify the state parameter to prevent CSRF attacks
      const storedState = session.get('oauth_state')
      logger.info('Verifying state parameter', { storedState, receivedState: state })
      
      if (!state || state !== storedState) {
        logger.error('Invalid state parameter', { storedState, receivedState: state })
        return response.badRequest({
          error: 'Invalid state parameter',
          message: 'The state parameter does not match. Possible CSRF attack.'
        })
      }
      
      // Clear the state from session
      session.forget('oauth_state')
      
      // Exchange the authorization code for access/refresh tokens
      if (!code) {
        logger.error('Missing authorization code')
        return response.badRequest({
          error: 'Missing authorization code',
          message: 'Authorization code is required to complete the connection'
        })
      }
      
      // For now, we only support Google Ads
      if (platform !== 'google_ads') {
        logger.error('Unsupported platform in callback', { platform })
        return response.badRequest({
          error: 'Unsupported platform',
          message: `Platform ${platform} is not supported`
        })
      }
      
      // Import the Google Ads OAuth service
      const googleAdsOAuthService = await import('#services/google_ads_oauth_service')
      
      // Exchange code for tokens
      logger.info('Exchanging code for tokens')
      const tokens = await googleAdsOAuthService.default.exchangeCodeForTokens(code)
      logger.info('Tokens received', {
        hasAccessToken: !!tokens.accessToken,
        hasRefreshToken: !!tokens.refreshToken,
        expiryDate: tokens.expiryDate
      })
      
      // For Google Ads, we need to get the account ID
      // In a real implementation, we would fetch the customer list from Google Ads API
      // For now, we'll use a mock account ID
      const accountId = `google_ads_account_${Date.now()}`
      logger.info('Using mock account ID', { accountId })
      
      // Store the tokens securely in the database
      logger.info('Storing tokens in database')
      const connectedAccount = await googleAdsOAuthService.default.storeTokens(
        user.id,
        accountId,
        tokens.accessToken,
        tokens.refreshToken,
        tokens.expiryDate
      )
      logger.info('Tokens stored successfully', { connectedAccountId: connectedAccount.id })
      
      const isApiRequest = request.header('Accept')?.includes('application/json')
      if (isApiRequest) {
        return {
          success: true,
          account: connectedAccount,
          message: 'Account connected successfully'
        }
      }
      
      // For web requests, redirect to integrations page
      logger.info('Redirecting to integrations index')
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
      
      // For web requests, redirect back with error
      return response.redirect().toRoute('integrations.index')
    }
  }

  /**
   * Disconnect a connected account
   */
  async disconnect({ params, request, auth, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const payload = await request.validateUsing(disconnectValidator)
      
      // Get ID from payload or route params
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
      
      // For web requests, redirect back
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
      
      // For web requests, redirect back with error
      return response.redirect().back()
    }
  }

  /**
   * Manually sync data from a connected account
   */
  async sync({ params, request, auth, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const payload = await request.validateUsing(syncValidator)
      
      // Get ID from payload or route params
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
      
      // Sync data using the Google Ads service with rate limiting
      const enrichedData = await googleAdsService.getEnrichedCampaignData(
        connectedAccount.id,
        user.id, // Pass user ID for rate limiting
        { type: 'last_7_days' }
      )
      
      logger.info(`Synced data for account ${connectedAccount.id} (${connectedAccount.platform})`)
      
      const isApiRequest = request.header('Accept')?.includes('application/json')
      if (isApiRequest) {
        return {
          success: true,
          message: 'Data sync completed successfully',
          account: connectedAccount,
          dataCount: enrichedData.length
        }
      }
      
      // For web requests, redirect back
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
      
      // For web requests, redirect back with error
      return response.redirect().back()
    }
  }
}