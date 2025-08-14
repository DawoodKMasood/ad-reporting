import env from '#start/env'
import ConnectedAccount from '#models/connected_account'
import CampaignData from '#models/campaign_data'
import googleAdsOAuthService from './google_ads_oauth_service.js'
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'
import { GoogleAdsApi, services, enums, MutateOperationTypes, MutateOperation, reports } from 'google-ads-api'

export class GoogleAdsService {
  private cache: Map<string, any> = new Map()
  private cacheExpiry: Map<string, DateTime> = new Map()
  private cacheTtl: number = 10

  private async getCustomerClient(connectedAccountId: number, userId: number) {
    const connectedAccount = await ConnectedAccount.findOrFail(connectedAccountId)
    
    // Get the properly configured Google Ads client from the OAuth service
    const { client, refreshToken } = await googleAdsOAuthService.getGoogleAdsClient(connectedAccountId, userId)
    
    const config: any = {
      customer_id: connectedAccount.accountId,
      refresh_token: refreshToken,
    }

    const loginCustomerId = env.get('GOOGLE_ADS_LOGIN_CUSTOMER_ID')
    if (loginCustomerId && loginCustomerId !== connectedAccount.accountId) {
      config.login_customer_id = loginCustomerId
    }

    return client.Customer(config)
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
      const { startDate, endDate } = this.calculateDateRange(dateRange)
      const cacheKey = `campaign_data_${connectedAccountId}_${startDate}_${endDate}`
      
      if (this.isCacheValid(cacheKey)) {
        return this.cache.get(cacheKey)
      }

      const customer = await this.getCustomerClient(connectedAccountId, userId)
      
      const query = `
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

      const results = await customer.report({
        query,
        page_size: 1000
      })
      
      this.cache.set(cacheKey, results)
      this.cacheExpiry.set(cacheKey, DateTime.now().plus({ minutes: this.cacheTtl }))

      return results
    } catch (error: any) {
      logger.error('Error fetching campaign data:', error)
      throw new Error(`Failed to fetch campaign data: ${error.message}`)
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
      segments: ['segments.date'],
      date_constant: enums.ReportingDateRangeType.LAST_30_DAYS
    })
  }

  public async getAdGroups(connectedAccountId: number, userId: number, campaignId?: string) {
    const customer = await this.getCustomerClient(connectedAccountId, userId)
    
    const where = campaignId ? [`campaign.id = ${campaignId}`] : []
    
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
      where,
      date_constant: enums.ReportingDateRangeType.LAST_7_DAYS
    })
  }

  public async getKeywords(connectedAccountId: number, userId: number, adGroupId?: string) {
    const customer = await this.getCustomerClient(connectedAccountId, userId)
    
    const where = adGroupId ? [`ad_group.id = ${adGroupId}`] : []
    
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
        'metrics.quality_score'
      ],
      where,
      date_constant: enums.ReportingDateRangeType.LAST_7_DAYS
    })
  }

  public async getAds(connectedAccountId: number, userId: number, adGroupId?: string) {
    const customer = await this.getCustomerClient(connectedAccountId, userId)
    
    const where = adGroupId ? [`ad_group.id = ${adGroupId}`] : []
    
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
      where,
      date_constant: enums.ReportingDateRangeType.LAST_7_DAYS
    })
  }

  public async getConversionActions(connectedAccountId: number, userId: number) {
    const customer = await this.getCustomerClient(connectedAccountId, userId)
    
    return await customer.report({
      entity: 'conversion_action',
      attributes: [
        'conversion_action.id',
        'conversion_action.name',
        'conversion_action.type',
        'conversion_action.status',
        'conversion_action.category'
      ]
    })
  }

  public async getAudienceInsights(connectedAccountId: number, userId: number) {
    const customer = await this.getCustomerClient(connectedAccountId, userId)
    
    return await customer.report({
      entity: 'age_range_view',
      attributes: [
        'age_range_view.resource_name',
        'ad_group_criterion.age_range.type'
      ],
      metrics: [
        'metrics.impressions',
        'metrics.clicks',
        'metrics.cost_micros'
      ],
      date_constant: enums.ReportingDateRangeType.LAST_30_DAYS
    })
  }

  public async getGenderInsights(connectedAccountId: number, userId: number) {
    const customer = await this.getCustomerClient(connectedAccountId, userId)
    
    return await customer.report({
      entity: 'gender_view',
      attributes: [
        'gender_view.resource_name',
        'ad_group_criterion.gender.type'
      ],
      metrics: [
        'metrics.impressions',
        'metrics.clicks',
        'metrics.cost_micros'
      ],
      date_constant: enums.ReportingDateRangeType.LAST_30_DAYS
    })
  }

  public async getLocationInsights(connectedAccountId: number, userId: number) {
    const customer = await this.getCustomerClient(connectedAccountId, userId)
    
    return await customer.report({
      entity: 'location_view',
      attributes: [
        'location_view.resource_name',
        'location_view.location_type'
      ],
      metrics: [
        'metrics.impressions',
        'metrics.clicks',
        'metrics.cost_micros'
      ],
      date_constant: enums.ReportingDateRangeType.LAST_30_DAYS
    })
  }

  public async getSearchTerms(connectedAccountId: number, userId: number) {
    const customer = await this.getCustomerClient(connectedAccountId, userId)
    
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
      date_constant: enums.ReportingDateRangeType.LAST_7_DAYS
    })
  }

  public async createCampaign(connectedAccountId: number, userId: number, campaignData: {
    name: string,
    budgetMicros: number,
    advertisingChannelType: keyof typeof enums.AdvertisingChannelType,
    biddingStrategy?: 'MAXIMIZE_CLICKS' | 'MAXIMIZE_CONVERSIONS' | 'TARGET_CPA'
  }) {
    const customer = await this.getCustomerClient(connectedAccountId, userId)
    
    // First create a budget
    const budgetOperation: MutateOperation<'campaign_budget'> = {
      entity: 'campaign_budget',
      operation: 'create',
      resource: {
        name: `Budget for ${campaignData.name}`,
        amount_micros: campaignData.budgetMicros,
        delivery_method: enums.BudgetDeliveryMethod.STANDARD
      }
    }
    
    const budgetResult = await customer.mutateResources([budgetOperation])
    const budgetResourceName = budgetResult.mutate_operation_responses[0].campaign_budget_result.resource_name
    
    // Create the campaign
    const campaignOperation: MutateOperation<'campaign'> = {
      entity: 'campaign',
      operation: 'create',
      resource: {
        name: campaignData.name,
        campaign_budget: budgetResourceName,
        advertising_channel_type: enums.AdvertisingChannelType[campaignData.advertisingChannelType],
        status: enums.CampaignStatus.PAUSED, // Start paused for safety
        start_date: DateTime.now().toFormat('yyyy-MM-dd'),
        // Set bidding strategy
        ...(campaignData.biddingStrategy === 'MAXIMIZE_CLICKS' && {
          maximize_clicks: {}
        }),
        ...(campaignData.biddingStrategy === 'MAXIMIZE_CONVERSIONS' && {
          maximize_conversions: {}
        }),
        ...(campaignData.biddingStrategy === 'TARGET_CPA' && {
          target_cpa: {
            target_cpa_micros: 5000000 // $5 default
          }
        })
      }
    }
    
    return await customer.mutateResources([campaignOperation])
  }

  public async updateCampaignStatus(connectedAccountId: number, userId: number, campaignId: string, status: keyof typeof enums.CampaignStatus) {
    const customer = await this.getCustomerClient(connectedAccountId, userId)
    
    const operation: MutateOperation<'campaign'> = {
      entity: 'campaign',
      operation: 'update',
      resource: {
        resource_name: `customers/${(await ConnectedAccount.findOrFail(connectedAccountId)).accountId}/campaigns/${campaignId}`,
        status: enums.CampaignStatus[status]
      },
      update_mask: {
        paths: ['status']
      }
    }
    
    return await customer.mutateResources([operation])
  }

  public async createAdGroup(connectedAccountId: number, userId: number, campaignId: string, adGroupData: {
    name: string,
    cpcBidMicros?: number
  }) {
    const customer = await this.getCustomerClient(connectedAccountId, userId)
    const customerId = (await ConnectedAccount.findOrFail(connectedAccountId)).accountId
    
    const operation: MutateOperation<'ad_group'> = {
      entity: 'ad_group',
      operation: 'create',
      resource: {
        name: adGroupData.name,
        campaign: `customers/${customerId}/campaigns/${campaignId}`,
        status: enums.AdGroupStatus.PAUSED,
        type: enums.AdGroupType.SEARCH_STANDARD,
        ...(adGroupData.cpcBidMicros && {
          cpc_bid_micros: adGroupData.cpcBidMicros
        })
      }
    }
    
    return await customer.mutateResources([operation])
  }

  public async addKeywords(connectedAccountId: number, userId: number, adGroupId: string, keywords: Array<{
    text: string,
    matchType: keyof typeof enums.KeywordMatchType,
    cpcBidMicros?: number
  }>) {
    const customer = await this.getCustomerClient(connectedAccountId, userId)
    const customerId = (await ConnectedAccount.findOrFail(connectedAccountId)).accountId
    
    const operations: MutateOperation<'ad_group_criterion'>[] = keywords.map(keyword => ({
      entity: 'ad_group_criterion',
      operation: 'create',
      resource: {
        ad_group: `customers/${customerId}/adGroups/${adGroupId}`,
        status: enums.AdGroupCriterionStatus.ENABLED,
        keyword: {
          text: keyword.text,
          match_type: enums.KeywordMatchType[keyword.matchType]
        },
        ...(keyword.cpcBidMicros && {
          cpc_bid_micros: keyword.cpcBidMicros
        })
      }
    }))
    
    return await customer.mutateResources(operations)
  }

  public async createTextAd(connectedAccountId: number, userId: number, adGroupId: string, adData: {
    headline1: string,
    headline2: string,
    description: string,
    finalUrls: string[]
  }) {
    const customer = await this.getCustomerClient(connectedAccountId, userId)
    const customerId = (await ConnectedAccount.findOrFail(connectedAccountId)).accountId
    
    const operation: MutateOperation<'ad_group_ad'> = {
      entity: 'ad_group_ad',
      operation: 'create',
      resource: {
        ad_group: `customers/${customerId}/adGroups/${adGroupId}`,
        status: enums.AdGroupAdStatus.PAUSED,
        ad: {
          expanded_text_ad: {
            headline_part1: adData.headline1,
            headline_part2: adData.headline2,
            description: adData.description
          },
          final_urls: adData.finalUrls
        }
      }
    }
    
    return await customer.mutateResources([operation])
  }

  public async getBiddingStrategies(connectedAccountId: number, userId: number) {
    const customer = await this.getCustomerClient(connectedAccountId, userId)
    
    return await customer.report({
      entity: 'bidding_strategy',
      attributes: [
        'bidding_strategy.id',
        'bidding_strategy.name',
        'bidding_strategy.type',
        'bidding_strategy.status'
      ]
    })
  }

  public async getAccountHierarchy(connectedAccountId: number, userId: number) {
    const customer = await this.getCustomerClient(connectedAccountId, userId)
    
    return await customer.report({
      entity: 'customer_client',
      attributes: [
        'customer_client.client_customer',
        'customer_client.level',
        'customer_client.time_zone',
        'customer_client.test_account',
        'customer_client.manager',
        'customer_client.descriptive_name'
      ]
    })
  }

  public async getExtensions(connectedAccountId: number, userId: number) {
    const customer = await this.getCustomerClient(connectedAccountId, userId)
    
    return await customer.report({
      entity: 'extension_feed_item',
      attributes: [
        'extension_feed_item.id',
        'extension_feed_item.extension_type',
        'extension_feed_item.status',
        'extension_feed_item.sitelink_feed_item.link_text',
        'extension_feed_item.sitelink_feed_item.line1',
        'extension_feed_item.sitelink_feed_item.line2'
      ]
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
