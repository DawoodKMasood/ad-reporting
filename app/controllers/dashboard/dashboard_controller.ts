import type { HttpContext } from '@adonisjs/core/http'
import ConnectedAccount from '#models/connected_account'
import CampaignData from '#models/campaign_data'
import logger from '@adonisjs/core/services/logger'
import type { DateTime } from 'luxon'

interface Stats {
  totalSpend: number
  totalImpressions: number
  totalClicks: number
  totalConversions: number
}

interface PerformanceData {
  date: string
  spend: number
  impressions: number
  clicks: number
  conversions: number
}

interface PlatformMetric {
  platform: string
  totalSpend: number
  totalImpressions: number
  totalClicks: number
  totalConversions: number
  campaignCount: number
}

interface PlatformMetrics {
  [key: string]: PlatformMetric
}

export default class DashboardController {
  /**
   * Format number with commas for thousands separator
   */
  private formatNumber(num: number): string {
    return num.toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })
  }
  /**
   * Display dashboard index page
   */
  async index({ view, auth }: HttpContext) {
    try {
      const user = auth.getUserOrFail()

      // Fetch the user's connected ad accounts
      const connectedAccounts = await ConnectedAccount.query()
        .where('user_id', user.id)
        .orderBy('created_at', 'desc')

      // Initialize summary metrics
      let stats: Stats = {
        totalSpend: 0,
        totalImpressions: 0,
        totalClicks: 0,
        totalConversions: 0,
      }

      // If user has connected accounts, retrieve campaign performance data
      if (connectedAccounts.length > 0) {
        // Get all connected account IDs
        const accountIds = connectedAccounts.map((account) => account.id)

        // Retrieve recent campaign performance data for connected accounts
        const campaignData = await CampaignData.query()
          .whereIn('connected_account_id', accountIds)
          .orderBy('date', 'desc')
          .limit(100) // Limit to recent data to avoid performance issues

        // Calculate summary metrics
        stats = campaignData.reduce(
          (acc, data) => {
            acc.totalSpend += data.spend
            acc.totalImpressions += data.impressions
            acc.totalClicks += data.clicks
            acc.totalConversions += data.conversions
            return acc
          },
          {
            totalSpend: 0,
            totalImpressions: 0,
            totalClicks: 0,
            totalConversions: 0,
          }
        )
      }

      return view.render('pages/dashboard/index', {
        user,
        stats,
        connectedAccounts,
        formatNumber: this.formatNumber.bind(this),
      })
    } catch (error) {
      logger.error('Error fetching dashboard data:', error)
      
      // Return fallback data in case of error
      const user = auth.getUserOrFail()
      return view.render('pages/dashboard/index', {
        user,
        stats: {
          totalSpend: 0,
          totalImpressions: 0,
          totalClicks: 0,
          totalConversions: 0,
        },
        connectedAccounts: [],
        error: 'Failed to load dashboard data',
        formatNumber: this.formatNumber.bind(this),
      })
    }
  }

  /**
   * Display dashboard overview
   */
  async overview({ view, auth }: HttpContext) {
    try {
      const user = auth.getUserOrFail()

      // Fetch the user's connected ad accounts
      const connectedAccounts = await ConnectedAccount.query()
        .where('user_id', user.id)
        .orderBy('created_at', 'desc')

      // Initialize data structures
      let campaignPerformance: CampaignData[] = []
      let platformMetrics: PlatformMetrics = {}
      let performanceData: PerformanceData[] = []

      // If user has connected accounts, retrieve detailed campaign performance data
      if (connectedAccounts.length > 0) {
        // Get all connected account IDs
        const accountIds = connectedAccounts.map((account) => account.id)

        // Retrieve detailed campaign performance data
        campaignPerformance = await CampaignData.query()
          .whereIn('connected_account_id', accountIds)
          .preload('connectedAccount')
          .orderBy('date', 'desc')
          .limit(200) // Limit to recent data to avoid performance issues

        // Group performance data by date for charts
        const performanceByDate: { [key: string]: PerformanceData } = {}
        campaignPerformance.forEach((data) => {
          const dateStr = data.date.toISODate()
          if (dateStr && !performanceByDate[dateStr]) {
            performanceByDate[dateStr] = {
              date: dateStr,
              spend: 0,
              impressions: 0,
              clicks: 0,
              conversions: 0,
            }
          }
          if (dateStr) {
            performanceByDate[dateStr].spend += data.spend
            performanceByDate[dateStr].impressions += data.impressions
            performanceByDate[dateStr].clicks += data.clicks
            performanceByDate[dateStr].conversions += data.conversions
          }
        })

        // Convert to array and sort by date
        performanceData = Object.values(performanceByDate).sort((a, b) =>
          a.date.localeCompare(b.date)
        )

        // Calculate platform-specific metrics
        platformMetrics = {}
        campaignPerformance.forEach((data) => {
          const platform = data.connectedAccount.platform
          if (!platformMetrics[platform]) {
            platformMetrics[platform] = {
              platform,
              totalSpend: 0,
              totalImpressions: 0,
              totalClicks: 0,
              totalConversions: 0,
              campaignCount: 0,
            }
          }
          platformMetrics[platform].totalSpend += data.spend
          platformMetrics[platform].totalImpressions += data.impressions
          platformMetrics[platform].totalClicks += data.clicks
          platformMetrics[platform].totalConversions += data.conversions
          platformMetrics[platform].campaignCount += 1
        })
      }

      return view.render('pages/dashboard/overview', {
        user,
        connectedAccounts,
        campaignPerformance,
        platformMetrics,
        performanceData,
        formatNumber: this.formatNumber.bind(this),
      })
    } catch (error) {
      logger.error('Error fetching overview data:', error)
      
      // Return fallback data in case of error
      const user = auth.getUserOrFail()
      return view.render('pages/dashboard/overview', {
        user,
        connectedAccounts: [],
        campaignPerformance: [],
        platformMetrics: {},
        performanceData: [],
        error: 'Failed to load overview data',
        formatNumber: this.formatNumber.bind(this),
      })
    }
  }
}
