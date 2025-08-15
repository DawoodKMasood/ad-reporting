import env from '#start/env'
import ConnectedAccount from '#models/connected_account'
import CampaignData from '#models/campaign_data'
import googleAdsOAuthService from './google_ads_oauth_service.js'
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'
import { GoogleAdsApi, services, enums, MutateOperation } from 'google-ads-api'

export class GoogleAdsService {
  private cache: Map<string, any> = new Map()
  private cacheExpiry: Map<string, DateTime> = new Map()
  private cacheTtl: number = 10

  private async getCustomerClient(connectedAccountId: number, userId: number) {
    try {
      logger.info('Getting customer client', { connectedAccountId, userId })
      const connectedAccount = await ConnectedAccount.findOrFail(connectedAccountId)
      logger.info('Found connected account', { accountId: connectedAccount.accountId })

      // Get the properly configured Google Ads client from the OAuth service
      const { client, refreshToken } = await googleAdsOAuthService.getGoogleAdsClient(connectedAccountId, userId)
      logger.info('Got Google Ads client from OAuth service', { hasClient: !!client, hasRefreshToken: !!refreshToken })

      const config: any = {
        customer_id: connectedAccount.accountId,
        refresh_token: refreshToken,
      }

      const loginCustomerId = env.get('GOOGLE_ADS_LOGIN_CUSTOMER_ID')
      if (loginCustomerId && loginCustomerId !== connectedAccount.accountId) {
        config.login_customer_id = loginCustomerId
      }

      logger.info('Creating customer instance with config', { config })
      const customer = client.Customer(config)
      logger.info('Created customer instance successfully')
      return customer
    } catch (error: any) {
      logger.error('Error getting customer client:', {
        message: error?.message,
        stack: error?.stack,
        code: error?.code,
        status: error?.status,
        name: error?.name,
        details: error?.details,
        response: error?.response,
        toString: error?.toString(),
        fullError: error,
        connectedAccountId,
        userId
      })
      throw new Error(`Failed to get customer client: ${error.message || error.toString() || 'Unknown error'}`)
    }
  }

  public async getAccessibleCustomers(connectedAccountId: number, userId: number) {
    try {
      const { client, refreshToken } = await googleAdsOAuthService.getGoogleAdsClient(connectedAccountId, userId)

      const result = await client.listAccessibleCustomers(refreshToken)
      logger.info('listAccessibleCustomers result', { result })
      return result.resource_names || []
    } catch (error: any) {
      logger.error('Error fetching accessible customers:', error);
      throw new Error(`Failed to fetch accessible customers: ${error.message}`);
    }
  }

  public async getChildAccounts(connectedAccountId: number, userId: number) {
    try {
      logger.info('Getting child accounts for manager account', { connectedAccountId })
      const customer = await this.getCustomerClient(connectedAccountId, userId)

      const query = `
        SELECT
          customer_client.id,
          customer_client.descriptive_name,
          customer_client.currency_code,
          customer_client.time_zone,
          customer_client.test_account,
          customer_client.manager,
          customer_client.status
        FROM customer_client
        WHERE customer_client.status = 'ENABLED'
        ORDER BY customer_client.descriptive_name
      `

      const results = await customer.query(query)
      logger.info('Child accounts query result', { count: results?.length || 0 })
      return results || []
    } catch (error: any) {
      logger.error('Error fetching child accounts:', error)
      throw new Error(`Failed to fetch child accounts: ${error.message}`)
    }
  }

  public async isManagerAccount(connectedAccountId: number, userId: number): Promise<boolean> {
    try {
      const connectedAccount = await ConnectedAccount.findOrFail(connectedAccountId)
      
      // Check if we already know this is a manager account
      if (connectedAccount.isManagerAccount !== null && connectedAccount.isManagerAccount !== undefined) {
        return connectedAccount.isManagerAccount
      }

      // Query Google Ads API to check if this is a manager account
      const customer = await this.getCustomerClient(connectedAccountId, userId)
      
      const query = `
        SELECT
          customer.manager,
          customer.test_account
        FROM customer
        LIMIT 1
      `

      const results = await customer.query(query)
      const isManager = results?.[0]?.customer?.manager || false
      
      // Update the connected account with this information
      connectedAccount.isManagerAccount = isManager
      await connectedAccount.save()
      
      return isManager
    } catch (error: any) {
      logger.error('Error checking if manager account:', error)
      // Default to false if we can't determine
      return false
    }
  }

  public async fetchCampaignDataForManagerAccount(
    connectedAccountId: number,
    userId: number,
    dateRange: {
      type: 'today' | 'last_7_days' | 'last_30_days' | 'custom',
      startDate?: string,
      endDate?: string
    } = { type: 'last_30_days' }
  ) {
    try {
      logger.info('Fetching campaign data for manager account', { connectedAccountId })
      
      // Get child accounts
      const childAccounts = await this.getChildAccounts(connectedAccountId, userId)
      logger.info('Found child accounts', { count: childAccounts.length })
      
      if (childAccounts.length === 0) {
        logger.warn('No child accounts found for manager account - trying direct campaign access')
        
        // Try to fetch campaigns directly from the manager account
        // Some manager accounts might have their own campaigns
        try {
          logger.info('Attempting to fetch campaigns directly from manager account')
          const managerCampaigns = await this.fetchCampaignData(connectedAccountId, userId, dateRange)
          
          if (managerCampaigns.length > 0) {
            logger.info('Found campaigns directly on manager account', { count: managerCampaigns.length })
            return managerCampaigns
          }
        } catch (managerError: any) {
          logger.warn('Manager account direct campaign fetch failed:', managerError.message)
          // This is expected for most manager accounts
        }
        
        // If we get here, the manager account truly has no accessible data
        logger.warn('Manager account has no accessible campaigns or child accounts')
        
        // Throw a specific error that the controller can catch
        throw new Error('Manager account has no accessible child accounts or campaigns')
      }

      const allCampaignData: any[] = []
      
      // Fetch campaign data for each child account
      for (const childAccount of childAccounts) {
        try {
          const childCustomerId = childAccount.customer_client?.id
          if (!childCustomerId) {
            logger.warn('Child account missing ID, skipping')
            continue
          }

          logger.info('Fetching data for child account', { childCustomerId })
          
          // Create a temporary customer client for the child account
          const { client, refreshToken } = await googleAdsOAuthService.getGoogleAdsClient(connectedAccountId, userId)
          
          const childCustomer = client.Customer({
            customer_id: childCustomerId,
            refresh_token: refreshToken,
          })

          const { startDate, endDate } = this.calculateDateRange(dateRange)
          
          let results: any[]
          if (dateRange.type === 'custom' || dateRange.type === 'today') {
            results = await childCustomer.report({
              entity: 'campaign',
              attributes: [
                'campaign.id',
                'campaign.name',
                'campaign.status',
                'campaign.advertising_channel_type',
                'campaign.advertising_channel_sub_type'
              ],
              metrics: [
                'metrics.impressions',
                'metrics.clicks',
                'metrics.cost_micros',
                'metrics.conversions'
              ],
              segments: [
                'segments.date'
              ],
              constraints: [{
                key: 'segments.date',
                op: 'BETWEEN',
                val: [startDate, endDate]
              }, {
                key: 'campaign.status',
                op: '!=',
                val: 'REMOVED'
              }],
              order_by: 'segments.date'
            })
          } else {
            let duringClause: string
            switch (dateRange.type) {
              case 'last_7_days':
                duringClause = 'LAST_7_DAYS'
                break
              case 'last_30_days':
              default:
                duringClause = 'LAST_30_DAYS'
                break
            }
            
            results = await childCustomer.report({
              entity: 'campaign',
              attributes: [
                'campaign.id',
                'campaign.name',
                'campaign.status',
                'campaign.advertising_channel_type',
                'campaign.advertising_channel_sub_type'
              ],
              metrics: [
                'metrics.impressions',
                'metrics.clicks',
                'metrics.cost_micros',
                'metrics.conversions'
              ],
              segments: [
                'segments.date'
              ],
              constraints: [{
                key: 'segments.date',
                op: 'DURING',
                val: duringClause
              }, {
                key: 'campaign.status',
                op: '!=',
                val: 'REMOVED'
              }],
              order_by: 'segments.date'
            })
          }

          // Add child account identifier to each result
          const enrichedResults = results.map(result => ({
            ...result,
            childAccountId: childCustomerId,
            childAccountName: childAccount.customer_client?.descriptive_name || `Account ${childCustomerId}`
          }))
          
          allCampaignData.push(...enrichedResults)
          logger.info('Fetched campaign data for child account', { 
            childCustomerId, 
            dataCount: results.length 
          })
          
        } catch (childError: any) {
          logger.error('Error fetching data for child account', {
            childAccountId: childAccount.customer_client?.id,
            error: childError.message
          })
          // Continue with other child accounts even if one fails
          continue
        }
      }
      
      logger.info('Completed fetching campaign data for all child accounts', {
        totalDataCount: allCampaignData.length
      })
      
      return allCampaignData
      
    } catch (error: any) {
      logger.error('Error fetching campaign data for manager account:', error)
      throw new Error(`Failed to fetch campaign data for manager account: ${error.message}`)
    }
  }

  public async fetchCampaignData(
    connectedAccountId: number,
    userId: number,
    dateRange: {
      type: 'today' | 'last_7_days' | 'last_30_days' | 'custom',
      startDate?: string,
      endDate?: string
    } = { type: 'last_30_days' }
  ) {
    try {
      logger.info('Starting fetchCampaignData', { connectedAccountId, userId, dateRange })
      const { startDate, endDate } = this.calculateDateRange(dateRange)
      logger.info('Calculated date range', { startDate, endDate })
      const cacheKey = `campaign_data_${connectedAccountId}_${startDate}_${endDate}`

      if (this.isCacheValid(cacheKey)) {
        logger.info('Returning cached data', { cacheKey })
        return this.cache.get(cacheKey)
      }

      logger.info('Getting customer client', { connectedAccountId, userId })
      const customer = await this.getCustomerClient(connectedAccountId, userId)
      logger.info('Got customer client successfully')

      // For incremental syncs, we still need to use BETWEEN, but for standard ranges we can use DURING
      let query: string;
      if (dateRange.type === 'custom' || dateRange.type === 'today') {
        // Use BETWEEN for custom date ranges
        query = `
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
        `;
      } else {
        // Use DURING for standard date ranges
        let duringClause: string;
        switch (dateRange.type) {
          case 'last_7_days':
            duringClause = 'LAST_7_DAYS';
            break;
          case 'last_30_days':
          default:
            duringClause = 'LAST_30_DAYS';
            break;
        }
        
        query = `
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
          WHERE segments.date DURING ${duringClause}
          AND campaign.status != 'REMOVED'
          ORDER BY segments.date DESC, campaign.id
        `;
      }

      logger.info('Google Ads API Query:', { query, dateRange, startDate, endDate })
      
      try {
        // Try using the report method instead of query
        let results: any[];
        if (dateRange.type === 'custom' || dateRange.type === 'today') {
          // Use report method with constraints for custom date ranges
          results = await customer.report({
            entity: 'campaign',
            attributes: [
              'campaign.id',
              'campaign.name',
              'campaign.status',
              'campaign.advertising_channel_type',
              'campaign.advertising_channel_sub_type'
            ],
            metrics: [
              'metrics.impressions',
              'metrics.clicks',
              'metrics.cost_micros',
              'metrics.conversions'
            ],
            segments: [
              'segments.date'
            ],
            constraints: [{
              key: 'segments.date',
              op: 'BETWEEN',
              val: [startDate, endDate]
            }, {
              key: 'campaign.status',
              op: '!=',
              val: 'REMOVED'
            }],
            order_by: 'segments.date'
          })
        } else {
          // Use report method with DURING for standard date ranges
          let duringClause: string;
          switch (dateRange.type) {
            case 'last_7_days':
              duringClause = 'LAST_7_DAYS';
              break;
            case 'last_30_days':
            default:
              duringClause = 'LAST_30_DAYS';
              break;
          }
          
          results = await customer.report({
            entity: 'campaign',
            attributes: [
              'campaign.id',
              'campaign.name',
              'campaign.status',
              'campaign.advertising_channel_type',
              'campaign.advertising_channel_sub_type'
            ],
            metrics: [
              'metrics.impressions',
              'metrics.clicks',
              'metrics.cost_micros',
              'metrics.conversions'
            ],
            segments: [
              'segments.date'
            ],
            constraints: [{
              key: 'segments.date',
              op: 'DURING',
              val: duringClause
            }, {
              key: 'campaign.status',
              op: '!=',
              val: 'REMOVED'
            }],
            order_by: 'segments.date'
          })
        }
        logger.info('Google Ads API Response:', { results: results?.length || 0 })
        return results
      } catch (reportError: any) {
        logger.error('Error executing Google Ads API report:', {
          message: reportError?.message,
          stack: reportError?.stack,
          code: reportError?.code,
          status: reportError?.status,
          name: reportError?.name,
          details: reportError?.details,
          response: reportError?.response,
          toString: reportError?.toString(),
          fullError: reportError,
          dateRange,
          startDate,
          endDate
        })
        
        // Check for specific manager account error
        const errorString = JSON.stringify(reportError)
        if (errorString.includes('REQUESTED_METRICS_FOR_MANAGER') || 
            errorString.includes('Metrics cannot be requested for a manager account')) {
          logger.warn('Manager account detected via API error - switching to child account sync')
          
          // Update the connected account to mark it as a manager account
          const connectedAccount = await ConnectedAccount.findOrFail(connectedAccountId)
          connectedAccount.isManagerAccount = true
          await connectedAccount.save()
          
          // Try fetching data for manager account instead
          return await this.fetchCampaignDataForManagerAccount(connectedAccountId, userId, dateRange)
        }
        
        // Better error formatting to avoid [object Object] issue
        let errorMessage = 'Unknown error';
        if (reportError?.message) {
          errorMessage = reportError.message;
        } else if (reportError?.details) {
          errorMessage = JSON.stringify(reportError.details);
        } else if (reportError?.response) {
          errorMessage = JSON.stringify(reportError.response);
        } else if (reportError?.toString && reportError.toString() !== '[object Object]') {
          errorMessage = reportError.toString();
        } else {
          errorMessage = JSON.stringify(reportError);
        }
        
        throw new Error(`Failed to execute Google Ads API report: ${errorMessage}`)
      }

    } catch (error: any) {
      logger.error('Error fetching campaign data:', {
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
      
      // Better error formatting to avoid [object Object] issue
      let errorMessage = 'Unknown error';
      if (error?.message) {
        errorMessage = error.message;
      } else if (error?.details) {
        errorMessage = JSON.stringify(error.details);
      } else if (error?.response) {
        errorMessage = JSON.stringify(error.response);
      } else if (error?.toString && error.toString() !== '[object Object]') {
        errorMessage = error.toString();
      } else {
        errorMessage = JSON.stringify(error);
      }
      
      throw new Error(`Failed to fetch campaign data: ${errorMessage}`)
    }
  }

  public async processAndStoreCampaignData(connectedAccountId: number, rawData: any[]) {
    const processedData: CampaignData[] = []
    const batchSize = 100

    for (let i = 0; i < rawData.length; i += batchSize) {
      const batch = rawData.slice(i, i + batchSize).map(row => {
        // For manager accounts, we include child account info in the campaign name
        let campaignName = row.campaign?.name
        if (row.childAccountName && row.childAccountId) {
          campaignName = `[${row.childAccountName}] ${campaignName}`
        }
        
        return {
          connectedAccountId,
          campaignId: row.campaign?.id?.toString(),
          campaignName,
          campaignType: row.campaign?.advertising_channel_type || null,
          campaignSubType: row.campaign?.advertising_channel_sub_type || null,
          date: row.segments?.date ? DateTime.fromFormat(row.segments.date, 'yyyy-MM-dd') : DateTime.now(),
          spend: row.metrics?.cost_micros ? parseFloat(row.metrics.cost_micros) / 1000000 : 0,
          impressions: row.metrics?.impressions ? parseInt(row.metrics.impressions) : 0,
          clicks: row.metrics?.clicks ? parseInt(row.metrics.clicks) : 0,
          conversions: row.metrics?.conversions ? parseFloat(row.metrics.conversions) : 0,
          // Store additional metadata for manager accounts
          metadata: row.childAccountId ? {
            childAccountId: row.childAccountId,
            childAccountName: row.childAccountName
          } : null
        }
      }).filter(data => data.campaignId && data.campaignName)

      if (batch.length > 0) {
        const created = await CampaignData.createMany(batch)
        processedData.push(...created)
      }
    }

    return processedData
  }

  public async syncCampaignData(connectedAccountId: number, userId: number, dateRange?: any) {
    try {
      const connectedAccount = await ConnectedAccount.findOrFail(connectedAccountId)

      // Check if this is a manager account
      const isManager = await this.isManagerAccount(connectedAccountId, userId)
      
      const syncDateRange = dateRange || this.getIncrementalDateRange(connectedAccount)
      
      let rawData: any[]
      if (isManager) {
        logger.info('Syncing manager account - fetching data from child accounts', { connectedAccountId })
        rawData = await this.fetchCampaignDataForManagerAccount(connectedAccountId, userId, syncDateRange)
      } else {
        logger.info('Syncing regular account', { connectedAccountId })
        rawData = await this.fetchCampaignData(connectedAccountId, userId, syncDateRange)
      }
      
      const processedData = await this.processAndStoreCampaignData(connectedAccountId, rawData)

      connectedAccount.lastSyncAt = DateTime.now()
      await connectedAccount.save()

      return processedData
    } catch (error: any) {
      logger.error('Error syncing campaign data:', error)
      
      // Better error formatting to avoid [object Object] issue
      let errorMessage = 'Unknown error';
      if (error?.message) {
        errorMessage = error.message;
      } else if (error?.details) {
        errorMessage = JSON.stringify(error.details);
      } else if (error?.response) {
        errorMessage = JSON.stringify(error.response);
      } else if (error?.toString && error.toString() !== '[object Object]') {
        errorMessage = error.toString();
      } else {
        errorMessage = JSON.stringify(error);
      }
      
      throw new Error(`Failed to sync campaign data: ${errorMessage}`)
    }
  }

  public async getEnrichedCampaignData(connectedAccountId: number, userId: number, dateRange?: any) {
    try {
      await this.syncCampaignData(connectedAccountId, userId, dateRange)

      let query = CampaignData.query().where('connected_account_id', connectedAccountId)

      if (dateRange) {
        const { startDate, endDate } = this.calculateDateRange(dateRange)
        query = query.whereBetween('date', [startDate, endDate])
      }

      const campaignData = await query.orderBy('date', 'desc')
      return campaignData.map(data => this.enrichCampaignData(data))
    } catch (error: any) {
      logger.error('Error getting enriched campaign data:', error)
      
      // Check for manager account with no accessible child accounts
      if (error.message && error.message.includes('no accessible campaigns or child accounts')) {
        const connectedAccount = await ConnectedAccount.findOrFail(connectedAccountId)
        if (connectedAccount.isManagerAccount) {
          throw new Error('Manager account has no accessible child accounts or campaigns')
        }
      }
      
      // For manager accounts with no accessible child accounts, return existing data instead of throwing
      if (error.message && (error.message.includes('manager account') || error.message.includes('child accounts'))) {
        logger.warn('Manager account sync failed, returning existing data only')
        
        let query = CampaignData.query().where('connected_account_id', connectedAccountId)
        if (dateRange) {
          const { startDate, endDate } = this.calculateDateRange(dateRange)
          query = query.whereBetween('date', [startDate, endDate])
        }
        const campaignData = await query.orderBy('date', 'desc')
        return campaignData.map(data => this.enrichCampaignData(data))
      }
      
      throw error
    }
  }

  public enrichCampaignData(campaignData: CampaignData) {
    const ctr = campaignData.impressions > 0 ? (campaignData.clicks / campaignData.impressions) * 100 : 0
    const cpc = campaignData.clicks > 0 ? campaignData.spend / campaignData.clicks : 0
    const cpa = campaignData.conversions > 0 ? campaignData.spend / campaignData.conversions : 0
    const cpm = campaignData.impressions > 0 ? (campaignData.spend / campaignData.impressions) * 1000 : 0

    return {
      ...campaignData.serialize(),
      ctr,
      cpc,
      cpa,
      cpm,
      performanceCategory: this.categorizePerformance(ctr, cpc),
      campaignCategory: this.categorizeCampaignType(campaignData.campaignType),
      efficiencyScore: this.calculateEfficiencyScore(ctr, cpc, campaignData.conversions, campaignData.clicks, campaignData.spend)
    }
  }

  // Enhanced API Methods
  public async getCampaigns(connectedAccountId: number, userId: number) {
    const customer = await this.getCustomerClient(connectedAccountId, userId)

    const query = `
      SELECT 
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        campaign.advertising_channel_sub_type,
        campaign.start_date,
        campaign.end_date,
        segments.date,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.ctr,
        metrics.average_cpc
      FROM campaign
      WHERE segments.date DURING LAST_30_DAYS
      AND campaign.status != 'REMOVED'
      ORDER BY campaign.id
    `

    return await customer.report({
      entity: 'campaign',
      attributes: [
        'campaign.id',
        'campaign.name',
        'campaign.status',
        'campaign.advertising_channel_type',
        'campaign.advertising_channel_sub_type',
        'campaign.start_date',
        'campaign.end_date'
      ],
      metrics: [
        'metrics.impressions',
        'metrics.clicks',
        'metrics.cost_micros',
        'metrics.conversions',
        'metrics.ctr',
        'metrics.average_cpc'
      ],
      segments: [
        'segments.date'
      ],
      constraints: [{
        key: 'segments.date',
        op: 'DURING',
        val: 'LAST_30_DAYS'
      }, {
        key: 'campaign.status',
        op: '!=',
        val: 'REMOVED'
      }],
      order_by: 'campaign.id'
    })
  }

  public async getAdGroups(connectedAccountId: number, userId: number, campaignId?: string) {
    const customer = await this.getCustomerClient(connectedAccountId, userId)

    const whereClause = campaignId ? `AND campaign.id = ${campaignId}` : ''

    const query = `
      SELECT 
        ad_group.id,
        ad_group.name,
        ad_group.status,
        ad_group.type,
        campaign.id,
        campaign.name,
        segments.date,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions
      FROM ad_group
      WHERE segments.date DURING LAST_7_DAYS
      AND ad_group.status != 'REMOVED'
      ${whereClause}
      ORDER BY ad_group.id
    `

    return await customer.report({
      entity: 'ad_group',
      attributes: [
        'ad_group.id',
        'ad_group.name',
        'ad_group.status',
        'ad_group.type',
        'campaign.id',
        'campaign.name'
      ],
      metrics: [
        'metrics.impressions',
        'metrics.clicks',
        'metrics.cost_micros',
        'metrics.conversions'
      ],
      segments: [
        'segments.date'
      ],
      constraints: [{
        key: 'segments.date',
        op: 'DURING',
        val: 'LAST_7_DAYS'
      }, {
        key: 'ad_group.status',
        op: '!=',
        val: 'REMOVED'
      }],
      order_by: 'ad_group.id'
    })
  }

  public async getKeywords(connectedAccountId: number, userId: number, adGroupId?: string) {
    const customer = await this.getCustomerClient(connectedAccountId, userId)

    const whereClause = adGroupId ? `AND ad_group.id = ${adGroupId}` : ''

    const query = `
      SELECT 
        keyword_view.resource_name,
        ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type,
        ad_group_criterion.status,
        ad_group.id,
        ad_group.name,
        campaign.id,
        campaign.name,
        segments.date,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.ctr,
        metrics.average_cpc,
        metrics.quality_score
      FROM keyword_view
      WHERE segments.date DURING LAST_7_DAYS
      AND ad_group_criterion.status != 'REMOVED'
      ${whereClause}
      ORDER BY ad_group.id
    `

    return await customer.report({
      entity: 'keyword_view',
      attributes: [
        'keyword_view.resource_name',
        'ad_group_criterion.keyword.text',
        'ad_group_criterion.keyword.match_type',
        'ad_group_criterion.status',
        'ad_group.id',
        'ad_group.name',
        'campaign.id',
        'campaign.name'
      ],
      metrics: [
        'metrics.impressions',
        'metrics.clicks',
        'metrics.cost_micros',
        'metrics.conversions',
        'metrics.ctr',
        'metrics.average_cpc',
        'metrics.impressions'
      ],
      segments: [
        'segments.date'
      ],
      constraints: [{
        key: 'segments.date',
        op: 'DURING',
        val: 'LAST_7_DAYS'
      }, {
        key: 'ad_group_criterion.status',
        op: '!=',
        val: 'REMOVED'
      }],
      order_by: 'ad_group.id'
    })
  }

  public async getAds(connectedAccountId: number, userId: number, adGroupId?: string) {
    const customer = await this.getCustomerClient(connectedAccountId, userId)

    const whereClause = adGroupId ? `AND ad_group.id = ${adGroupId}` : ''

    const query = `
      SELECT 
        ad_group_ad.ad.id,
        ad_group_ad.ad.type,
        ad_group_ad.status,
        ad_group_ad.ad.expanded_text_ad.headline_part1,
        ad_group_ad.ad.expanded_text_ad.headline_part2,
        ad_group_ad.ad.expanded_text_ad.description,
        ad_group.id,
        ad_group.name,
        campaign.id,
        campaign.name,
        segments.date,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.ctr
      FROM ad_group_ad
      WHERE segments.date DURING LAST_7_DAYS
      AND ad_group_ad.status != 'REMOVED'
      ${whereClause}
      ORDER BY ad_group.id
    `

    return await customer.report({
      entity: 'ad_group_ad',
      attributes: [
        'ad_group_ad.ad.id',
        'ad_group_ad.ad.type',
        'ad_group_ad.status',
        'ad_group_ad.ad.expanded_text_ad.headline_part1',
        'ad_group_ad.ad.expanded_text_ad.headline_part2',
        'ad_group_ad.ad.expanded_text_ad.description',
        'ad_group.id',
        'ad_group.name',
        'campaign.id',
        'campaign.name'
      ],
      metrics: [
        'metrics.impressions',
        'metrics.clicks',
        'metrics.cost_micros',
        'metrics.conversions',
        'metrics.ctr'
      ],
      segments: [
        'segments.date'
      ],
      constraints: [{
        key: 'segments.date',
        op: 'DURING',
        val: 'LAST_7_DAYS'
      }, {
        key: 'ad_group_ad.status',
        op: '!=',
        val: 'REMOVED'
      }],
      order_by: 'ad_group.id'
    })
  }

  public async getConversionActions(connectedAccountId: number, userId: number) {
    const customer = await this.getCustomerClient(connectedAccountId, userId)

    const query = `
      SELECT 
        conversion_action.id,
        conversion_action.name,
        conversion_action.type,
        conversion_action.status,
        conversion_action.category
      FROM conversion_action
      WHERE conversion_action.status != 'REMOVED'
      ORDER BY conversion_action.id
    `

    return await customer.report({
      entity: 'conversion_action',
      attributes: [
        'conversion_action.id',
        'conversion_action.name',
        'conversion_action.type',
        'conversion_action.status',
        'conversion_action.category'
      ],
      constraints: [{
        key: 'conversion_action.status',
        op: '!=',
        val: 'REMOVED'
      }],
      order_by: 'conversion_action.id'
    })
  }

  public async getAudienceInsights(connectedAccountId: number, userId: number) {
    const customer = await this.getCustomerClient(connectedAccountId, userId)

    const query = `
      SELECT
        age_range_view.resource_name,
        ad_group_criterion.age_range.type,
        segments.date,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros
      FROM age_range_view
      WHERE segments.date DURING LAST_30_DAYS
      ORDER BY metrics.impressions DESC
    `

    return await customer.query(query)
  }

  public async getGenderInsights(connectedAccountId: number, userId: number) {
    const customer = await this.getCustomerClient(connectedAccountId, userId)

    const query = `
      SELECT
        gender_view.resource_name,
        ad_group_criterion.gender.type,
        segments.date,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros
      FROM gender_view
      WHERE segments.date DURING LAST_30_DAYS
      ORDER BY metrics.impressions DESC
    `

    return await customer.query(query)
  }

  public async getLocationInsights(connectedAccountId: number, userId: number) {
    const customer = await this.getCustomerClient(connectedAccountId, userId)

    const query = `
      SELECT 
        location_view.resource_name,
        location_view.location_type,
        segments.date,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros
      FROM location_view
      WHERE segments.date DURING LAST_30_DAYS
      ORDER BY metrics.impressions DESC
    `

    return await customer.report({
      entity: 'location_view',
      attributes: [
        'location_view.resource_name'
      ],
      metrics: [
        'metrics.impressions',
        'metrics.clicks',
        'metrics.cost_micros'
      ],
      segments: [
        'segments.date'
      ],
      constraints: [{
        key: 'segments.date',
        op: 'DURING',
        val: 'LAST_30_DAYS'
      }],
      order_by: 'metrics.impressions'
    })
  }

  public async getSearchTerms(connectedAccountId: number, userId: number) {
    const customer = await this.getCustomerClient(connectedAccountId, userId)

    const query = `
      SELECT 
        search_term_view.resource_name,
        search_term_view.search_term,
        search_term_view.status,
        ad_group.id,
        ad_group.name,
        campaign.id,
        campaign.name,
        segments.date,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions
      FROM search_term_view
      WHERE segments.date DURING LAST_7_DAYS
      ORDER BY metrics.impressions DESC
    `

    return await customer.report({
      entity: 'search_term_view',
      attributes: [
        'search_term_view.resource_name',
        'search_term_view.search_term',
        'search_term_view.status',
        'ad_group.id',
        'ad_group.name',
        'campaign.id',
        'campaign.name'
      ],
      metrics: [
        'metrics.impressions',
        'metrics.clicks',
        'metrics.cost_micros',
        'metrics.conversions'
      ],
      segments: [
        'segments.date'
      ],
      constraints: [{
        key: 'segments.date',
        op: 'DURING',
        val: 'LAST_7_DAYS'
      }],
      order_by: 'metrics.impressions'
    })
  }

  // Private helper methods
  private calculateDateRange(dateRange: any) {
    let startDate: string, endDate: string

    switch (dateRange.type) {
      case 'today':
        startDate = endDate = DateTime.now().toFormat('yyyy-MM-dd')
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
        startDate = dateRange.startDate!
        endDate = dateRange.endDate!
        break
      default:
        endDate = DateTime.now().toFormat('yyyy-MM-dd')
        startDate = DateTime.now().minus({ days: 30 }).toFormat('yyyy-MM-dd')
    }

    return { startDate, endDate }
  }

  private getIncrementalDateRange(connectedAccount: ConnectedAccount) {
    if (connectedAccount.lastSyncAt) {
      return {
        type: 'custom' as const,
        startDate: connectedAccount.lastSyncAt.toFormat('yyyy-MM-dd'),
        endDate: DateTime.now().toFormat('yyyy-MM-dd')
      }
    }
    return { type: 'last_30_days' as const }
  }

  private isCacheValid(cacheKey: string): boolean {
    const expiry = this.cacheExpiry.get(cacheKey)
    return expiry ? expiry > DateTime.now() : false
  }

  private categorizePerformance(ctr: number, cpc: number): string {
    if (ctr > 5 && cpc < 2) return 'Excellent'
    if (ctr > 2 && cpc < 5) return 'Good'
    if (ctr > 1 && cpc < 10) return 'Average'
    return 'Poor'
  }

  private categorizeCampaignType(campaignType: string | null): string {
    if (!campaignType) return 'Unknown'

    const type = campaignType.toLowerCase()
    if (['search', 'display', 'shopping', 'video', 'app'].includes(type)) {
      return type.charAt(0).toUpperCase() + type.slice(1)
    }
    return 'Other'
  }

  private calculateEfficiencyScore(ctr: number, cpc: number, conversions: number, clicks: number, spend: number): number {
    const conversionRate = clicks > 0 ? (conversions / clicks) * 100 : 0
    const roas = spend > 0 ? conversions / spend : 0

    const ctrScore = Math.min(100, ctr * 10)
    const cpcScore = Math.max(0, 100 - (cpc * 10))
    const conversionRateScore = Math.min(100, conversionRate * 100)
    const roasScore = Math.min(100, roas * 100)

    return Math.round((ctrScore * 0.1) + (cpcScore * 0.1) + (conversionRateScore * 0.4) + (roasScore * 0.4))
  }
}

export default new GoogleAdsService()