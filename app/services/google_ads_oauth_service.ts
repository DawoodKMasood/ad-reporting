import { google } from 'googleapis'
import { GoogleAdsApi } from 'google-ads-api'
import env from '#start/env'
import ConnectedAccount from '#models/connected_account'
import encryptionService from './encryption_service.js'
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'
import securityMonitoringService from '#services/security_monitoring_service'

const revokedTokens: Set<string> = new Set()
const tokenAccessAttempts: Map<string, { count: number; timestamp: number }> = new Map()

export class GoogleAdsOAuthService {
  private oauth2Client: any
  private static readonly MAX_ACCESS_ATTEMPTS = 5
  private static readonly ACCESS_WINDOW_MS = 60000

  constructor() {
    const redirectUri = this.buildRedirectUri()
    
    this.oauth2Client = new google.auth.OAuth2(
      env.get('GOOGLE_ADS_CLIENT_ID'),
      env.get('GOOGLE_ADS_CLIENT_SECRET'),
      redirectUri
    )
  }

  private buildRedirectUri(): string {
    const appUrl = env.get('APP_URL')
    const nodeEnv = env.get('NODE_ENV')
    const host = env.get('HOST')
    const port = env.get('PORT')
    
    if (appUrl) {
      return `${appUrl}/integrations/callback/google_ads`
    }
    
    const protocol = nodeEnv === 'development' ? 'http' : 'https'
    const portSuffix = port && port !== 80 && port !== 443 ? `:${port}` : ''
    return `${protocol}://${host}${portSuffix}/integrations/callback/google_ads`
  }

  public generateAuthUrl(userId: number, state?: string): string {
    const stateParam = state || this.generateStateParameter(userId)
    
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/adwords'],
      state: stateParam,
      prompt: 'consent',
    })
  }

  public async exchangeCodeForTokens(code: string) {
    try {
      const { tokens } = await this.oauth2Client.getToken(code)
      
      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || null,
        expiryDate: tokens.expiry_date ? DateTime.fromMillis(tokens.expiry_date) : null,
      }
    } catch (error: any) {
      console.error('❌ Exchange code error:', error)
      logger.error('Error exchanging code for tokens:', error)
      throw new Error(`Failed to exchange code for tokens: ${error.message || 'Unknown error'}`)
    }
  }

  public async getCustomerId(accessToken: string, refreshToken: string): Promise<string> {
    console.log('🔍 Starting getCustomerId with tokens:', {
      hasAccessToken: !!accessToken,
      hasRefreshToken: !!refreshToken,
      accessTokenLength: accessToken?.length,
      refreshTokenLength: refreshToken?.length,
      developerToken: env.get('GOOGLE_ADS_DEVELOPER_TOKEN')?.substring(0, 10) + '...'
    })

    try {
      logger.info('Attempting to get customer ID from Google Ads API')

      // Validate tokens
      if (!accessToken || !refreshToken) {
        throw new Error('Both access token and refresh token are required')
      }

      // Set up OAuth2 client with the refresh token
      this.oauth2Client.setCredentials({
        access_token: accessToken,
        refresh_token: refreshToken
      })

      // Create GoogleAdsApi client with OAuth2 authentication
      const client = new GoogleAdsApi({
        client_id: env.get('GOOGLE_ADS_CLIENT_ID'),
        client_secret: env.get('GOOGLE_ADS_CLIENT_SECRET'),
        developer_token: env.get('GOOGLE_ADS_DEVELOPER_TOKEN'),
      })

      console.log('🔄 Created GoogleAdsApi client, attempting to list accessible customers...')

      // Use the OAuth2 client as auth for the Google Ads API call
      const accessibleCustomers = await client.listAccessibleCustomers({
        auth: this.oauth2Client
      })

      console.log('📊 listAccessibleCustomers result:', accessibleCustomers)

      if (!accessibleCustomers || !accessibleCustomers.resource_names || accessibleCustomers.resource_names.length === 0) {
        throw new Error('No accessible customers found. Make sure you have at least one Google Ads account associated with your Google account.')
      }

      // Extract customer ID from the first resource name
      const resourceName = accessibleCustomers.resource_names[0]
      const customerId = resourceName.split('/')[1]
      
      if (!/^\d{10}$/.test(customerId)) {
        throw new Error(`Invalid customer ID format: ${customerId}`)
      }

      console.log('✅ Customer ID retrieved successfully:', customerId)
      return customerId

    } catch (error: any) {
      console.error('❌ Error in getCustomerId:', {
        message: error?.message,
        stack: error?.stack,
        code: error?.code,
        status: error?.status,
        name: error?.name,
        details: error?.details,
        response: error?.response,
        toString: error?.toString(),
        fullError: error
      })
      
      logger.error('Error in getCustomerId', error)
      
      // Provide specific error messages based on the error type
      const errorMessage = error?.message || error?.toString() || 'Unknown error'
      
      if (errorMessage.includes('invalid_request') || errorMessage.includes('Getting metadata from plugin failed')) {
        throw new Error(`Google Ads API authentication failed. This could be due to:

1. Google Ads API not enabled in your Google Cloud Project
2. Invalid or expired OAuth2 credentials
3. Missing Google Ads developer token permissions
4. No Google Ads accounts associated with the authenticated user

Please ensure:
- Google Ads API is enabled in your Google Cloud Console
- Your developer token is approved and active
- The authenticated Google account has access to Google Ads accounts`)
      }
      
      if (errorMessage.includes('Google Ads API has not been used in project') || 
          errorMessage.includes('is disabled')) {
        throw new Error(`Google Ads API is not enabled in your Google Cloud Project. Please:

1. Go to Google Cloud Console
2. Enable the Google Ads API
3. Wait a few minutes for the changes to take effect
4. Try connecting your account again`)
      }

      throw new Error(`Failed to retrieve customer ID: ${errorMessage}`)
    }
  }

  public async refreshAccessToken(refreshToken: string) {
    try {
      this.oauth2Client.setCredentials({ refresh_token: refreshToken })
      const { credentials } = await this.oauth2Client.refreshAccessToken()
      
      return {
        accessToken: credentials.access_token,
        expiryDate: credentials.expiry_date ? DateTime.fromMillis(credentials.expiry_date) : null,
      }
    } catch (error: any) {
      console.error('❌ Refresh token error:', error)
      logger.error('Error refreshing access token', error)
      
      if (error.message?.includes('invalid_grant')) {
        throw new Error('Refresh token expired. Please reconnect account')
      }
      
      throw new Error(`Failed to refresh access token: ${error.message || 'Unknown error'}`)
    }
  }

  public async storeTokens(
    userId: number,
    accountId: string | null = null,
    accessToken: string,
    refreshToken?: string | null,
    expiresAt?: DateTime | null
  ): Promise<ConnectedAccount> {
    try {
      if (!accountId) {
        if (!refreshToken) {
          throw new Error('Refresh token required to fetch customer ID')
        }
        console.log('🔍 No accountId provided, fetching from Google Ads API...')
        accountId = await this.getCustomerId(accessToken, refreshToken)
        console.log('✅ Retrieved accountId:', accountId)
      }
      
      const encryptedAccessToken = encryptionService.encrypt(accessToken)
      const encryptedRefreshToken = refreshToken ? encryptionService.encrypt(refreshToken) : null
      const accessTokenHash = encryptionService.hashData(accessToken)
      const refreshTokenHash = refreshToken ? encryptionService.hashData(refreshToken) : null
      
      let connectedAccount = await ConnectedAccount.query()
        .where('user_id', userId)
        .where('platform', 'google_ads')
        .where('account_id', accountId)
        .first()
      
      const accountData = {
        userId,
        platform: 'google_ads',
        accountId,
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        accessTokenHash,
        refreshTokenHash,
        expiresAt: expiresAt || null,
        isActive: true,
      }
      
      if (connectedAccount) {
        await connectedAccount.merge(accountData).save()
      } else {
        connectedAccount = await ConnectedAccount.create(accountData)
      }
      
      console.log('✅ Tokens stored successfully for accountId:', accountId)
      logger.info('Tokens stored successfully', { accountId, userId })
      return connectedAccount
    } catch (error: any) {
      console.error('❌ Store tokens error:', error)
      logger.error('Error storing tokens', error)
      throw new Error(`Failed to store tokens: ${error.message || 'Unknown error'}`)
    }
  }

  public async retrieveTokens(connectedAccountId: number, userId?: number) {
    try {
      if (userId && this.shouldRateLimit(userId)) {
        throw new Error('Rate limit exceeded for token access')
      }
      
      const connectedAccount = await ConnectedAccount.findOrFail(connectedAccountId)
      
      if (!connectedAccount.accessToken) {
        throw new Error('No access token found. Please reconnect account')
      }
      
      if (connectedAccount.accessTokenHash && this.isTokenRevoked(connectedAccount.accessTokenHash)) {
        throw new Error('Access token revoked. Please reconnect account')
      }
      
      let accessToken = this.decryptIfNeeded(connectedAccount.accessToken)
      let refreshToken = connectedAccount.refreshToken ? this.decryptIfNeeded(connectedAccount.refreshToken) : null
      
      if (connectedAccount.isTokenExpired && refreshToken) {
        const refreshedTokens = await this.refreshAccessToken(refreshToken)
        
        await this.storeTokens(
          connectedAccount.userId,
          connectedAccount.accountId,
          refreshedTokens.accessToken,
          refreshToken,
          refreshedTokens.expiryDate
        )
        
        accessToken = refreshedTokens.accessToken
      }
      
      return { accessToken, refreshToken }
    } catch (error: any) {
      console.error('❌ Retrieve tokens error:', error)
      logger.error('Error retrieving tokens', error)
      throw new Error(`Failed to retrieve tokens: ${error.message || 'Unknown error'}`)
    }
  }

  public async getAuthenticatedClient(connectedAccountId: number, userId?: number) {
    const { accessToken, refreshToken } = await this.retrieveTokens(connectedAccountId, userId)
    
    this.oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
    })
    
    return this.oauth2Client
  }

  public async getGoogleAdsClient(connectedAccountId: number, userId?: number) {
    const { accessToken, refreshToken } = await this.retrieveTokens(connectedAccountId, userId)
    
    if (!refreshToken) {
      throw new Error('Refresh token required for Google Ads API access')
    }
    
    // Set up OAuth2 client
    const oauthClient = new google.auth.OAuth2(
      env.get('GOOGLE_ADS_CLIENT_ID'),
      env.get('GOOGLE_ADS_CLIENT_SECRET')
    )
    
    oauthClient.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken
    })
    
    return {
      client: new GoogleAdsApi({
        client_id: env.get('GOOGLE_ADS_CLIENT_ID'),
        client_secret: env.get('GOOGLE_ADS_CLIENT_SECRET'),
        developer_token: env.get('GOOGLE_ADS_DEVELOPER_TOKEN'),
      }),
      auth: oauthClient
    }
  }

  public isTokenRevoked(tokenHash: string): boolean {
    return revokedTokens.has(tokenHash)
  }

  public revokeToken(tokenHash: string): void {
    revokedTokens.add(tokenHash)
    securityMonitoringService.logSecurityEvent('token_revoked', { tokenHash })
  }

  public shouldRateLimit(userId: number): boolean {
    const key = `token_access_${userId}`
    const now = Date.now()
    const attempt = tokenAccessAttempts.get(key)
    
    if (!attempt || now - attempt.timestamp > GoogleAdsOAuthService.ACCESS_WINDOW_MS) {
      tokenAccessAttempts.set(key, { count: 1, timestamp: now })
      return false
    }
    
    attempt.count++
    tokenAccessAttempts.set(key, attempt)
    
    if (attempt.count > GoogleAdsOAuthService.MAX_ACCESS_ATTEMPTS) {
      securityMonitoringService.logSecurityEvent('token_access_rate_limit_exceeded', { userId, attempts: attempt.count })
      return true
    }
    
    return false
  }

  private decryptIfNeeded(data: string): string {
    if (this.looksEncrypted(data)) {
      return encryptionService.decrypt(data)
    }
    return data
  }

  private looksEncrypted(data: string): boolean {
    return data && !data.startsWith('ya29.') && !data.startsWith('1//') && 
           !data.includes(' ') && data.length > 100 && /^[A-Za-z0-9+/=]+$/.test(data)
  }

  private generateStateParameter(userId: number): string {
    return `${userId}-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`
  }
}

export default new GoogleAdsOAuthService()
