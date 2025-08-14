import { google } from 'googleapis'
import env from '#start/env'
import ConnectedAccount from '#models/connected_account'
import encryptionService from './encryption_service.js'
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'
import securityMonitoringService from '#services/security_monitoring_service'
import { GoogleAdsApi } from 'google-ads-api'

// In-memory store for revoked tokens (in production, this should be stored in a database)
const revokedTokens: Set<string> = new Set()

// In-memory store for rate limiting (in production, this should use Redis or similar)
const tokenAccessAttempts: Map<string, { count: number; timestamp: number }> = new Map()

/**
 * Service for handling Google Ads OAuth2 flow
 * 
 * This service manages the OAuth2 authentication flow with Google Ads API,
 * including generating authorization URLs, exchanging authorization codes
 * for access tokens, and refreshing expired access tokens.
 */
export class GoogleAdsOAuthService {
  private oauth2Client: any
  private googleAdsClient: GoogleAdsApi
  private static readonly MAX_ACCESS_ATTEMPTS = 5
  private static readonly ACCESS_WINDOW_MS = 60000 // 1 minute

  constructor() {
    // Initialize the OAuth2 client with credentials from environment variables
    logger.info('Initializing Google Ads OAuth service', {
      clientId: env.get('GOOGLE_ADS_CLIENT_ID'),
      clientSecret: env.get('GOOGLE_ADS_CLIENT_SECRET'),
      appUrl: env.get('APP_URL'),
      host: env.get('HOST'),
      port: env.get('PORT'),
      nodeEnv: env.get('NODE_ENV')
    })
    
    // Construct the redirect URI properly based on environment
    let redirectUri = ''
    
    const appUrl = env.get('APP_URL')
    const nodeEnv = env.get('NODE_ENV')
    const host = env.get('HOST')
    const port = env.get('PORT')
    
    if (appUrl) {
      // Use APP_URL if provided (production)
      redirectUri = `${appUrl}/integrations/callback/google_ads`
    } else if (nodeEnv === 'development' || host === 'localhost' || host === '127.0.0.1') {
      // For development/localhost
      const protocol = 'http'
      const portSuffix = port && port !== 80 && port !== 443 ? `:${port}` : ''
      redirectUri = `${protocol}://${host}${portSuffix}/integrations/callback/google_ads`
    } else {
      // Fallback for production without APP_URL
      const protocol = 'https'
      redirectUri = `${protocol}://${host}/integrations/callback/google_ads`
    }
    
    logger.info('OAuth redirect URI constructed', { redirectUri, appUrl, nodeEnv, host, port })
    
    this.oauth2Client = new google.auth.OAuth2(
      env.get('GOOGLE_ADS_CLIENT_ID'),
      env.get('GOOGLE_ADS_CLIENT_SECRET'),
      redirectUri
    )

    // Initialize Google Ads API client for fetching customer info
    this.googleAdsClient = new GoogleAdsApi({
      client_id: env.get('GOOGLE_ADS_CLIENT_ID'),
      client_secret: env.get('GOOGLE_ADS_CLIENT_SECRET'),
      developer_token: env.get('GOOGLE_ADS_DEVELOPER_TOKEN'),
    })
  }

  /**
   * Generate authorization URL for Google Ads OAuth2 flow
   * 
   * @param userId - The ID of the user initiating the OAuth2 flow
   * @param state - Optional state parameter for security
   * @returns The authorization URL
   */
  public generateAuthUrl(userId: number, state?: string): string {
    // Generate a random state if not provided
    const stateParam = state || this.generateStateParameter(userId)
    
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/adwords'],
      state: stateParam,
      prompt: 'consent',
    })
  }

  /**
   * Exchange authorization code for access and refresh tokens
   * 
   * @param code - The authorization code received from Google
   * @returns Object containing access token, refresh token, and expiry information
   */
  public async exchangeCodeForTokens(code: string): Promise<{
    accessToken: string
    refreshToken: string | null
    expiryDate: DateTime | null
  }> {
    try {
      const { tokens } = await this.oauth2Client.getToken(code)
      
      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || null,
        expiryDate: tokens.expiry_date ? DateTime.fromMillis(tokens.expiry_date) : null,
      }
    } catch (error: any) {
      logger.error('Error exchanging code for tokens:', error)
      throw new Error(`Failed to exchange code for tokens: ${error.message}`)
    }
  }

  /**
   * Get the actual customer ID from Google Ads API using the access token
   * 
   * @param accessToken - The access token to use
   * @param refreshToken - The refresh token to use
   * @returns The customer ID
   */
  public async getCustomerId(accessToken: string, refreshToken: string): Promise<string> {
    try {
      logger.info('Attempting to get customer ID from Google Ads API')
      
      // Create a Google Ads customer client without specifying customer_id for listing
      const customer = this.googleAdsClient.Customer({
        refresh_token: refreshToken
      })

      // Use the CustomerService to list accessible customers
      logger.info('Getting customer service from Google Ads client')
      
      try {
        // Method 1: Try to get accessible customers using the customer service
        const customerService = customer.service.CustomerService
        
        if (customerService && typeof customerService.listAccessibleCustomers === 'function') {
          logger.info('Using CustomerService.listAccessibleCustomers')
          const accessibleCustomers = await customerService.listAccessibleCustomers({})
          
          logger.info('Retrieved accessible customers via CustomerService', {
            count: accessibleCustomers.resourceNames?.length || 0,
            customers: accessibleCustomers.resourceNames
          })

          if (!accessibleCustomers.resourceNames || accessibleCustomers.resourceNames.length === 0) {
            throw new Error('No accessible customers found. Please ensure you have proper access to Google Ads accounts.')
          }

          // Extract customer ID from the first accessible customer resource name
          const firstCustomerResourceName = accessibleCustomers.resourceNames[0]
          const customerId = firstCustomerResourceName.split('/')[1]
          
          if (!customerId || !/^\d{10}$/.test(customerId)) {
            throw new Error('Invalid customer ID format retrieved from Google Ads API')
          }

          logger.info('Customer ID successfully retrieved via CustomerService', { 
            customerId,
            resourceName: firstCustomerResourceName 
          })

          return customerId
        }
      } catch (serviceError: any) {
        logger.warn('CustomerService method failed, trying alternative approach:', serviceError.message)
      }

      // Method 2: Try using the customer object directly with different method names
      const directMethods = [
        'listAccessibleCustomers',
        'getAccessibleCustomers', 
        'accessibleCustomers'
      ]

      for (const methodName of directMethods) {
        try {
          if (customer[methodName] && typeof customer[methodName] === 'function') {
            logger.info(`Trying customer.${methodName}()`)
            const result = await customer[methodName]()
            
            if (result && result.resourceNames && result.resourceNames.length > 0) {
              const firstCustomerResourceName = result.resourceNames[0]
              const customerId = firstCustomerResourceName.split('/')[1]
              
              if (customerId && /^\d{10}$/.test(customerId)) {
                logger.info(`Customer ID retrieved via ${methodName}`, { customerId })
                return customerId
              }
            }
          }
        } catch (methodError: any) {
          logger.debug(`Method ${methodName} failed:`, methodError.message)
        }
      }

      // Method 3: Try to make a simple query to get customer info
      try {
        logger.info('Trying to get customer ID via simple query')
        
        // Try to query customer information without specifying customer_id
        const query = `
          SELECT 
            customer.id,
            customer.descriptive_name
          FROM customer
          LIMIT 1
        `
        
        const result = await customer.query(query)
        
        if (result && result.length > 0 && result[0].customer?.id) {
          const customerId = result[0].customer.id.toString()
          
          if (/^\d{10}$/.test(customerId)) {
            logger.info('Customer ID retrieved via query', { customerId })
            return customerId
          }
        }
      } catch (queryError: any) {
        logger.debug('Query method failed:', queryError.message)
      }

      // Method 4: Use a different Google Ads API client approach
      try {
        logger.info('Trying alternative Google Ads client configuration')
        
        // Create a new client instance with just the refresh token
        const altCustomer = this.googleAdsClient.Customer({
          refresh_token: refreshToken
        })

        // Try to access customer information through the reports interface
        const customerQuery = `
          SELECT customer.id, customer.descriptive_name
          FROM customer
          LIMIT 1
        `

        // Execute without specifying customer_id initially
        const customerResult = await altCustomer.report({
          query: customerQuery,
        })

        if (customerResult && customerResult.length > 0) {
          const customerId = customerResult[0].customer?.id?.toString()
          if (customerId && /^\d{10}$/.test(customerId)) {
            logger.info('Customer ID retrieved via report method', { customerId })
            return customerId
          }
        }
      } catch (altError: any) {
        logger.debug('Alternative client method failed:', altError.message)
      }

      // If all methods fail, provide detailed error information
      throw new Error('Unable to retrieve customer ID using any available method. Please ensure your Google Ads API credentials are correct and you have access to at least one Google Ads account.')

    } catch (error: any) {
      logger.error('Error getting customer ID from Google Ads API:', {
        message: error.message,
        stack: error.stack,
        code: error.code,
        details: error.details
      })
      
      // Provide more specific error messages
      if (error.message?.includes('DEVELOPER_TOKEN_NOT_ON_ALLOWLIST')) {
        throw new Error('Developer token not approved. Please ensure your Google Ads API developer token is approved for production use.')
      }
      
      if (error.message?.includes('PERMISSION_DENIED')) {
        throw new Error('Permission denied. Please ensure you have proper access to Google Ads accounts.')
      }
      
      if (error.message?.includes('invalid_grant')) {
        throw new Error('Invalid authorization. Please try reconnecting your Google Ads account.')
      }
      
      throw new Error(`Failed to get customer ID: ${error.message}`)
    }
  }

  /**
   * Refresh access token using refresh token
   * 
   * @param refreshToken - The refresh token to use for refreshing the access token
   * @returns Object containing new access token and expiry information
   */
  public async refreshAccessToken(refreshToken: string): Promise<{
    accessToken: string
    expiryDate: DateTime | null
  }> {
    try {
      this.oauth2Client.setCredentials({ refresh_token: refreshToken })
      const { credentials } = await this.oauth2Client.refreshAccessToken()
      
      return {
        accessToken: credentials.access_token,
        expiryDate: credentials.expiry_date ? DateTime.fromMillis(credentials.expiry_date) : null,
      }
    } catch (error: any) {
      logger.error('Error refreshing access token:', error)
      
      // Handle specific error cases
      if (error.message?.includes('invalid_grant')) {
        throw new Error('The refresh token has expired or been revoked. Please reconnect your Google Ads account.')
      }
      
      if (error.message?.includes('invalid_client')) {
        throw new Error('Invalid client credentials. Please check your Google Ads API configuration.')
      }
      
      throw new Error(`Failed to refresh access token: ${error.message}`)
    }
  }

  /**
   * Store tokens in the ConnectedAccount model
   * 
   * @param userId - The ID of the user
   * @param accountId - The Google Ads account ID (will be fetched if not provided)
   * @param accessToken - The access token to store
   * @param refreshToken - The refresh token to store (optional)
   * @param expiresAt - The expiry date of the access token (optional)
   * @returns The created or updated ConnectedAccount instance
   */
  public async storeTokens(
    userId: number,
    accountId: string | null = null,
    accessToken: string,
    refreshToken?: string | null,
    expiresAt?: DateTime | null
  ): Promise<ConnectedAccount> {
    try {
      // If accountId is not provided, fetch it from Google Ads API
      if (!accountId) {
        if (!refreshToken) {
          throw new Error('Refresh token is required to fetch customer ID')
        }
        
        logger.info('Account ID not provided, fetching from Google Ads API')
        accountId = await this.getCustomerId(accessToken, refreshToken)
        logger.info('Successfully retrieved account ID', { accountId })
      }
      
      // Encrypt tokens before storing
      const encryptedAccessToken = encryptionService.encrypt(accessToken)
      const encryptedRefreshToken = refreshToken ? encryptionService.encrypt(refreshToken) : null
      
      // Generate token hashes for quick validation
      const accessTokenHash = encryptionService.hashData(accessToken)
      const refreshTokenHash = refreshToken ? encryptionService.hashData(refreshToken) : null
      
      // Check if account already exists
      let connectedAccount = await ConnectedAccount.query()
        .where('user_id', userId)
        .where('platform', 'google_ads')
        .where('account_id', accountId)
        .first()
      
      if (connectedAccount) {
        // Update existing account
        connectedAccount.accessToken = encryptedAccessToken
        connectedAccount.refreshToken = encryptedRefreshToken
        connectedAccount.accessTokenHash = accessTokenHash
        connectedAccount.refreshTokenHash = refreshTokenHash
        connectedAccount.expiresAt = expiresAt || null
        connectedAccount.isActive = true
        await connectedAccount.save()
        
        logger.info('Updated existing connected account', { 
          accountId, 
          userId, 
          connectedAccountId: connectedAccount.id 
        })
      } else {
        // Create new account
        connectedAccount = await ConnectedAccount.create({
          userId: userId,
          platform: 'google_ads',
          accountId: accountId,
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
          accessTokenHash: accessTokenHash,
          refreshTokenHash: refreshTokenHash,
          expiresAt: expiresAt || null,
          isActive: true,
        })
        
        logger.info('Created new connected account', { 
          accountId, 
          userId, 
          connectedAccountId: connectedAccount.id 
        })
      }
      
      // Log token storage
      logger.info(`Tokens stored for user ${userId}, account ${accountId}`)
      
      return connectedAccount
    } catch (error: any) {
      logger.error('Error storing tokens:', error)
      throw new Error(`Failed to store tokens: ${error.message}`)
    }
  }

  /**
   * Check if a token has been revoked
   * 
   * @param tokenHash - The hash of the token to check
   * @returns True if token is revoked, false otherwise
   */
  public isTokenRevoked(tokenHash: string): boolean {
    return revokedTokens.has(tokenHash)
  }

  /**
   * Revoke a token
   * 
   * @param tokenHash - The hash of the token to revoke
   */
  public revokeToken(tokenHash: string): void {
    revokedTokens.add(tokenHash)
    logger.info(`Token revoked: ${tokenHash}`)
    
    // Log security event
    securityMonitoringService.logSecurityEvent(
      'token_revoked',
      { tokenHash }
    )
  }

  /**
   * Check if rate limiting should be applied for token access
   * 
   * @param userId - The ID of the user attempting to access tokens
   * @returns True if rate limiting should be applied, false otherwise
   */
  public shouldRateLimit(userId: number): boolean {
    const key = `token_access_${userId}`
    const now = Date.now()
    const attempt = tokenAccessAttempts.get(key)
    
    if (!attempt) {
      tokenAccessAttempts.set(key, { count: 1, timestamp: now })
      return false
    }
    
    // Reset count if window has passed
    if (now - attempt.timestamp > GoogleAdsOAuthService.ACCESS_WINDOW_MS) {
      tokenAccessAttempts.set(key, { count: 1, timestamp: now })
      return false
    }
    
    // Increment count
    attempt.count++
    tokenAccessAttempts.set(key, attempt)
    
    // Apply rate limiting if threshold exceeded
    if (attempt.count > GoogleAdsOAuthService.MAX_ACCESS_ATTEMPTS) {
      logger.warn(`Rate limiting applied for user ${userId}`)
      
      // Log security event
      securityMonitoringService.logSecurityEvent(
        'token_access_rate_limit_exceeded',
        { userId, attempts: attempt.count }
      )
      
      return true
    }
    
    return false
  }

  /**
   * Retrieve and decrypt tokens from the ConnectedAccount model
   * Automatically refreshes expired tokens if refresh token is available
   * 
   * @param connectedAccountId - The ID of the connected account
   * @param userId - The ID of the user requesting the tokens (for rate limiting)
   * @returns Object containing decrypted access token and refresh token
   */
  public async retrieveTokens(
    connectedAccountId: number,
    userId?: number
  ): Promise<{
    accessToken: string
    refreshToken: string | null
  }> {
    try {
      // Apply rate limiting if userId is provided
      if (userId && this.shouldRateLimit(userId)) {
        throw new Error('Rate limit exceeded for token access')
      }
      
      const connectedAccount = await ConnectedAccount.findOrFail(connectedAccountId)
      
      // Check if tokens exist
      if (!connectedAccount.accessToken) {
        throw new Error('No access token found for this account. Please reconnect your Google Ads account.')
      }
      
      // Check if access token is revoked
      if (connectedAccount.accessTokenHash && this.isTokenRevoked(connectedAccount.accessTokenHash)) {
        logger.warn(`Access token revoked for account ${connectedAccountId}`)
        throw new Error('Access token has been revoked. Please reconnect your Google Ads account.')
      }
      
      // The model hooks should have already decrypted the tokens
      let accessToken = connectedAccount.accessToken
      let refreshToken = connectedAccount.refreshToken
      
      // If tokens appear to still be encrypted, decrypt them manually
      try {
        if (this.looksEncrypted(accessToken)) {
          accessToken = encryptionService.decrypt(accessToken)
        }
        if (refreshToken && this.looksEncrypted(refreshToken)) {
          refreshToken = encryptionService.decrypt(refreshToken)
        }
      } catch (decryptError) {
        logger.error('Error decrypting tokens manually:', decryptError)
        throw new Error('Failed to decrypt stored tokens. Please reconnect your Google Ads account.')
      }
      
      // Check if access token is expired and refresh if possible
      if (connectedAccount.isTokenExpired) {
        logger.info(`Access token expired for account ${connectedAccountId}, attempting to refresh`)
        
        if (!refreshToken) {
          throw new Error('Access token has expired and no refresh token is available. Please reconnect your Google Ads account.')
        }
        
        try {
          // Refresh the access token
          const refreshedTokens = await this.refreshAccessToken(refreshToken)
          
          // Store the new tokens
          await this.storeTokens(
            connectedAccount.userId,
            connectedAccount.accountId,
            refreshedTokens.accessToken,
            refreshToken,
            refreshedTokens.expiryDate
          )
          
          // Use the new access token
          accessToken = refreshedTokens.accessToken
          
          logger.info(`Successfully refreshed access token for account ${connectedAccountId}`)
        } catch (refreshError: any) {
          logger.error(`Failed to refresh access token for account ${connectedAccountId}:`, refreshError)
          
          // Mark account as inactive if refresh fails
          connectedAccount.isActive = false
          await connectedAccount.save()
          
          throw new Error(`Access token has expired and refresh failed: ${refreshError.message}`)
        }
      }
      
      // Log token retrieval
      logger.info(`Tokens retrieved for account ${connectedAccountId}`)
      
      // Log security event
      if (userId) {
        securityMonitoringService.logSecurityEvent(
          'token_accessed',
          { connectedAccountId, userId }
        )
      }
      
      return {
        accessToken: accessToken,
        refreshToken: refreshToken,
      }
    } catch (error: any) {
      logger.error('Error retrieving tokens:', error)
      
      // Log security event for failed token access
      if (userId) {
        securityMonitoringService.logSecurityEvent(
          'token_access_failed',
          { connectedAccountId, userId, error: error.message }
        )
      }
      
      throw new Error(`Failed to retrieve tokens: ${error.message}`)
    }
  }

  /**
   * Check if a string looks like encrypted data
   * 
   * @param data - The data to check
   * @returns True if data appears to be encrypted
   */
  private looksEncrypted(data: string): boolean {
    if (!data) return false
    
    // Base64 encoded encrypted data characteristics:
    // - Only contains base64 characters
    // - Longer than typical tokens
    // - Doesn't start with known Google token prefixes
    return !data.startsWith('ya29.') && 
           !data.startsWith('1//') && 
           !data.includes(' ') && 
           data.length > 100 &&
           /^[A-Za-z0-9+/=]+$/.test(data)
  }

  /**
   * Get OAuth2 client with credentials set
   * 
   * @param connectedAccountId - The ID of the connected account
   * @param userId - The ID of the user requesting the client (for rate limiting)
   * @returns The OAuth2 client with credentials set
   */
  public async getAuthenticatedClient(connectedAccountId: number, userId?: number): Promise<any> {
    try {
      // Retrieve tokens (will auto-refresh if expired)
      const { accessToken, refreshToken } = await this.retrieveTokens(connectedAccountId, userId)
      
      // Set credentials
      this.oauth2Client.setCredentials({
        access_token: accessToken,
        refresh_token: refreshToken,
      })
      
      return this.oauth2Client
    } catch (error: any) {
      logger.error('Error getting authenticated client:', error)
      throw new Error(`Failed to get authenticated client: ${error.message}`)
    }
  }

  /**
   * Generate a state parameter for OAuth2 flow security
   * 
   * @param userId - The ID of the user
   * @returns A randomly generated state parameter
   */
  private generateStateParameter(userId: number): string {
    // In a production environment, you would want to store this in the session
    // and verify it in the callback to prevent CSRF attacks
    return `${userId}-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`
  }
}

// Export a singleton instance of the service
export default new GoogleAdsOAuthService()
