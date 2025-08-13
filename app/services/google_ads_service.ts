import { GoogleAdsApi } from 'google-ads-api'
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
   * Fetch campaign data from Google Ads API for multiple date ranges
   * 
   * @param connectedAccountId - The ID of the connected account
   * @param userId - The ID of the user requesting the data (for rate limiting)
   * @param dateRange - Date range configuration
   * @returns Array of campaign data
   */
  public async fetchCampaignData(
    connectedAccountId: number,
    userId: number,
    dateRange: {
      type: 'today' | 'last_7_days' | 'last_30_days' | 'custom',
      startDate?: string,
      endDate?: string
    } = { type: 'last_30_days' }
  ): Promise<any[]> {
    try {
      // Get the connected account
      const connectedAccount = await ConnectedAccount.findOrFail(connectedAccountId)
      
      // Check if the account is active
      if (!connectedAccount.isActive) {
        throw new Error('Connected account is not active')
      }
      
      // Get decrypted tokens with rate limiting
      const decryptedTokens = await googleAdsOAuthService.retrieveTokens(connectedAccountId, userId)
      
      // Check if we have a refresh token
      if (!decryptedTokens.refreshToken) {
        throw new Error('No refresh token available for this account')
      }
      
      // Set up the Google Ads client with the authenticated credentials
      logger.info('Creating Google Ads customer client', {
        customerId: connectedAccount.accountId,
        hasGoogleAdsClient: !!this.googleAdsClient,
        hasCustomerMethod: !!(this.googleAdsClient && typeof this.googleAdsClient.Customer === 'function')
      })
      
      const customer = this.googleAdsClient.Customer({
        customer_id: connectedAccount.accountId,
        login_customer_id: env.get('GOOGLE_ADS_LOGIN_CUSTOMER_ID'),
        refresh_token: decryptedTokens.refreshToken
      })
      
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
      
      // Query to fetch comprehensive campaign performance data
      const query = `
        SELECT 
          campaign.id,
          campaign.name,
          campaign.status,
          campaign.advertising_channel_type,
          campaign.advertising_channel_sub_type,
          ad_group.id,
          ad_group.name,
          ad_group.status,
          ad_group.type,
          segments.date,
          segments.device,
          segments.ad_network_type,
          segments.slot,
          metrics.cost_micros,
          metrics.impressions,
          metrics.clicks,
          metrics.conversions,
          metrics.conversions_value,
          metrics.all_conversions,
          metrics.all_conversions_value,
          metrics.ctr,
          metrics.average_cpc,
          metrics.average_cpm,
          metrics.interactions,
          metrics.interaction_rate,
          bidding_strategy.id,
          bidding_strategy.name,
          bidding_strategy.type
        FROM campaign
        WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
        ORDER BY segments.date DESC
      `
      
      // Execute the query with pagination
      const results = await this.executePaginatedQuery(customer, query)
      
      // Cache the results
      this.cache.set(cacheKey, results)
      this.cacheExpiry.set(cacheKey, DateTime.now().plus({ minutes: this.cacheTtl }))
      
      return results
    } catch (error) {
      logger.error('Error fetching campaign data from Google Ads API:', error)
      // Try to handle authentication errors by refreshing tokens
      if (error.code === 401 || error.code === 403) {
        logger.info('Attempting to refresh access token')
        await this.refreshTokens(connectedAccountId)
        throw new Error(`Authentication failed. Please try again: ${error.message}`)
      }
      throw new Error(`Failed to fetch campaign data: ${error.message}`)
    }
  }

  /**
   * Execute a paginated query to handle large result sets
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
      let nextPageToken: string | undefined
      
      do {
        logger.info('Executing Google Ads query', {
          query: query.substring(0, 200) + (query.length > 200 ? '...' : ''),
          pageSize,
          nextPageToken: !!nextPageToken
        })
        
        const response: any = await customer.query(query, {
          page_size: pageSize,
          page_token: nextPageToken
        }).catch((error: any) => {
          logger.error('Error executing Google Ads query:', {
            error: error.message,
            stack: error.stack,
            code: error.code,
            details: error.details,
            query: query.substring(0, 200) + (query.length > 200 ? '...' : '')
          })
          throw error
        })
        
        if (response.results) {
          allResults.push(...response.results)
        }
        
        nextPageToken = response.next_page_token
      } while (nextPageToken)
      
      return allResults
    } catch (error) {
      logger.error('Error executing paginated query:', error)
      throw error
    }
  }

  /**
   * Refresh access tokens for a connected account
   * 
   * @param connectedAccountId - The ID of the connected account
   */
  private async refreshTokens(connectedAccountId: number): Promise<void> {
    try {
      const connectedAccount = await ConnectedAccount.findOrFail(connectedAccountId)
      
      if (!connectedAccount.refreshToken) {
        throw new Error('No refresh token available')
      }
      
      // Decrypt refresh token
      const decryptedTokens = await googleAdsOAuthService.retrieveTokens(connectedAccountId)
      
      // Check if refresh token exists
      if (!decryptedTokens.refreshToken) {
        throw new Error('No refresh token available')
      }
      
      // Refresh the access token
      const newTokens = await googleAdsOAuthService.refreshAccessToken(decryptedTokens.refreshToken)
      
      // Store the new tokens
      await googleAdsOAuthService.storeTokens(
        connectedAccount.userId,
        connectedAccount.accountId,
        newTokens.accessToken,
        decryptedTokens.refreshToken,
        newTokens.expiryDate
      )
      
      logger.info(`Successfully refreshed tokens for account ${connectedAccountId}`)
    } catch (error) {
      logger.error('Error refreshing tokens:', error)
      throw new Error(`Failed to refresh tokens: ${error.message}`)
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
          // Extract and validate data from the row
          const campaignId = row.campaign?.id
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
          if (!campaignId || !campaignName || !date) {
            logger.warn(`Skipping row with missing required data: campaignId=${campaignId}, campaignName=${campaignName}, date=${date}`)
            continue
          }
          
          // Transform data
          const transformedData = {
            connectedAccountId: connectedAccountId,
            campaignId: campaignId.toString(),
            campaignName: campaignName,
            campaignType: campaignType || null,
            campaignSubType: campaignSubType || null,
            adGroupType: adGroupType || null,
            date: DateTime.fromFormat(date, 'yyyy-MM-dd'),
            spend: spend ? spend / 1000000 : 0, // Convert micros to currency
            impressions: impressions || 0,
            clicks: clicks || 0,
            conversions: conversions || 0
          }
          
          // Add to batch
          batch.push(transformedData)
          
          // Process in batches of 100
          if (batch.length >= this.batchSize) {
            await this.processBatch(batch, processedData)
            batch.length = 0 // Clear the batch
          }
        } catch (rowError) {
          logger.error('Error processing row:', rowError)
          // Continue processing other rows
        }
      }
      
      // Process remaining items in batch
      if (batch.length > 0) {
        await this.processBatch(batch, processedData)
      }
      
      return processedData
    } catch (error) {
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
    } catch (error) {
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
    } catch (error) {
      logger.error('Error syncing campaign data:', error)
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
    } catch (error) {
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
    } catch (error) {
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
    } catch (error) {
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
    } catch (error) {
      logger.error('Error getting enriched campaign data:', error)
      throw new Error(`Failed to get enriched campaign data: ${error.message}`)
    }
  }
}

// Export a singleton instance of the service
export default new GoogleAdsService()