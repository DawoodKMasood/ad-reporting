import { GoogleAdsApi, services, enums, MutateOperationTypes, MutateOperation, reports } from 'google-ads-api'
import env from '#start/env'
import ConnectedAccount from '#models/connected_account'
import googleAdsOAuthService from './google_ads_oauth_service.js'
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'

export class GoogleAdsEnhancedService {
  private googleAdsClient: GoogleAdsApi

  constructor() {
    this.googleAdsClient = new GoogleAdsApi({
      client_id: env.get('GOOGLE_ADS_CLIENT_ID'),
      client_secret: env.get('GOOGLE_ADS_CLIENT_SECRET'),
      developer_token: env.get('GOOGLE_ADS_DEVELOPER_TOKEN'),
    })
  }

  private async getCustomer(connectedAccountId: number, userId: number) {
    const connectedAccount = await ConnectedAccount.findOrFail(connectedAccountId)
    const tokens = await googleAdsOAuthService.retrieveTokens(connectedAccountId, userId)
    
    return this.googleAdsClient.Customer({
      customer_id: connectedAccount.accountId,
      refresh_token: tokens.refreshToken!,
      login_customer_id: env.get('GOOGLE_ADS_LOGIN_CUSTOMER_ID') !== connectedAccount.accountId 
        ? env.get('GOOGLE_ADS_LOGIN_CUSTOMER_ID') 
        : undefined
    })
  }

  public async getCampaigns(connectedAccountId: number, userId: number) {
    const customer = await this.getCustomer(connectedAccountId, userId)
    
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
    const customer = await this.getCustomer(connectedAccountId, userId)
    
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
    const customer = await this.getCustomer(connectedAccountId, userId)
    
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
    const customer = await this.getCustomer(connectedAccountId, userId)
    
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
    const customer = await this.getCustomer(connectedAccountId, userId)
    
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
    const customer = await this.getCustomer(connectedAccountId, userId)
    
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
    const customer = await this.getCustomer(connectedAccountId, userId)
    
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
    const customer = await this.getCustomer(connectedAccountId, userId)
    
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
    const customer = await this.getCustomer(connectedAccountId, userId)
    
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
    const customer = await this.getCustomer(connectedAccountId, userId)
    
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
    const customer = await this.getCustomer(connectedAccountId, userId)
    
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
    const customer = await this.getCustomer(connectedAccountId, userId)
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
    const customer = await this.getCustomer(connectedAccountId, userId)
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
    const customer = await this.getCustomer(connectedAccountId, userId)
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
    const customer = await this.getCustomer(connectedAccountId, userId)
    
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
    const customer = await this.getCustomer(connectedAccountId, userId)
    
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
    const customer = await this.getCustomer(connectedAccountId, userId)
    
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
}

export default new GoogleAdsEnhancedService()
