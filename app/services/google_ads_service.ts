import { GoogleAdsApi, enums } from 'google-ads-api'
import env from '#start/env'
import ConnectedAccount from '#models/connected_account'
import CampaignData from '#models/campaign_data'
import googleAdsOAuthService from './google_ads_oauth_service.js'
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'

/**
 * Service for interacting with the Google Ads API
 * 
 * This service handles fetching campaign data from the Google Ads API,
 * processing and formatting the data for storage, and handling API errors.
 */
export class GoogleAdsService {
  private googleAdsClient: GoogleAdsApi
  private cache: Map<string, any> = new Map()
  private cacheExpiry: Map<string, DateTime> = new Map()
  private batchSize: number = 100
  private cacheTtl: number = 10 // minutes
  private pageSize: number = 1000

  constructor() {
    // Initialize the Google Ads API client with credentials from environment variables
    logger.info('Initializing Google Ads API client', {
      clientId: env.get('GOOGLE_ADS_CLIENT_ID'),
      hasClientId: !!env.get('GOOGLE_ADS_CLIENT_ID'),
      hasClientSecret: !!env.get('GOOGLE_ADS_CLIENT_SECRET'),
      hasDeveloperToken: !!env.get('GOOGLE_ADS_DEVELOPER_TOKEN'),
    })
    
    this.googleAdsClient = new GoogleAdsApi({
      client_id: env.get('GOOGLE_ADS_CLIENT_ID'),
      client_secret: env.get('GOOGLE_ADS_CLIENT_SECRET'),
      developer_token: env.get('GOOGLE_ADS_DEVELOPER_TOKEN'),
    })
    
    logger.info('Google Ads API client initialized', {
      hasGoogleAdsClient: !!this.googleAdsClient,
      clientType: typeof this.googleAdsClient
    })
  }

  /**
   * Validate and fix account ID if it's a mock ID
   * 
   * @param connectedAccountId - The ID of the connected account
   * @param userId - The ID of the user
   * @returns The validated connected account with real customer ID
   */
  private async validateAndFixAccountId(connectedAccountId: number, userId: number): Promise<ConnectedAccount> {
    const connectedAccount = await ConnectedAccount.findOrFail(connectedAccountId)
    
    // Check if this is a mock account ID (contains "google_ads_account_" or "temp_google_ads_" prefix)
    if (connectedAccount.accountId.startsWith('google_ads_account_') || connectedAccount.accountId.startsWith('temp_google_ads_')) {
      logger.info('Detected mock account ID, fetching real customer ID', {
        mockAccountId: connectedAccount.accountId,
        connectedAccountId
      })
      
      try {
        // Get tokens to fetch real customer ID
        const decryptedTokens = await googleAdsOAuthService.retrieveTokens(connectedAccountId, userId)
        
        if (!decryptedTokens.refreshToken) {
          throw new Error('No refresh token available to fetch customer ID')
        }
        
        // Fetch the real customer ID
        const realCustomerId = await googleAdsOAuthService.getCustomerId(
          decryptedTokens.accessToken, 
          decryptedTokens.refreshToken
        )
        
        logger.info('Retrieved real customer ID', {
          oldAccountId: connectedAccount.accountId,
          newAccountId: realCustomerId
        })
        
        // Update the account with real customer ID
        connectedAccount.accountId = realCustomerId
        await connectedAccount.save()
        
        logger.info('Updated connected account with real customer ID', {
          connectedAccountId,
          oldAccountId: connectedAccount.accountId,
          newAccountId: realCustomerId
        })
      } catch (error: any) {
        logger.error('Failed to fetch real customer ID', {
          error: error.message,
          connectedAccountId,
          accountId: connectedAccount.accountId
        })
        
        // If we can't fetch the customer ID, the account is unusable
        // Mark it as inactive and throw an error
        connectedAccount.isActive = false
        await connectedAccount.save()
        
        throw new Error(`Failed to fetch real customer ID: ${error.message}. The account has been marked as inactive. Please reconnect your Google Ads account.`)
      }
    }
    
    // Validate customer ID format (should be 10 digits)
    if (!/^\d{10}$/.test(connectedAccount.accountId)) {
      // Check if it's still a temporary ID that we couldn't fix
      if (connectedAccount.accountId.startsWith('temp_google_ads_') || 
          connectedAccount.accountId.startsWith('google_ads_account_')) {
        throw new Error(`Your Google Ads account still has a temporary ID (${connectedAccount.accountId}). This usually means we couldn't retrieve your real customer ID during setup. Please disconnect and reconnect your Google Ads account, or contact support if the problem persists.`)
      }
      
      throw new Error(`Invalid customer ID format: ${connectedAccount.accountId}. Expected a 10-digit number, but got: ${connectedAccount.accountId}. Please disconnect and reconnect your Google Ads account.`)
    }
    
    return connectedAccount
  }

  /**
   * Get accessible customer accounts for a user
   * 
   * @param connectedAccountId - The ID of the connected account
   * @param userId - The ID of the user requesting the data
   * @returns Array of accessible customer accounts
   */
  public async getAccessibleCustomers(connectedAccountId: number, userId: number): Promise<any[]> {
    try {
      // Get decrypted tokens
      const decryptedTokens = await googleAdsOAuthService.retrieveTokens(connectedAccountId, userId)
      
      if (!decryptedTokens.refreshToken) {
        throw new Error('No refresh token available for this account')
      }

      // Create customer client without specifying customer_id for listing
      const customer = this.googleAdsClient.Customer({
        refresh_token: decryptedTokens.refreshToken
      })

      // Get accessible customers
      const accessibleCustomers = await customer.listAccessibleCustomers()
      
      logger.info('Retrieved accessible customers', {
        count: accessibleCustomers.resourceNames?.length || 0,
        customers: accessibleCustomers.resourceNames
      })

      return accessibleCustomers.resourceNames || []
    } catch (error: any) {
      logger.error('Error fetching accessible customers:', {
        message: error.message,
        stack: error.stack,
        code: error.code,
        details: error.details
      })
      throw new Error(`Failed to fetch accessible customers: ${error.message}`)
    }
  }

  /**
   * Fetch campaign data from Google Ads API for multiple date ranges
   * 
   * @param connectedAccountId - The ID of the connected account
   * @param userId - The ID of the user requesting the data (for rate limiting)
   * @param dateRange - Date range configuration
   * @param retryCount - Current retry attempt count
   * @returns Array of campaign data
   */
  public async fetchCampaignData(
    connectedAccountId: number,
    userId: number,
    dateRange: {
      type: 'today' | 'last_7_days' | 'last_30_days' | 'custom',
      startDate?: string,
      endDate?: string
    } = { type: 'last_30_days' },
    retryCount: number = 0
  ): Promise<any[]> {
    const maxRetries = 3
    
    try {
      // Validate and fix account ID if it's a mock ID
      const connectedAccount = await this.validateAndFixAccountId(connectedAccountId, userId)
      
      // Check if the account is active
      if (!connectedAccount.isActive) {
        throw new Error('Connected account is not active')
      }
      
      // Get decrypted tokens with automatic refresh if expired
      const decryptedTokens = await googleAdsOAuthService.retrieveTokens(connectedAccountId, userId)
      
      // Check if we have a refresh token
      if (!decryptedTokens.refreshToken) {
        throw new Error('No refresh token available for this account')
      }
      
      // Get login customer ID from environment (this should be your manager account ID if you're using one)
      const loginCustomerId = env.get('GOOGLE_ADS_LOGIN_CUSTOMER_ID')
      
      // Set up the Google Ads client with the authenticated credentials
      logger.info('Creating Google Ads customer client', {
        customerId: connectedAccount.accountId,
        loginCustomerId: loginCustomerId,
        hasGoogleAdsClient: !!this.googleAdsClient,
        hasCustomerMethod: !!(this.googleAdsClient && typeof this.googleAdsClient.Customer === 'function')
      })
      
      // Prepare customer configuration
      const customerConfig: any = {
        customer_id: connectedAccount.accountId,
        refresh_token: decryptedTokens.refreshToken
      }
      
      // Only add login_customer_id if it's provided and different from customer_id
      if (loginCustomerId && loginCustomerId !== connectedAccount.accountId) {
        customerConfig.login_customer_id = loginCustomerId
      }
      
      let customer: any
      try {
        customer = this.googleAdsClient.Customer(customerConfig)
      } catch (customerError: any) {
        logger.error('Error creating Google Ads customer client:', {
          message: customerError.message,
          customerConfig: {
            customer_id: customerConfig.customer_id,
            hasRefreshToken: !!customerConfig.refresh_token,
            login_customer_id: customerConfig.login_customer_id
          }
        })
        throw new Error(`Failed to create Google Ads customer client: ${customerError.message}`)
      }
      
      logger.info('Google Ads customer client created', {
        hasCustomer: !!customer,
        customerType: typeof customer
      })
      
      // Calculate date range
      let startDate: string
      let endDate: string
      
      switch (dateRange.type) {
        case 'today':
          startDate = DateTime.now().toFormat('yyyy-MM-dd')
          endDate = startDate
          break
        case 'last_7_days':
          endDate = DateTime.now().toFormat('yyyy-MM-dd')
          startDate = DateTime.now().minus({ days: 7 }).toFormat('yyyy-MM-dd')
          break
        case 'last_30_days':
          endDate = DateTime.now().toFormat('yyyy-MM-dd')
          startDate = DateTime.now().minus({ days: 30 }).toFormat('yyyy-MM-dd')
          break
        case 'custom':
          if (!dateRange.startDate || !dateRange.endDate) {
            throw new Error('Custom date range requires both startDate and endDate')
          }
          startDate = dateRange.startDate
          endDate = dateRange.endDate
          break
        default:
          endDate = DateTime.now().toFormat('yyyy-MM-dd')
          startDate = DateTime.now().minus({ days: 30 }).toFormat('yyyy-MM-dd')
      }
      
      // Check cache first
      const cacheKey = `campaign_data_${connectedAccountId}_${startDate}_${endDate}`
      if (this.isCacheValid(cacheKey)) {
        logger.info(`Returning cached campaign data for account ${connectedAccountId}`)
        return this.cache.get(cacheKey)
      }
      
      // Start with a very simple query to test the connection
      const simpleQuery = `
        SELECT 
          campaign.id,
          campaign.name,
          campaign.status
        FROM campaign
        WHERE campaign.status != 'REMOVED'
        ORDER BY campaign.id
        LIMIT 5
      `
      
      logger.info('Starting with simple query to test connection', {
        query: simpleQuery,
        startDate,
        endDate,
        customerId: connectedAccount.accountId
      })
      
      // Execute the simple query first
      const results = await this.executePaginatedQuery(customer, simpleQuery, 5)
      
      logger.info(`Simple query completed successfully, returned ${results.length} results`)
      
      // If simple query works, try a more comprehensive query
      if (results.length >= 0) { // Allow empty results
        const detailedQuery = `
          SELECT 
            campaign.id,
            campaign.name,
            campaign.status,
            campaign.advertising_channel_type,
            campaign.advertising_channel_sub_type,
            segments.date,
            metrics.impressions,
            metrics.clicks,
            metrics.cost_micros,
            metrics.conversions
          FROM campaign
          WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
          AND campaign.status != 'REMOVED'
          ORDER BY segments.date DESC, campaign.id
        `
        
        logger.info('Executing detailed query', { 
          query: detailedQuery.substring(0, 200) + '...',
          startDate,
          endDate
        })
        
        const detailedResults = await this.executePaginatedQuery(customer, detailedQuery)
        
        // Cache the results
        this.cache.set(cacheKey, detailedResults)
        this.cacheExpiry.set(cacheKey, DateTime.now().plus({ minutes: this.cacheTtl }))
        
        return detailedResults
      }
      
      return results
    } catch (error: any) {
      logger.error('Error fetching campaign data from Google Ads API:', {
        message: error.message,
        stack: error.stack,
        code: error.code,
        details: error.details,
        name: error.name,
        connectedAccountId,
        userId,
        retryCount,
        fullError: JSON.stringify(error, Object.getOwnPropertyNames(error))
      })
      
      // Handle authentication errors by retrying with fresh tokens
      if ((error.code === 401 || error.code === 403 || error.message?.includes('token') || error.message?.includes('auth') || error.message?.includes('invalid_grant')) && retryCount < maxRetries) {
        logger.info(`Authentication error encountered, attempting retry ${retryCount + 1}/${maxRetries}`)
        
        // Wait a bit before retrying to avoid rapid successive requests
        await this.sleep(1000 * (retryCount + 1))
        
        // Retry the request (the retrieveTokens call will handle token refresh automatically)
        return await this.fetchCampaignData(connectedAccountId, userId, dateRange, retryCount + 1)
      }
      
      // Handle rate limiting with exponential backoff
      if (error.code === 429 && retryCount < maxRetries) {
        const delay = Math.pow(2, retryCount) * 1000 // Exponential backoff
        logger.info(`Rate limited, retrying after ${delay}ms (attempt ${retryCount + 1}/${maxRetries})`)
        
        await this.sleep(delay)
        return await this.fetchCampaignData(connectedAccountId, userId, dateRange, retryCount + 1)
      }
      
      throw new Error(`Failed to fetch campaign data: ${error.message}`)
    }
  }

  /**
   * Execute a paginated query to handle large result sets with proper error handling
   * 
   * @param customer - The Google Ads customer client
   * @param query - The query to execute
   * @param pageSize - Number of results per page (default: 1000)
   * @returns Array of query results
   */
  private async executePaginatedQuery(customer: any, query: string, pageSize: number = this.pageSize): Promise<any[]> {
    try {
      // Add diagnostic logging to check if customer object is properly initialized
      logger.info('Executing paginated query', {
        hasCustomer: !!customer,
        customerType: typeof customer,
        hasQueryMethod: !!(customer && typeof customer.query === 'function')
      })
      
      // Check if customer object is undefined
      if (!customer) {
        throw new Error('Customer object is undefined in executePaginatedQuery')
      }
      
      // Check if customer.query method exists
      if (!customer.query || typeof customer.query !== 'function') {
        throw new Error('Customer.query method is not available or not a function')
      }
      
      const allResults: any[] = []
      
      // Execute the query with proper error handling
      logger.info('Executing Google Ads query', {
        query: query.substring(0, 200) + (query.length > 200 ? '...' : ''),
        pageSize
      })
      
      try {
        // Wrap the query execution in additional error handling
        let response: any
        try {
          response = await customer.query(query, {
            page_size: pageSize
          })
        } catch (queryExecutionError: any) {
          // Check for specific error conditions that might cause undefined access
          if (queryExecutionError.message?.includes('Cannot read properties of undefined')) {
            logger.error('Detected undefined property access error, likely due to invalid customer ID', {
              customerId: customer.customer_id || 'unknown',
              error: queryExecutionError.message
            })
            throw new Error('Invalid customer ID or customer not found. Please reconnect your Google Ads account.')
          }
          throw queryExecutionError
        }
        
        logger.info('Query response received', {
          hasResponse: !!response,
          responseType: typeof response,
          hasResults: !!(response && Array.isArray(response)),
          resultsLength: Array.isArray(response) ? response.length : 0
        })
        
        // Handle different response formats
        if (Array.isArray(response)) {
          allResults.push(...response)
        } else if (response && response.results && Array.isArray(response.results)) {
          allResults.push(...response.results)
        } else if (response && response.data && Array.isArray(response.data)) {
          allResults.push(...response.data)
        }
        
        logger.info(`Query completed successfully, returned ${allResults.length} results`)
        return allResults
      } catch (queryError: any) {
        logger.error('Error executing Google Ads query:', {
          message: queryError.message,
          stack: queryError.stack,
          code: queryError.code,
          details: queryError.details,
          name: queryError.name,
          query: query.substring(0, 200) + (query.length > 200 ? '...' : ''),
          fullError: JSON.stringify(queryError, Object.getOwnPropertyNames(queryError))
        })
        
        // Handle specific Google Ads API errors
        if (queryError.code === 401 || queryError.code === 403) {
          throw queryError
        }
        
        // Handle undefined property access errors specifically
        if (queryError.message?.includes('Cannot read properties of undefined')) {
          throw new Error('Invalid customer account or authentication issue. Please reconnect your Google Ads account.')
        }
        
        // Handle customer not found errors
        if (queryError.message?.includes('CUSTOMER_NOT_FOUND') || 
            queryError.message?.includes('not found') ||
            queryError.message?.includes('Customer ID')) {
          throw new Error('Google Ads account not found. Please verify the account ID is correct and you have access to it.')
        }
        
        // Handle permission denied errors
        if (queryError.message?.includes('PERMISSION_DENIED') ||
            queryError.message?.includes('permission')) {
          throw new Error('Permission denied. Please ensure the account has proper access permissions and the login_customer_id is correct.')
        }
        
        // Handle developer token errors
        if (queryError.message?.includes('DEVELOPER_TOKEN_NOT_ON_ALLOWLIST') ||
            queryError.message?.includes('developer token')) {
          throw new Error('Developer token not approved. Please ensure your Google Ads API developer token is approved.')
        }
        
        // Handle quota/rate limit errors
        if (queryError.message?.includes('RATE_EXCEEDED') ||
            queryError.message?.includes('quota') ||
            queryError.code === 429) {
          throw new Error('API rate limit exceeded. Please try again later.')
        }
        
        // For other errors, provide more context
        const errorMessage = queryError.message || 'Unknown error occurred'
        throw new Error(`Google Ads API query failed: ${errorMessage}`)
      }
    } catch (error: any) {
      logger.error('Error executing paginated query:', {
        message: error.message,
        stack: error.stack,
        code: error.code,
        details: error.details,
        name: error.name,
        hasCustomer: !!customer,
        customerType: typeof customer,
        fullError: JSON.stringify(error, Object.getOwnPropertyNames(error))
      })
      throw error
    }
  }

  /**
   * Process and store campaign data with validation and deduplication
   * 
   * @param connectedAccountId - The ID of the connected account
   * @param rawData - Raw campaign data from Google Ads API
   * @returns Array of processed campaign data records
   */
  public async processAndStoreCampaignData(connectedAccountId: number, rawData: any[]): Promise<CampaignData[]> {
    try {
      const processedData: CampaignData[] = []
      const batch: Partial<CampaignData>[] = []
      
      // Process each row of data
      for (const row of rawData) {
        try {
          // Extract and validate data from the row with safer access
          const campaignId = row.campaign?.id?.toString()
          const campaignName = row.campaign?.name
          const campaignType = row.campaign?.advertising_channel_type
          const campaignSubType = row.campaign?.advertising_channel_sub_type
          const adGroupType = row.ad_group?.type
          const date = row.segments?.date
          const spend = row.metrics?.cost_micros
          const impressions = row.metrics?.impressions
          const clicks = row.metrics?.clicks
          const conversions = row.metrics?.conversions
          
          // Skip rows with missing required data
          if (!campaignId || !campaignName) {
            logger.warn(`Skipping row with missing required data: campaignId=${campaignId}, campaignName=${campaignName}, date=${date}`)
            continue
          }
          
          // Transform data
          const transformedData = {
            connectedAccountId: connectedAccountId,
            campaignId: campaignId,
            campaignName: campaignName,
            campaignType: campaignType || null,
            campaignSubType: campaignSubType || null,
            adGroupType: adGroupType || null,
            date: date ? DateTime.fromFormat(date, 'yyyy-MM-dd') : DateTime.now(),
            spend: spend ? parseFloat(spend) / 1000000 : 0, // Convert micros to currency
            impressions: impressions ? parseInt(impressions) : 0,
            clicks: clicks ? parseInt(clicks) : 0,
            conversions: conversions ? parseFloat(conversions) : 0
          }
          
          // Add to batch
          batch.push(transformedData)
          
          // Process in batches of 100
          if (batch.length >= this.batchSize) {
            await this.processBatch(batch, processedData)
            batch.length = 0 // Clear the batch
          }
        } catch (rowError: any) {
          logger.error('Error processing row:', {
            error: rowError.message,
            row: JSON.stringify(row, null, 2)
          })
          // Continue processing other rows
        }
      }
      
      // Process remaining items in batch
      if (batch.length > 0) {
        await this.processBatch(batch, processedData)
      }
      
      return processedData
    } catch (error: any) {
      logger.error('Error processing and storing campaign data:', error)
      throw new Error(`Failed to process and store campaign data: ${error.message}`)
    }
  }

  /**
   * Process a batch of campaign data
   * 
   * @param batch - Array of campaign data to process
   * @param processedData - Array to store processed records
   */
  private async processBatch(batch: Partial<CampaignData>[], processedData: CampaignData[]): Promise<void> {
    try {
      // Use a transaction for better performance
      const createdRecords = await CampaignData.createMany(batch)
      processedData.push(...createdRecords)
      
      logger.info(`Processed batch of ${batch.length} campaign data records`)
    } catch (error: any) {
      logger.error('Error processing batch:', error)
      throw error
    }
  }

  /**
   * Sync campaign data from Google Ads API with incremental updates
   * 
   * @param connectedAccountId - The ID of the connected account
   * @param userId - The ID of the user requesting the sync (for rate limiting)
   * @param dateRange - Date range configuration (optional)
   * @returns Array of processed campaign data records
   */
  public async syncCampaignData(
    connectedAccountId: number,
    userId: number,
    dateRange?: {
      type: 'today' | 'last_7_days' | 'last_30_days' | 'custom',
      startDate?: string,
      endDate?: string
    }
  ): Promise<CampaignData[]> {
    try {
      const connectedAccount = await ConnectedAccount.findOrFail(connectedAccountId)
      
      // Determine date range for incremental sync
      let syncDateRange = dateRange
      
      if (!syncDateRange) {
        // If no date range specified, use incremental sync
        if (connectedAccount.lastSyncAt) {
          // Sync from last sync time to now
          syncDateRange = {
            type: 'custom',
            startDate: connectedAccount.lastSyncAt.toFormat('yyyy-MM-dd'),
            endDate: DateTime.now().toFormat('yyyy-MM-dd')
          }
        } else {
          // First sync, get last 30 days
          syncDateRange = { type: 'last_30_days' }
        }
      }
      
      // Fetch raw data from Google Ads API with rate limiting
      const rawData = await this.fetchCampaignData(connectedAccountId, userId, syncDateRange)
      
      // Process and store the data
      const processedData = await this.processAndStoreCampaignData(connectedAccountId, rawData)
      
      // Update last sync timestamp
      connectedAccount.lastSyncAt = DateTime.now()
      await connectedAccount.save()
      
      logger.info(`Successfully synced ${processedData.length} campaign data records for account ${connectedAccountId}`)
      
      return processedData
    } catch (error: any) {
      logger.error('Error syncing campaign data:', {
        message: error.message,
        stack: error.stack,
        code: error.code,
        details: error.details,
        name: error.name,
        fullError: JSON.stringify(error, Object.getOwnPropertyNames(error))
      })
      throw new Error(`Failed to sync campaign data: ${error.message}`)
    }
  }

  /**
   * Handle API errors and rate limiting with retry mechanism
   * 
   * @param error - The error object
   * @param retryCount - Current retry attempt count
   * @param maxRetries - Maximum number of retry attempts
   * @returns Boolean indicating if the error was handled
   */
  public async handleApiError(error: any, retryCount: number = 0, maxRetries: number = 3): Promise<boolean> {
    // Log the error
    logger.error('Google Ads API error:', error)
    
    // Check for rate limiting
    if (error.code === 429) {
      logger.warn('Rate limit exceeded for Google Ads API')
      
      // Implement exponential backoff
      if (retryCount < maxRetries) {
        const delay = Math.pow(2, retryCount) * 1000 // Exponential backoff
        logger.info(`Retrying in ${delay}ms (attempt ${retryCount + 1}/${maxRetries})`)
        await this.sleep(delay)
        return true
      }
      
      logger.error('Max retries exceeded for rate limiting')
      return false
    }
    
    // Check for authentication errors
    if (error.code === 401 || error.code === 403) {
      logger.warn('Authentication error with Google Ads API')
      // This might indicate that the tokens need to be refreshed
      return true
    }
    
    // Check for resource not found errors
    if (error.code === 404) {
      logger.warn('Resource not found in Google Ads API')
      return true
    }
    
    // For other errors, return false to indicate they were not handled
    return false
  }

  /**
   * Sleep for a specified number of milliseconds
   * 
   * @param ms - Number of milliseconds to sleep
   * @returns Promise that resolves after the specified time
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Check if cached data is still valid
   * 
   * @param cacheKey - The cache key to check
   * @returns Boolean indicating if cache is valid
   */
  private isCacheValid(cacheKey: string): boolean {
    const expiry = this.cacheExpiry.get(cacheKey)
    if (!expiry) {
      return false
    }
    
    return expiry > DateTime.now()
  }

  /**
   * Calculate additional metrics for campaign data
   * 
   * @param campaignData - The campaign data to enrich
   * @returns Enriched campaign data with additional metrics
   */
  public enrichCampaignData(campaignData: CampaignData): any {
    try {
      const enrichedData = {
        ...campaignData,
        ctr: campaignData.impressions > 0 ? (campaignData.clicks / campaignData.impressions) * 100 : 0,
        cpc: campaignData.clicks > 0 ? campaignData.spend / campaignData.clicks : 0,
        cpa: campaignData.conversions > 0 ? campaignData.spend / campaignData.conversions : 0,
        cpm: campaignData.impressions > 0 ? (campaignData.spend / campaignData.impressions) * 1000 : 0,
        roas: campaignData.spend > 0 ? campaignData.conversions / campaignData.spend : 0,
        performanceCategory: this.categorizePerformance(campaignData),
        // Add normalized fields for consistent reporting
        normalizedSpend: this.normalizeCurrency(campaignData.spend),
        // Add campaign type categorization
        campaignCategory: this.categorizeCampaignType(campaignData.campaignType),
        // Add efficiency score
        efficiencyScore: this.calculateEfficiencyScore(campaignData)
      }
      
      return enrichedData
    } catch (error: any) {
      logger.error('Error enriching campaign data:', error)
      return campaignData
    }
  }

  /**
   * Categorize campaign performance based on key metrics
   * 
   * @param campaignData - The campaign data to categorize
   * @returns Performance category
   */
  private categorizePerformance(campaignData: CampaignData): string {
    try {
      const ctr = campaignData.impressions > 0 ? (campaignData.clicks / campaignData.impressions) * 100 : 0
      const cpc = campaignData.clicks > 0 ? campaignData.spend / campaignData.clicks : 0
      
      // Simple performance categorization logic
      if (ctr > 5 && cpc < 2) {
        return 'Excellent'
      } else if (ctr > 2 && cpc < 5) {
        return 'Good'
      } else if (ctr > 1 && cpc < 10) {
        return 'Average'
      } else {
        return 'Poor'
      }
    } catch (error: any) {
      logger.error('Error categorizing performance:', error)
      return 'Unknown'
    }
  }

  /**
   * Normalize currency values to a standard currency (USD)
   *
   * @param amount - The amount to normalize
   * @param currency - The currency code (optional, defaults to USD)
   * @returns Normalized amount in USD
   */
  private normalizeCurrency(amount: number): number {
    // In a real implementation, you would use a currency conversion API
    // For now, we'll just return the amount as-is
    return amount
  }

  /**
   * Categorize campaign type for consistent reporting
   *
   * @param campaignType - The campaign type from Google Ads
   * @returns Categorized campaign type
   */
  private categorizeCampaignType(campaignType: string | null): string {
    if (!campaignType) {
      return 'Unknown'
    }
    
    switch (campaignType.toLowerCase()) {
      case 'search':
        return 'Search'
      case 'display':
        return 'Display'
      case 'shopping':
        return 'Shopping'
      case 'video':
        return 'Video'
      case 'app':
        return 'App'
      default:
        return 'Other'
    }
  }

  /**
   * Fix all connected accounts with temporary or mock account IDs
   * 
   * This method finds all accounts with temporary or mock IDs and attempts to
   * fetch their real customer IDs from the Google Ads API.
   * 
   * @returns Array of results for each fixed account
   */
  public async fixAllTemporaryAccountIds(): Promise<Array<{
    connectedAccountId: number;
    oldAccountId: string;
    newAccountId: string | null;
    success: boolean;
    error?: string;
  }>> {
    try {
      logger.info('Starting to fix all temporary account IDs')
      
      // Find all connected accounts with temporary or mock IDs
      const accountsToFix = await ConnectedAccount.query()
        .where('platform', 'google_ads')
        .where(builder => {
          builder
            .where('account_id', 'like', 'temp_google_ads_%')
            .orWhere('account_id', 'like', 'google_ads_account_%')
        })
        .where('is_active', true)
      
      logger.info(`Found ${accountsToFix.length} accounts with temporary IDs to fix`)
      
      const results: Array<{
        connectedAccountId: number;
        oldAccountId: string;
        newAccountId: string | null;
        success: boolean;
        error?: string;
      }> = []
      
      for (const account of accountsToFix) {
        try {
          logger.info(`Fixing account ${account.id} with ID ${account.accountId}`)
          
          // Get tokens to fetch real customer ID
          const decryptedTokens = await googleAdsOAuthService.retrieveTokens(account.id, account.userId)
          
          if (!decryptedTokens.refreshToken) {
            throw new Error('No refresh token available')
          }
          
          // Fetch the real customer ID
          const realCustomerId = await googleAdsOAuthService.getCustomerId(
            decryptedTokens.accessToken, 
            decryptedTokens.refreshToken
          )
          
          // Update the account with real customer ID
          const oldAccountId = account.accountId
          account.accountId = realCustomerId
          await account.save()
          
          results.push({
            connectedAccountId: account.id,
            oldAccountId,
            newAccountId: realCustomerId,
            success: true
          })
          
          logger.info(`Successfully fixed account ${account.id}`, {
            oldAccountId,
            newAccountId: realCustomerId
          })
        } catch (error: any) {
          logger.error(`Failed to fix account ${account.id}`, {
            error: error.message,
            accountId: account.accountId
          })
          
          // Mark account as inactive if we can't fix it
          account.isActive = false
          await account.save()
          
          results.push({
            connectedAccountId: account.id,
            oldAccountId: account.accountId,
            newAccountId: null,
            success: false,
            error: error.message
          })
        }
      }
      
      logger.info(`Finished fixing temporary account IDs. Fixed: ${results.filter(r => r.success).length}, Failed: ${results.filter(r => !r.success).length}`)
      
      return results
    } catch (error: any) {
      logger.error('Error fixing temporary account IDs:', error)
      throw new Error(`Failed to fix temporary account IDs: ${error.message}`)
    }
  }

  /**
   * Calculate efficiency score based on campaign performance
   *
   * @param campaignData - The campaign data to calculate efficiency for
   * @returns Efficiency score (0-100)
   */
  private calculateEfficiencyScore(campaignData: CampaignData): number {
    try {
      // Calculate efficiency based on multiple factors:
      // 1. CTR (10% weight)
      // 2. CPC (10% weight)
      // 3. Conversion rate (40% weight)
      // 4. ROAS (40% weight)
      
      const ctr = campaignData.impressions > 0 ? (campaignData.clicks / campaignData.impressions) * 100 : 0
      const cpc = campaignData.clicks > 0 ? campaignData.spend / campaignData.clicks : 0
      const conversionRate = campaignData.clicks > 0 ? (campaignData.conversions / campaignData.clicks) * 100 : 0
      const roas = campaignData.spend > 0 ? campaignData.conversions / campaignData.spend : 0
      
      // Normalize each metric to a 0-100 scale
      const ctrScore = Math.min(100, ctr * 10) // Assume good CTR is 10%
      const cpcScore = Math.max(0, 100 - (cpc * 10)) // Lower CPC is better
      const conversionRateScore = Math.min(100, conversionRate * 100) // Assume good conversion rate is 1%
      const roasScore = Math.min(100, roas * 100) // Assume good ROAS is 1
      
      // Calculate weighted score
      const efficiencyScore = (
        (ctrScore * 0.1) +
        (cpcScore * 0.1) +
        (conversionRateScore * 0.4) +
        (roasScore * 0.4)
      )
      
      return Math.round(efficiencyScore)
    } catch (error: any) {
      logger.error('Error calculating efficiency score:', error)
      return 0
    }
  }

  /**
   * Get campaign data for a specific date range with enriched metrics
   * 
   * @param connectedAccountId - The ID of the connected account
   * @param userId - The ID of the user requesting the data (for rate limiting)
   * @param dateRange - Date range configuration
   * @returns Array of enriched campaign data
   */
  public async getEnrichedCampaignData(
    connectedAccountId: number,
    userId: number,
    dateRange?: {
      type: 'today' | 'last_7_days' | 'last_30_days' | 'custom',
      startDate?: string,
      endDate?: string
    }
  ): Promise<any[]> {
    try {
      // Sync data first with rate limiting
      await this.syncCampaignData(connectedAccountId, userId, dateRange)
      
      // Get the campaign data from database
      let query = CampaignData.query().where('connected_account_id', connectedAccountId)
      
      // Apply date filtering if specified
      if (dateRange) {
        switch (dateRange.type) {
          case 'today':
            query = query.where('date', DateTime.now().toSQLDate())
            break
          case 'last_7_days':
            query = query.where('date', '>=', DateTime.now().minus({ days: 7 }).toSQLDate())
            break
          case 'last_30_days':
            query = query.where('date', '>=', DateTime.now().minus({ days: 30 }).toSQLDate())
            break
          case 'custom':
            if (dateRange.startDate) {
              query = query.where('date', '>=', dateRange.startDate)
            }
            if (dateRange.endDate) {
              query = query.where('date', '<=', dateRange.endDate)
            }
            break
        }
      }
      
      const campaignData = await query.orderBy('date', 'desc')
      
      // Enrich the data with additional metrics
      const enrichedData = campaignData.map(data => this.enrichCampaignData(data))
      
      return enrichedData
    } catch (error: any) {
      logger.error('Error getting enriched campaign data:', {
        message: error.message,
        stack: error.stack,
        code: error.code,
        details: error.details,
        name: error.name,
        fullError: JSON.stringify(error, Object.getOwnPropertyNames(error))
      })
      throw new Error(`Failed to get enriched campaign data: ${error.message}`)
    }
  }
}

// Export a singleton instance of the service
export default new GoogleAdsService()
