import { google } from 'googleapis'
import env from '#start/env'
import ConnectedAccount from '#models/connected_account'
import encryptionService from './encryption_service.js'
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'
import securityMonitoringService from '#services/security_monitoring_service'

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
    } catch (error) {
      logger.error('Error exchanging code for tokens:', error)
      throw new Error(`Failed to exchange code for tokens: ${error.message}`)
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
    } catch (error) {
      logger.error('Error refreshing access token:', error)
      throw new Error(`Failed to refresh access token: ${error.message}`)
    }
  }

  /**
   * Store tokens in the ConnectedAccount model
   * 
   * @param userId - The ID of the user
   * @param accountId - The Google Ads account ID
   * @param accessToken - The access token to store
   * @param refreshToken - The refresh token to store (optional)
   * @param expiresAt - The expiry date of the access token (optional)
   * @returns The created or updated ConnectedAccount instance
   */
  public async storeTokens(
    userId: number,
    accountId: string,
    accessToken: string,
    refreshToken?: string | null,
    expiresAt?: DateTime | null
  ): Promise<ConnectedAccount> {
    try {
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
      }
      
      // Log token storage
      logger.info(`Tokens stored for user ${userId}, account ${accountId}`)
      
      return connectedAccount
    } catch (error) {
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
        throw new Error('No access token found for this account')
      }
      
      // Check if access token is expired
      if (connectedAccount.isTokenExpired) {
        logger.warn(`Access token expired for account ${connectedAccountId}`)
        throw new Error('Access token has expired')
      }
      
      // Check if access token is revoked
      if (connectedAccount.accessTokenHash && this.isTokenRevoked(connectedAccount.accessTokenHash)) {
        logger.warn(`Access token revoked for account ${connectedAccountId}`)
        throw new Error('Access token has been revoked')
      }
      
      // Decrypt tokens
      const accessToken = encryptionService.decrypt(connectedAccount.accessToken)
      const refreshToken = connectedAccount.refreshToken ? 
        encryptionService.decrypt(connectedAccount.refreshToken) : null
      
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
    } catch (error) {
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
   * Get OAuth2 client with credentials set
   * 
   * @param connectedAccountId - The ID of the connected account
   * @param userId - The ID of the user requesting the client (for rate limiting)
   * @returns The OAuth2 client with credentials set
   */
  public async getAuthenticatedClient(connectedAccountId: number, userId?: number): Promise<any> {
    try {
      // Retrieve tokens
      const { accessToken, refreshToken } = await this.retrieveTokens(connectedAccountId, userId)
      
      // Set credentials
      this.oauth2Client.setCredentials({
        access_token: accessToken,
        refresh_token: refreshToken,
      })
      
      return this.oauth2Client
    } catch (error) {
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