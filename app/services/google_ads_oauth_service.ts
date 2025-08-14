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
      
      // Validate input tokens
      if (!accessToken || !refreshToken) {
        throw new Error('Both access token and refresh token are required to fetch customer ID')
      }
      
      // Create a Google Ads customer client without specifying customer_id for listing
      const customer = this.googleAdsClient.Customer({
        refresh_token: refreshToken
      })

      // Method 1: Try to get accessible customers using the listAccessibleCustomers method
      logger.info('Attempting to list accessible customers')
      
      try {
        const accessibleCustomers = await customer.listAccessibleCustomers()
        
        logger.info('Retrieved accessible customers', {
          count: accessibleCustomers.resourceNames?.length || 0,
          customers: accessibleCustomers.resourceNames
        })

        if (!accessibleCustomers.resourceNames || accessibleCustomers.resourceNames.length === 0) {
          throw new Error('No accessible customers found. Please ensure you have proper access to Google Ads accounts and that your account is not suspended.')
        }

        // Extract customer ID from the first accessible customer resource name
        // Resource name format: customers/1234567890
        const firstCustomerResourceName = accessibleCustomers.resourceNames[0]
        const customerId = firstCustomerResourceName.split('/')[1]
        
        if (!customerId || !/^\d{10}$/.test(customerId)) {
          throw new Error(`Invalid customer ID format retrieved from Google Ads API: ${customerId}. Expected 10 digits.`)
        }

        logger.info('Customer ID successfully retrieved via listAccessibleCustomers', { 
          customerId,
          resourceName: firstCustomerResourceName 
        })

        return customerId
      } catch (listError: any) {
        logger.warn('listAccessibleCustomers method failed, trying alternative approaches:', {
          error: listError.message,
          code: listError.code
        })
        
        // If it's a permission error, don't try other methods
        if (listError.message?.includes('PERMISSION_DENIED') || 
            listError.message?.includes('DEVELOPER_TOKEN_NOT_ON_ALLOWLIST')) {
          throw listError
        }
      }

      // Method 2: Try using the customer service directly
      try {
        logger.info('Trying to access customer service directly')
        
        const customerService = customer.service?.CustomerService
        if (customerService && typeof customerService.listAccessibleCustomers === 'function') {
          const accessibleCustomers = await customerService.listAccessibleCustomers({})
          
          if (accessibleCustomers.resourceNames && accessibleCustomers.resourceNames.length > 0) {
            const firstCustomerResourceName = accessibleCustomers.resourceNames[0]
            const customerId = firstCustomerResourceName.split('/')[1]
            
            if (customerId && /^\d{10}$/.test(customerId)) {
              logger.info('Customer ID retrieved via CustomerService', { customerId })
              return customerId
            }
          }
        }
      } catch (serviceError: any) {
        logger.debug('CustomerService method failed:', serviceError.message)
      }

      // Method 3: Try to use the GoogleAds client's listAccessibleCustomers at the client level
      try {
        logger.info('Trying to use GoogleAds client listAccessibleCustomers method')
        
        // Create a client with authentication
        const authenticatedClient = this.googleAdsClient.Customer({
          refresh_token: refreshToken
        })
        
        // Some versions of the API have the method at different levels
        if (typeof authenticatedClient.listAccessibleCustomers === 'function') {
          const accessibleCustomers = await authenticatedClient.listAccessibleCustomers()
          
          if (accessibleCustomers && accessibleCustomers.resourceNames && accessibleCustomers.resourceNames.length > 0) {
            const firstCustomerResourceName = accessibleCustomers.resourceNames[0]
            const customerId = firstCustomerResourceName.split('/')[1]
            
            if (customerId && /^\d{10}$/.test(customerId)) {
              logger.info('Customer ID retrieved via client listAccessibleCustomers', { customerId })
              return customerId
            }
          }
        }
      } catch (clientError: any) {
        logger.debug('Client-level listAccessibleCustomers failed:', clientError.message)
      }

      // Method 4: Try using the Google OAuth2 client to call the API directly
      try {
        logger.info('Trying to call Google Ads API directly via HTTP')
        
        // Set up OAuth2 client with tokens
        this.oauth2Client.setCredentials({
          access_token: accessToken,
          refresh_token: refreshToken
        })
        
        // Make direct HTTP request to list accessible customers
        const url = 'https://googleads.googleapis.com/v21/customers:listAccessibleCustomers'
        const response = await this.oauth2Client.request({ url })
        
        if (response.data && response.data.resourceNames && response.data.resourceNames.length > 0) {
          const firstCustomerResourceName = response.data.resourceNames[0]
          const customerId = firstCustomerResourceName.split('/')[1]
          
          if (customerId && /^\d{10}$/.test(customerId)) {
            logger.info('Customer ID retrieved via direct HTTP call', { customerId })
            return customerId
          }
        }
      } catch (httpError: any) {
        logger.debug('Direct HTTP call failed:', httpError.message)
      }

      // If all methods fail, provide detailed error information
      throw new Error('Unable to retrieve customer ID using any available method. Please ensure: 1) Your Google Ads API developer token is approved, 2) You have access to at least one Google Ads account, 3) Your account is not suspended, and 4) The OAuth scopes include adwords access.')

    } catch (error: any) {
      logger.error('Error getting customer ID from Google Ads API:', {
        message: error.message,
        stack: error.stack,
        code: error.code,
        details: error.details,
        name: error.name
      })
      
      // Provide more specific error messages based on error type
      if (error.message?.includes('DEVELOPER_TOKEN_NOT_ON_ALLOWLIST')) {
        throw new Error('Developer token not approved. Please ensure your Google Ads API developer token is approved for production use and is properly configured.')
      }
      
      if (error.message?.includes('PERMISSION_DENIED')) {
        throw new Error('Permission denied. Please ensure you have proper access to Google Ads accounts and that you granted the correct permissions during OAuth.')
      }
      
      if (error.message?.includes('invalid_grant') || error.message?.includes('invalid_client')) {
        throw new Error('Invalid authorization credentials. Please try reconnecting your Google Ads account from the beginning.')
      }
      
      if (error.message?.includes('CUSTOMER_NOT_FOUND')) {
        throw new Error('No Google Ads customers found. Please ensure you have at least one active Google Ads account.')
      }
      
      if (error.message?.includes('suspended') || error.message?.includes('disabled')) {
        throw new Error('Your Google Ads account appears to be suspended or disabled. Please contact Google Ads support.')
      }
      
      if (error.code === 401) {
        throw new Error('Authentication failed. Your access token may have expired or been revoked. Please reconnect your account.')
      }
      
      if (error.code === 403) {
        throw new Error('Access forbidden. Please ensure your Google Ads API credentials are correct and you have the necessary permissions.')
      }
      
      if (error.code === 429) {
        throw new Error('Rate limit exceeded. Please try again in a few minutes.')
      }
      
      // For unknown errors, include the original message
      throw new Error(`Failed to get customer ID: ${error.message}. Please check your Google Ads account setup and API credentials.`)
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
