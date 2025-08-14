import { GoogleAdsApi, CustomerOptions, enums } from 'google-ads-api'
import env from '#start/env'
import ConnectedAccount from '#models/connected_account'
import CampaignData from '#models/campaign_data'
import googleAdsOAuthService from './google_ads_oauth_service.js'
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'

export class GoogleAdsService {
  private googleAdsClient: GoogleAdsApi
  private cache: Map<string, any> = new Map()
  private cacheExpiry: Map<string, DateTime> = new Map()
  private cacheTtl: number = 10

  constructor() {
    this.googleAdsClient = new GoogleAdsApi({
      client_id: env.get('GOOGLE_ADS_CLIENT_ID'),
      client_secret: env.get('GOOGLE_ADS_CLIENT_SECRET'),
      developer_token: env.get('GOOGLE_ADS_DEVELOPER_TOKEN'),
    })
  }

  private async getCustomerClient(connectedAccountId: number, userId: number) {
    const connectedAccount = await ConnectedAccount.findOrFail(connectedAccountId)
    const tokens = await googleAdsOAuthService.retrieveTokens(connectedAccountId, userId)
    
    const config: CustomerOptions = {
      customer_id: connectedAccount.accountId,
      refresh_token: tokens.refreshToken!
    }

    const loginCustomerId = env.get('GOOGLE_ADS_LOGIN_CUSTOMER_ID')
    if (loginCustomerId && loginCustomerId !== connectedAccount.accountId) {
      config.login_customer_id = loginCustomerId
    }

    return this.googleAdsClient.Customer(config)
  }

  public async getAccessibleCustomers(connectedAccountId: number, userId: number) {
    try {
      const customer = await this.getCustomerClient(connectedAccountId, userId)
      const result = await customer.listAccessibleCustomers()
      return result.resourceNames || []
    } catch (error: any) {
      logger.error('Error fetching accessible customers:', error)
      throw new Error(`Failed to fetch accessible customers: ${error.message}`)
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
