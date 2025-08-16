import type { HttpContext } from '@adonisjs/core/http'
import ConnectedAccount from '#models/connected_account'
import CampaignData from '#models/campaign_data'
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'

interface ChartData {
  labels: string[]
  datasets: Array<{
    label: string
    data: number[]
    backgroundColor?: string | string[]
    borderColor?: string
    borderWidth?: number
    fill?: boolean
  }>
}

interface ReportMetric {
  name: string
  value: number
  change: number
  changeType: 'increase' | 'decrease' | 'neutral'
  format: 'currency' | 'number' | 'percentage'
}

interface PlatformReport {
  platform: string
  displayName: string
  totalSpend: number
  totalImpressions: number
  totalClicks: number
  totalConversions: number
  campaignCount: number
  ctr: number
  cpc: number
  conversionRate: number
}

export default class ReportsController {
  /**
   * Format number with appropriate formatting
   */
  private formatNumber(num: number, format: 'currency' | 'number' | 'percentage' = 'number'): string {
    switch (format) {
      case 'currency':
        return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(num)
      case 'percentage':
        return new Intl.NumberFormat('en-US', {
          style: 'percent',
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(num / 100)
      default:
        return num.toLocaleString('en-US', {
          minimumFractionDigits: 0,
          maximumFractionDigits: 2,
        })
    }
  }

  /**
   * Calculate percentage change between two values
   */
  private calculateChange(current: number, previous: number): number {
    if (previous === 0) return current > 0 ? 100 : 0
    return ((current - previous) / previous) * 100
  }

  /**
   * Get platform display name
   */
  private getPlatformDisplayName(platform: string): string {
    const platformNames: { [key: string]: string } = {
      google_ads: 'Google Ads',
      meta_ads: 'Meta Ads',
      facebook_ads: 'Facebook Ads',
      instagram_ads: 'Instagram Ads',
      tiktok_ads: 'TikTok Ads',
      linkedin_ads: 'LinkedIn Ads',
      twitter_ads: 'Twitter Ads',
    }
    return platformNames[platform] || platform.charAt(0).toUpperCase() + platform.slice(1)
  }

  /**
   * Display main reports dashboard
   */
  async index({ view, auth, request }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const qs = request.qs()
      
      // Get date range from query params or default to last 30 days
      const endDate = qs.end_date ? DateTime.fromISO(qs.end_date) : DateTime.now()
      const startDate = qs.start_date ? DateTime.fromISO(qs.start_date) : endDate.minus({ days: 30 })
      const platform = qs.platform || 'all'

      // Fetch connected accounts
      const connectedAccounts = await ConnectedAccount.query()
        .where('user_id', user.id)

      if (connectedAccounts.length === 0) {
        return view.render('pages/reports/index', {
          user,
          connectedAccounts: [],
          hasData: false,
          metrics: [],
          chartData: null,
          platformReports: [],
          selectedDateRange: { start: startDate.toISODate(), end: endDate.toISODate() },
          selectedPlatform: platform,
        })
      }

      // Get account IDs and filter by platform if specified
      let accountIds = connectedAccounts.map(account => account.id)
      if (platform !== 'all') {
        const filteredAccounts = connectedAccounts.filter(account => account.platform === platform)
        accountIds = filteredAccounts.map(account => account.id)
      }

      // Fetch campaign data for the selected date range
      const campaignData = await CampaignData.query()
        .whereIn('connected_account_id', accountIds)
        .whereBetween('date', [startDate.toJSDate(), endDate.toJSDate()])
        .preload('connectedAccount')
        .orderBy('date', 'asc')

      // Calculate current period metrics
      const currentMetrics = campaignData.reduce((acc, data) => {
        acc.totalSpend += data.spend
        acc.totalImpressions += data.impressions
        acc.totalClicks += data.clicks
        acc.totalConversions += data.conversions
        return acc
      }, { totalSpend: 0, totalImpressions: 0, totalClicks: 0, totalConversions: 0 })

      // Calculate previous period for comparison
      const periodDiff = endDate.diff(startDate, 'days').days
      const prevEndDate = startDate.minus({ days: 1 })
      const prevStartDate = prevEndDate.minus({ days: periodDiff })

      const prevCampaignData = await CampaignData.query()
        .whereIn('connected_account_id', accountIds)
        .whereBetween('date', [prevStartDate.toJSDate(), prevEndDate.toJSDate()])

      const prevMetrics = prevCampaignData.reduce((acc, data) => {
        acc.totalSpend += data.spend
        acc.totalImpressions += data.impressions
        acc.totalClicks += data.clicks
        acc.totalConversions += data.conversions
        return acc
      }, { totalSpend: 0, totalImpressions: 0, totalClicks: 0, totalConversions: 0 })

      // Calculate derived metrics
      const currentCTR = currentMetrics.totalImpressions > 0 ? (currentMetrics.totalClicks / currentMetrics.totalImpressions) * 100 : 0
      const currentCPC = currentMetrics.totalClicks > 0 ? currentMetrics.totalSpend / currentMetrics.totalClicks : 0
      const currentConversionRate = currentMetrics.totalClicks > 0 ? (currentMetrics.totalConversions / currentMetrics.totalClicks) * 100 : 0

      const prevCTR = prevMetrics.totalImpressions > 0 ? (prevMetrics.totalClicks / prevMetrics.totalImpressions) * 100 : 0
      const prevCPC = prevMetrics.totalClicks > 0 ? prevMetrics.totalSpend / prevMetrics.totalClicks : 0
      const prevConversionRate = prevMetrics.totalClicks > 0 ? (prevMetrics.totalConversions / prevMetrics.totalClicks) * 100 : 0

      // Create metrics array for display
      const metrics: ReportMetric[] = [
        {
          name: 'Total Spend',
          value: currentMetrics.totalSpend,
          change: this.calculateChange(currentMetrics.totalSpend, prevMetrics.totalSpend),
          changeType: currentMetrics.totalSpend >= prevMetrics.totalSpend ? 'increase' : 'decrease',
          format: 'currency'
        },
        {
          name: 'Impressions',
          value: currentMetrics.totalImpressions,
          change: this.calculateChange(currentMetrics.totalImpressions, prevMetrics.totalImpressions),
          changeType: currentMetrics.totalImpressions >= prevMetrics.totalImpressions ? 'increase' : 'decrease',
          format: 'number'
        },
        {
          name: 'Clicks',
          value: currentMetrics.totalClicks,
          change: this.calculateChange(currentMetrics.totalClicks, prevMetrics.totalClicks),
          changeType: currentMetrics.totalClicks >= prevMetrics.totalClicks ? 'increase' : 'decrease',
          format: 'number'
        },
        {
          name: 'Conversions',
          value: currentMetrics.totalConversions,
          change: this.calculateChange(currentMetrics.totalConversions, prevMetrics.totalConversions),
          changeType: currentMetrics.totalConversions >= prevMetrics.totalConversions ? 'increase' : 'decrease',
          format: 'number'
        },
        {
          name: 'CTR',
          value: currentCTR,
          change: this.calculateChange(currentCTR, prevCTR),
          changeType: currentCTR >= prevCTR ? 'increase' : 'decrease',
          format: 'percentage'
        },
        {
          name: 'CPC',
          value: currentCPC,
          change: this.calculateChange(currentCPC, prevCPC),
          changeType: currentCPC <= prevCPC ? 'increase' : 'decrease', // Lower CPC is better
          format: 'currency'
        },
        {
          name: 'Conversion Rate',
          value: currentConversionRate,
          change: this.calculateChange(currentConversionRate, prevConversionRate),
          changeType: currentConversionRate >= prevConversionRate ? 'increase' : 'decrease',
          format: 'percentage'
        }
      ]

      // Prepare chart data for performance over time
      const dailyData: { [key: string]: any } = {}
      campaignData.forEach(data => {
        const dateStr = data.date.toISOString().split('T')[0]
        if (!dailyData[dateStr]) {
          dailyData[dateStr] = { spend: 0, clicks: 0, impressions: 0, conversions: 0 }
        }
        dailyData[dateStr].spend += data.spend
        dailyData[dateStr].clicks += data.clicks
        dailyData[dateStr].impressions += data.impressions
        dailyData[dateStr].conversions += data.conversions
      })

      const sortedDates = Object.keys(dailyData).sort()
      const chartData: ChartData = {
        labels: sortedDates.map(date => DateTime.fromISO(date).toFormat('MMM dd')),
        datasets: [
          {
            label: 'Spend',
            data: sortedDates.map(date => dailyData[date].spend),
            borderColor: 'rgb(59, 130, 246)',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            borderWidth: 2,
            fill: true
          },
          {
            label: 'Clicks',
            data: sortedDates.map(date => dailyData[date].clicks),
            borderColor: 'rgb(16, 185, 129)',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            borderWidth: 2,
            fill: false
          }
        ]
      }

      // Generate platform-specific reports
      const platformData: { [key: string]: any } = {}
      campaignData.forEach(data => {
        const platform = data.connectedAccount.platform
        if (!platformData[platform]) {
          platformData[platform] = {
            platform,
            totalSpend: 0,
            totalImpressions: 0,
            totalClicks: 0,
            totalConversions: 0,
            campaignCount: new Set()
          }
        }
        platformData[platform].totalSpend += data.spend
        platformData[platform].totalImpressions += data.impressions
        platformData[platform].totalClicks += data.clicks
        platformData[platform].totalConversions += data.conversions
        platformData[platform].campaignCount.add(data.campaignId)
      })

      const platformReports: PlatformReport[] = Object.values(platformData).map((data: any) => ({
        platform: data.platform,
        displayName: this.getPlatformDisplayName(data.platform),
        totalSpend: data.totalSpend,
        totalImpressions: data.totalImpressions,
        totalClicks: data.totalClicks,
        totalConversions: data.totalConversions,
        campaignCount: data.campaignCount.size,
        ctr: data.totalImpressions > 0 ? (data.totalClicks / data.totalImpressions) * 100 : 0,
        cpc: data.totalClicks > 0 ? data.totalSpend / data.totalClicks : 0,
        conversionRate: data.totalClicks > 0 ? (data.totalConversions / data.totalClicks) * 100 : 0,
      }))

      return view.render('pages/reports/index', {
        user,
        connectedAccounts,
        hasData: campaignData.length > 0,
        metrics,
        chartData: JSON.stringify(chartData),
        platformReports,
        selectedDateRange: { start: startDate.toISODate(), end: endDate.toISODate() },
        selectedPlatform: platform,
        formatNumber: this.formatNumber.bind(this),
      })

    } catch (error) {
      logger.error('Error fetching reports data:', error)
      const user = auth.getUserOrFail()
      return view.render('pages/reports/index', {
        user,
        connectedAccounts: [],
        hasData: false,
        metrics: [],
        chartData: null,
        platformReports: [],
        selectedDateRange: { start: DateTime.now().minus({ days: 30 }).toISODate(), end: DateTime.now().toISODate() },
        selectedPlatform: 'all',
        error: 'Failed to load reports data',
        formatNumber: this.formatNumber.bind(this),
      })
    }
  }

  /**
   * Display performance report
   */
  async performance({ view, auth, request }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const qs = request.qs()
      
      const endDate = qs.end_date ? DateTime.fromISO(qs.end_date) : DateTime.now()
      const startDate = qs.start_date ? DateTime.fromISO(qs.start_date) : endDate.minus({ days: 30 })
      const platform = qs.platform || 'all'

      // Similar logic to index but focused on performance metrics
      const connectedAccounts = await ConnectedAccount.query()
        .where('user_id', user.id)

      return view.render('pages/reports/performance', {
        user,
        connectedAccounts,
        selectedDateRange: { start: startDate.toISODate(), end: endDate.toISODate() },
        selectedPlatform: platform,
      })

    } catch (error) {
      logger.error('Error fetching performance reports:', error)
      const user = auth.getUserOrFail()
      return view.render('pages/reports/performance', {
        user,
        connectedAccounts: [],
        selectedDateRange: { start: DateTime.now().minus({ days: 30 }).toISODate(), end: DateTime.now().toISODate() },
        selectedPlatform: 'all',
        error: 'Failed to load performance data',
      })
    }
  }

  /**
   * Display custom reports
   */
  async custom({ view, auth }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      
      const connectedAccounts = await ConnectedAccount.query()
        .where('user_id', user.id)

      return view.render('pages/reports/custom', {
        user,
        connectedAccounts,
      })

    } catch (error) {
      logger.error('Error fetching custom reports:', error)
      const user = auth.getUserOrFail()
      return view.render('pages/reports/custom', {
        user,
        connectedAccounts: [],
        error: 'Failed to load custom reports',
      })
    }
  }
}
