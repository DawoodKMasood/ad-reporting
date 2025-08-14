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
  private googleAdsClient: GoogleAdsApi
  private static readonly MAX_ACCESS_ATTEMPTS = 5
  private static readonly ACCESS_WINDOW_MS = 60000

  constructor() {
    const redirectUri = this.buildRedirectUri()
    
    this.oauth2Client = new google.auth.OAuth2(
      env.get('GOOGLE_ADS_CLIENT_ID'),
      env.get('GOOGLE_ADS_CLIENT_SECRET'),
      redirectUri
    )

    this.googleAdsClient = new GoogleAdsApi({
      client_id: env.get('GOOGLE_ADS_CLIENT_ID'),
      client_secret: env.get('GOOGLE_ADS_CLIENT_SECRET'),
      developer_token: env.get('GOOGLE_ADS_DEVELOPER_TOKEN'),
    })
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

      let lastError: any = null

      // Method 1: Use the correct google-ads-api approach
      try {
        console.log('🔄 Method 1: Using correct google-ads-api listAccessibleCustomers...')
        
        // The correct way to use google-ads-api for listing customers
        const customer = this.googleAdsClient.Customer({
          refresh_token: refreshToken
        })

        console.log('📱 Customer client created, calling the correct method...')
        
        // Use the CustomerService to list accessible customers
        const customerService = customer.services.CustomerService
        const request = {}
        
        console.log('📡 Calling CustomerService.listAccessibleCustomers...')
        const accessibleCustomers = await customerService.listAccessibleCustomers(request)
        
        console.log('📊 listAccessibleCustomers result:', accessibleCustomers)

        if (accessibleCustomers && accessibleCustomers.resourceNames && accessibleCustomers.resourceNames.length > 0) {
          const resourceName = accessibleCustomers.resourceNames[0]
          const customerId = resourceName.split('/')[1]
          
          if (!/^\d{10}$/.test(customerId)) {
            throw new Error(`Invalid customer ID format: ${customerId}`)
          }

          console.log('✅ Customer ID retrieved successfully via google-ads-api service:', customerId)
          return customerId
        } else {
          throw new Error('No accessible customers found in response')
        }
      } catch (apiError: any) {
        lastError = apiError
        console.error('❌ Method 1 failed with error:', {
          message: apiError?.message,
          stack: apiError?.stack,
          code: apiError?.code,
          status: apiError?.status,
          name: apiError?.name,
          details: apiError?.details,
          response: apiError?.response,
          toString: apiError?.toString(),
          fullError: apiError
        })
      }

      // Method 2: Try using the customer's listAccessibleCustomers method directly
      try {
        console.log('🔄 Method 2: Trying direct customer method...')
        
        const customer = this.googleAdsClient.Customer({
          refresh_token: refreshToken
        })

        console.log('📱 Customer client created, trying direct method...')
        
        // Check if the customer object has the method
        console.log('🔍 Available customer methods:', Object.getOwnPropertyNames(customer))
        console.log('🔍 Customer prototype methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(customer)))
        
        // Try the direct method if it exists
        if (typeof customer.listAccessibleCustomers === 'function') {
          console.log('📡 Found listAccessibleCustomers method, calling it...')
          const result = await customer.listAccessibleCustomers()
          console.log('📊 Direct method result:', result)
          
          if (result && result.resourceNames && result.resourceNames.length > 0) {
            const resourceName = result.resourceNames[0]
            const customerId = resourceName.split('/')[1]
            
            if (!/^\d{10}$/.test(customerId)) {
              throw new Error(`Invalid customer ID format: ${customerId}`)
            }

            console.log('✅ Customer ID retrieved successfully via direct method:', customerId)
            return customerId
          }
        } else {
          throw new Error('listAccessibleCustomers method not found on customer object')
        }
      } catch (directError: any) {
        lastError = directError
        console.error('❌ Method 2 failed with error:', {
          message: directError?.message,
          stack: directError?.stack,
          code: directError?.code,
          status: directError?.status,
          name: directError?.name,
          details: directError?.details,
          response: directError?.response,
          toString: directError?.toString(),
          fullError: directError
        })
      }

      // Method 3: Use the library's top-level method
      try {
        console.log('🔄 Method 3: Trying top-level library method...')
        
        // Some versions of the library have it at the top level
        console.log('🔍 Available googleAdsClient methods:', Object.getOwnPropertyNames(this.googleAdsClient))
        console.log('🔍 GoogleAdsClient prototype methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(this.googleAdsClient)))
        
        if (typeof this.googleAdsClient.listAccessibleCustomers === 'function') {
          console.log('📡 Found top-level listAccessibleCustomers method...')
          const result = await this.googleAdsClient.listAccessibleCustomers({
            refresh_token: refreshToken
          })
          console.log('📊 Top-level method result:', result)
          
          if (result && result.resourceNames && result.resourceNames.length > 0) {
            const resourceName = result.resourceNames[0]
            const customerId = resourceName.split('/')[1]
            
            if (!/^\d{10}$/.test(customerId)) {
              throw new Error(`Invalid customer ID format: ${customerId}`)
            }

            console.log('✅ Customer ID retrieved successfully via top-level method:', customerId)
            return customerId
          }
        } else {
          throw new Error('No listAccessibleCustomers method found at library level')
        }
      } catch (topLevelError: any) {
        lastError = topLevelError
        console.error('❌ Method 3 failed with error:', {
          message: topLevelError?.message,
          stack: topLevelError?.stack,
          code: topLevelError?.code,
          status: topLevelError?.status,
          name: topLevelError?.name,
          details: topLevelError?.details,
          response: topLevelError?.response,
          toString: topLevelError?.toString(),
          fullError: topLevelError
        })
      }

      // If all google-ads-api methods fail, provide instructions
      console.error('❌ All google-ads-api methods failed.')
      
      // Check if the main error is about API not being enabled
      const lastErrorMessage = lastError?.message || lastError?.toString() || ''
      if (lastErrorMessage.includes('Google Ads API has not been used in project') || 
          lastErrorMessage.includes('is disabled')) {
        throw new Error(`Google Ads API is not enabled in your Google Cloud Project. Please:

1. Go to: https://console.developers.google.com/apis/api/googleads.googleapis.com/overview?project=197707664885
2. Click "Enable API"
3. Wait a few minutes for the changes to take effect
4. Try connecting your account again

Alternative: If you have a different Google Cloud Project, update your OAuth2 credentials to use that project instead.`)
      }

      // For other errors, provide the last error message
      const errorMessage = lastError?.message || lastError?.toString() || 'Unknown error'
      throw new Error(`All methods failed to retrieve customer ID. Error: ${errorMessage}

This could be due to:
1. Google Ads API not enabled in your Google Cloud Project
2. Incorrect API version or library usage
3. Missing permissions or developer token issues
4. No Google Ads accounts associated with the authenticated user`)

    } catch (error: any) {
      console.error('❌ Final error in getCustomerId:', {
        message: error?.message,
        stack: error?.stack,
        code: error?.code,
        status: error?.status,
        name: error?.name,
        toString: error?.toString(),
        fullError: error
      })
      
      logger.error('Final error in getCustomerId', error)
      
      // Re-throw the error as-is since we've already formatted it above
      throw error
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
