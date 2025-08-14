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
        throw new Error(`Failed to execute Google Ads API report: ${reportError.message || reportError.toString() || 'Unknown error'}`)
      }

      this.cache.set(cacheKey, results)
      this.cacheExpiry.set(cacheKey, DateTime.now().plus({ minutes: this.cacheTtl }))

      return results
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
      throw new Error(`Failed to fetch campaign data: ${error.message || error.toString() || 'Unknown error'}`)
    }
  }

  public async processAndStoreCampaignData(connectedAccountId: number, rawData: any[]) {
    const processedData: CampaignData[] = []
    const batchSize = 100

    for (let i = 0; i < rawData.length; i += batchSize) {
      const batch = rawData.slice(i, i + batchSize).map(row => ({
        connectedAccountId,
        campaignId: row.campaign?.id?.toString(),
        campaignName: row.campaign?.name,
        campaignType: row.campaign?.advertising_channel_type || null,
        campaignSubType: row.campaign?.advertising_channel_sub_type || null,
        date: row.segments?.date ? DateTime.fromFormat(row.segments.date, 'yyyy-MM-dd') : DateTime.now(),
        spend: row.metrics?.cost_micros ? parseFloat(row.metrics.cost_micros) / 1000000 : 0,
        impressions: row.metrics?.impressions ? parseInt(row.metrics.impressions) : 0,
        clicks: row.metrics?.clicks ? parseInt(row.metrics.clicks) : 0,
        conversions: row.metrics?.conversions ? parseFloat(row.metrics.conversions) : 0
      })).filter(data => data.campaignId && data.campaignName)

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

      const syncDateRange = dateRange || this.getIncrementalDateRange(connectedAccount)
      const rawData = await this.fetchCampaignData(connectedAccountId, userId, syncDateRange)
      const processedData = await this.processAndStoreCampaignData(connectedAccountId, rawData)

      connectedAccount.lastSyncAt = DateTime.now()
      await connectedAccount.save()

      return processedData
    } catch (error: any) {
      logger.error('Error syncing campaign data:', error)
      throw new Error(`Failed to sync campaign data: ${error.message}`)
    }
  }

  public async getEnrichedCampaignData(connectedAccountId: number, userId: number, dateRange?: any) {
    await this.syncCampaignData(connectedAccountId, userId, dateRange)

    let query = CampaignData.query().where('connected_account_id', connectedAccountId)

    if (dateRange) {
      const { startDate, endDate } = this.calculateDateRange(dateRange)
      query = query.whereBetween('date', [startDate, endDate])
    }

    const campaignData = await query.orderBy('date', 'desc')
    return campaignData.map(data => this.enrichCampaignData(data))
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