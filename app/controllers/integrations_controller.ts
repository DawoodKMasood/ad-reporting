import type { HttpContext } from '@adonisjs/core/http'
import ConnectedAccount from '#models/connected_account'
import { connectValidator, disconnectValidator, syncValidator } from '#validators/integrations'
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'
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
  async connect({ request, auth, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const payload = await request.validateUsing(connectValidator)
      
      // For now, we only support Google Ads
      if (payload.platform !== 'google_ads') {
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
      
      // In a real implementation, we would:
      // 1. Generate OAuth2 URL with proper state parameter
      // 2. Redirect user to the OAuth2 provider
      // 3. Store state in session for security verification
      
      // For this implementation, we'll return a mock URL
      // In a real app, this would be generated using the OAuth2 client
      const mockAuthUrl = `/oauth/${payload.platform}?user_id=${user.id}&redirect_uri=/integrations/callback`
      
      // Return JSON for API requests or redirect for web requests
      const isApiRequest = request.header('Accept')?.includes('application/json') ||
        request.header('Content-Type')?.includes('application/json')
      if (isApiRequest) {
        return {
          success: true,
          redirectUrl: mockAuthUrl,
          message: 'OAuth2 flow initiated successfully',
        }
      }
      
      return response.redirect().toPath(mockAuthUrl)
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
  async callback({ request, auth, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const { code, state, platform } = request.qs()
      
      // In a real implementation, we would:
      // 1. Verify the state parameter to prevent CSRF attacks
      // 2. Exchange the authorization code for access/refresh tokens
      // 3. Store the tokens securely in the database
      // 4. Fetch account information from the platform
      
      // For this implementation, we'll simulate the process
      if (!code) {
        return response.badRequest({ 
          error: 'Missing authorization code',
          message: 'Authorization code is required to complete the connection'
        })
      }
      
      // Mock account creation
      const connectedAccount = await ConnectedAccount.create({
        userId: user.id,
        platform: platform || 'google_ads',
        accountId: `mock_account_${Date.now()}`,
        refreshToken: 'mock_refresh_token',
        accessToken: 'mock_access_token',
        isActive: true
      })
      
      const isApiRequest = request.header('Accept')?.includes('application/json')
      if (isApiRequest) {
        return {
          success: true,
          account: connectedAccount,
          message: 'Account connected successfully'
        }
      }
      
      // For web requests, redirect to integrations page
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
      
      const connectedAccount = await ConnectedAccount.query()
        .where('id', payload.id || params.id)
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
      
      const connectedAccount = await ConnectedAccount.query()
        .where('id', payload.id || params.id)
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