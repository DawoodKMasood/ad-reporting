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
      logger.info('Code exchange successful')
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

  public async getAccessibleCustomers(accessToken: string, refreshToken: string): Promise<Array<{customerId: string, resourceName: string}>> {
    console.log('🔍 Starting getAccessibleCustomers with tokens:', {
      hasAccessToken: !!accessToken,
      hasRefreshToken: !!refreshToken,
      accessTokenLength: accessToken?.length,
      refreshTokenLength: refreshToken?.length,
      developerToken: env.get('GOOGLE_ADS_DEVELOPER_TOKEN')?.substring(0, 10) + '...'
    })

    try {
      logger.info('Attempting to get accessible customers from Google Ads API')

      // Validate tokens
      if (!accessToken || !refreshToken) {
        throw new Error('Both access token and refresh token are required')
      }

      // Create GoogleAdsApi client with only basic auth credentials
      const client = new GoogleAdsApi({
        client_id: env.get('GOOGLE_ADS_CLIENT_ID'),
        client_secret: env.get('GOOGLE_ADS_CLIENT_SECRET'),
        developer_token: env.get('GOOGLE_ADS_DEVELOPER_TOKEN'),
      })

      logger.info('GoogleAdsApi client created with config')
      console.log('🔄 Created GoogleAdsApi client, attempting to list accessible customers...')

      // Call listAccessibleCustomers with refresh token as parameter
      const accessibleCustomers = await client.listAccessibleCustomers(refreshToken)

      console.log('📊 listAccessibleCustomers result:', accessibleCustomers)

      if (!accessibleCustomers || !accessibleCustomers.resource_names || accessibleCustomers.resource_names.length === 0) {
        throw new Error('No accessible customers found. Make sure you have at least one Google Ads account associated with your Google account.')
      }

      // Extract all customer IDs
      const customers = accessibleCustomers.resource_names.map(resourceName => {
        const customerId = resourceName.split('/')[1]
        
        if (!/^\d{10}$/.test(customerId)) {
          console.warn(`Invalid customer ID format: ${customerId}, skipping`)
          return null
        }

        return {
          customerId,
          resourceName
        }
      }).filter(Boolean) as Array<{customerId: string, resourceName: string}>

      console.log('✅ Accessible customers retrieved successfully:', customers.map(c => c.customerId))
      return customers

    } catch (error: any) {
      console.error('❌ Error in getAccessibleCustomers:', {
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
      
      logger.error('Error in getAccessibleCustomers', error)
      
      // Provide specific error messages based on the error type
      const errorMessage = error?.message || error?.toString() || 'Unknown error'
      
      if (errorMessage.includes('No access, refresh token, API key or refresh handler callback is set')) {
        throw new Error(`Google Ads API authentication failed. Please ensure:

1. Your Google Ads developer token is valid and approved.
2. The OAuth2 tokens are properly configured.
3. The Google Ads API is enabled in your Google Cloud Project.
4. Your Google account has access to Google Ads accounts.

Current configuration:
- Developer Token: ${env.get('GOOGLE_ADS_DEVELOPER_TOKEN') ? 'Present' : 'Missing'}
- Client ID: ${env.get('GOOGLE_ADS_CLIENT_ID') ? 'Present' : 'Missing'}
- Client Secret: ${env.get('GOOGLE_ADS_CLIENT_SECRET') ? 'Present' : 'Missing'}
- Access Token: ${accessToken ? 'Present' : 'Missing'}
- Refresh Token: ${refreshToken ? 'Present' : 'Missing'}`)
      }
      
      if (errorMessage.includes('invalid_request') || errorMessage.includes('Getting metadata from plugin failed')) {
        throw new Error(`Google Ads API authentication failed. This is likely due to:

1. The Google Ads API not being enabled in your Google Cloud Project.
2. Your developer token not having the necessary permissions to access the Google Ads API.
3. Invalid or expired OAuth2 credentials.

Please ensure that:
- The Google Ads API is enabled in your Google Cloud Console.
- Your developer token is approved and active.
- The authenticated Google account has access to Google Ads accounts.`)
      }
      
      if (errorMessage.includes('Google Ads API has not been used in project') || 
          errorMessage.includes('is disabled')) {
        throw new Error(`Google Ads API is not enabled in your Google Cloud Project. Please:

1. Go to Google Cloud Console
2. Enable the Google Ads API
3. Wait a few minutes for the changes to take effect
4. Try connecting your account again`)
      }

      throw new Error(`Failed to retrieve accessible customers: ${errorMessage}`)
    }
  }

  public async getCustomerId(accessToken: string, refreshToken: string): Promise<string> {
    const customers = await this.getAccessibleCustomers(accessToken, refreshToken)
    if (customers.length === 0) {
      throw new Error('No accessible customers found')
    }
    return customers[0].customerId
  }

  public async refreshAccessToken(refreshToken: string) {
    try {
      this.oauth2Client.setCredentials({ refresh_token: refreshToken })
      const { credentials } = await this.oauth2Client.refreshAccessToken()
      logger.info('Access token refreshed')
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

  public async getCustomerInfo(customerId: string, refreshToken: string): Promise<{
    name: string,
    timezone: string,
    isTestAccount: boolean,
    isManagerAccount: boolean,
    parentAccountId?: string
  }> {
    try {
      const client = new GoogleAdsApi({
        client_id: env.get('GOOGLE_ADS_CLIENT_ID'),
        client_secret: env.get('GOOGLE_ADS_CLIENT_SECRET'),
        developer_token: env.get('GOOGLE_ADS_DEVELOPER_TOKEN'),
      })

      const customer = client.Customer({
        customer_id: customerId,
        refresh_token: refreshToken,
      })

      const customerInfo = await customer.report({
        entity: 'customer',
        attributes: [
          'customer.descriptive_name',
          'customer.time_zone',
          'customer.test_account',
          'customer.manager'
        ]
      })

      if (customerInfo.length === 0) {
        throw new Error(`Customer info not found for ID: ${customerId}`)
      }

      const info = customerInfo[0]
      const isManager = info.customer?.manager || false
      
      console.log(`📋 Customer ${customerId} info:`, {
        name: info.customer?.descriptive_name,
        isManager,
        isTest: info.customer?.test_account
      })
      
      return {
        name: info.customer?.descriptive_name || `Account ${customerId}`,
        timezone: info.customer?.time_zone || 'UTC',
        isTestAccount: info.customer?.test_account || false,
        isManagerAccount: isManager
      }
    } catch (error: any) {
      console.warn('Could not fetch customer info:', error.message)
      // For safety, assume it might be a manager account if we can't determine
      return {
        name: `Account ${customerId}`,
        timezone: 'UTC',
        isTestAccount: false,
        isManagerAccount: false
      }
    }
  }

  public async storeTokensForAllCustomers(
    userId: number,
    accessToken: string,
    refreshToken: string,
    expiresAt?: DateTime | null
  ): Promise<ConnectedAccount[]> {
    try {
      if (!refreshToken) {
        throw new Error('Refresh token required to fetch customers')
      }

      console.log('🔍 Fetching all accessible customers from Google Ads API...')
      const customers = await this.getAccessibleCustomers(accessToken, refreshToken)
      console.log('✅ Retrieved customers:', customers.map(c => c.customerId))
      
      const encryptedAccessToken = encryptionService.encrypt(accessToken)
      const encryptedRefreshToken = encryptionService.encrypt(refreshToken)
      const accessTokenHash = encryptionService.hashData(accessToken)
      const refreshTokenHash = encryptionService.hashData(refreshToken)
      
      const connectedAccounts: ConnectedAccount[] = []
      
      // Store accessible customers list for reference
      const accessibleCustomerIds = customers.map(c => c.customerId)
      
      for (const customer of customers) {
        console.log(`🔍 Getting info for customer ${customer.customerId}...`)
        const customerInfo = await this.getCustomerInfo(customer.customerId, refreshToken)
        
        let connectedAccount = await ConnectedAccount.query()
          .where('user_id', userId)
          .where('platform', 'google_ads' as const)
          .where('account_id', customer.customerId)
          .first()
        
        const accountData = {
          userId,
          platform: 'google_ads' as const,
          accountId: customer.customerId,
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
          accessTokenHash,
          refreshTokenHash,
          expiresAt: expiresAt || null,
          isActive: true,
          accessibleCustomers: JSON.stringify(accessibleCustomerIds),
          accountName: customerInfo.name,
          accountTimezone: customerInfo.timezone,
          isTestAccount: customerInfo.isTestAccount,
          isManagerAccount: customerInfo.isManagerAccount
        }
        
        if (connectedAccount) {
          await connectedAccount.merge(accountData).save()
        } else {
          connectedAccount = await ConnectedAccount.create(accountData)
        }
        
        connectedAccounts.push(connectedAccount)
        console.log('✅ Tokens stored successfully for accountId:', customer.customerId)
        
        // If this is a manager account, try to sync child account data immediately
        if (customerInfo.isManagerAccount) {
          console.log(`📊 Manager account detected, will sync child accounts during first data fetch`)
        }
      }
      
      logger.info('Tokens stored successfully for all customers', { 
        customerIds: customers.map(c => c.customerId), 
        userId 
      })
      return connectedAccounts
    } catch (error: any) {
      console.error('❌ Store tokens error:', error)
      logger.error('Error storing tokens for all customers', error)
      throw new Error(`Failed to store tokens: ${error.message || 'Unknown error'}`)
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
        .where('platform', 'google_ads' as const)
        .where('account_id', accountId)
        .first()
      
      const accountData = {
        userId,
        platform: 'google_ads' as const,
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
    
    // Create GoogleAdsApi client with only basic credentials
    const client = new GoogleAdsApi({
      client_id: env.get('GOOGLE_ADS_CLIENT_ID'),
      client_secret: env.get('GOOGLE_ADS_CLIENT_SECRET'),
      developer_token: env.get('GOOGLE_ADS_DEVELOPER_TOKEN'),
    })
    
    return {
      client,
      refreshToken // Return refresh token to be used in Customer() calls
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
    return !!(data && !data.startsWith('ya29.') && !data.startsWith('1//') &&
           !data.includes(' ') && data.length > 100 && /^[A-Za-z0-9+/=]+$/.test(data));
  }

  private generateStateParameter(userId: number): string {
    return `${userId}-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`
  }
}

export default new GoogleAdsOAuthService()
