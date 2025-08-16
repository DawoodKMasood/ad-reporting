import type { HttpContext } from '@adonisjs/core/http'
import ConnectedAccount from '#models/connected_account'
import CustomReport from '#models/custom_report'
import logger from '@adonisjs/core/services/logger'
import {
  createCustomReportValidator,
  updateCustomReportValidator,
  saveLayoutValidator,
  previewReportValidator
} from '#validators/custom_report'

export default class ReportsController {
  /**
   * Display main reports dashboard with custom reports
   */
  async index({ view, auth }: HttpContext) {
    try {
      const user = auth.getUserOrFail()

      // Fetch connected accounts
      const connectedAccounts = await ConnectedAccount.query()
        .where('user_id', user.id)
        .where('is_active', true)

      // Fetch custom reports for this user
      const customReports = await CustomReport.query()
        .where('user_id', user.id)
        .where('status', 'active')
        .preload('connectedAccount')
        .orderBy('updated_at', 'desc')

      return view.render('pages/reports/index', {
        user,
        connectedAccounts,
        customReports,
      })

    } catch (error) {
      logger.error('Error fetching reports data:', error)
      const user = auth.getUserOrFail()
      return view.render('pages/reports/index', {
        user,
        connectedAccounts: [],
        customReports: [],
        error: 'Failed to load reports data',
      })
    }
  }

  /**
   * Display custom reports page
   */
  async custom({ view, auth }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      
      const connectedAccounts = await ConnectedAccount.query()
        .where('user_id', user.id)
        .where('is_active', true)

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

  /**
   * Store a new custom report
   */
  async store({ request, auth, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const data = await request.validateUsing(createCustomReportValidator)

      // Verify the connected account belongs to the user
      const connectedAccount = await ConnectedAccount.query()
        .where('id', data.connectedAccountId)
        .where('user_id', user.id)
        .where('is_active', true)
        .firstOrFail()

      const customReport = await CustomReport.create({
        userId: user.id,
        connectedAccountId: data.connectedAccountId,
        name: data.name,
        description: data.description,
        platform: data.platform || connectedAccount.platform,
        filters: data.filters,
        metrics: data.metrics || ['impressions', 'clicks', 'cost'],
        dimensions: data.dimensions,
        dateRangeType: data.dateRangeType || 'last_30_days',
        startDate: data.startDate,
        endDate: data.endDate,
        isScheduled: data.isScheduled || false,
        scheduleFrequency: data.scheduleFrequency,
        widgetLayout: data.widgetLayout,
        status: 'active'
      })

      if (data.ajax) {
        return response.json({ success: true, report: customReport })
      }

      return response.redirect().toRoute('reports.index')
    } catch (error) {
      logger.error('Error creating custom report:', error)
      if (request.input('ajax')) {
        return response.status(400).json({ success: false, error: error.message || 'Failed to save report' })
      }
      return response.redirect().back()
    }
  }

  /**
   * Show a specific custom report
   */
  async show({ params, view, auth }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      
      const customReport = await CustomReport.query()
        .where('id', params.id)
        .where('user_id', user.id)
        .preload('connectedAccount')
        .firstOrFail()

      return view.render('pages/reports/show', {
        user,
        customReport,
      })

    } catch (error) {
      logger.error('Error fetching custom report:', error)
      const user = auth.getUserOrFail()
      return view.render('pages/reports/show', {
        user,
        customReport: null,
        error: 'Failed to load custom report',
      })
    }
  }

  /**
   * Update a custom report
   */
  async update({ params, request, auth, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const data = await request.validateUsing(updateCustomReportValidator)

      const customReport = await CustomReport.query()
        .where('id', params.id)
        .where('user_id', user.id)
        .firstOrFail()

      // If connectedAccountId is being updated, verify it belongs to the user
      if (data.connectedAccountId) {
        await ConnectedAccount.query()
          .where('id', data.connectedAccountId)
          .where('user_id', user.id)
          .where('is_active', true)
          .firstOrFail()
      }

      await customReport.merge(data).save()

      if (data.ajax) {
        return response.json({ success: true, report: customReport })
      }

      return response.redirect().toRoute('reports.index')
    } catch (error) {
      logger.error('Error updating custom report:', error)
      if (request.input('ajax')) {
        return response.status(400).json({ success: false, error: error.message || 'Failed to update report' })
      }
      return response.redirect().back()
    }
  }

  /**
   * Delete a custom report
   */
  async destroy({ params, auth, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      
      const customReport = await CustomReport.query()
        .where('id', params.id)
        .where('user_id', user.id)
        .firstOrFail()

      await customReport.delete()

      return response.redirect().toRoute('reports.index')
    } catch (error) {
      logger.error('Error deleting custom report:', error)
      return response.redirect().back()
    }
  }

  /**
   * Archive a custom report
   */
  async archive({ params, auth, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      
      const customReport = await CustomReport.query()
        .where('id', params.id)
        .where('user_id', user.id)
        .firstOrFail()

      customReport.status = 'archived'
      await customReport.save()

      return response.redirect().toRoute('reports.index')
    } catch (error) {
      logger.error('Error archiving custom report:', error)
      return response.redirect().back()
    }
  }

  /**
   * Save widget layout for a custom report
   */
  async saveLayout({ request, auth, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const data = await request.validateUsing(saveLayoutValidator)

      if (data.reportId) {
        // Update existing report
        const customReport = await CustomReport.query()
          .where('id', data.reportId)
          .where('user_id', user.id)
          .firstOrFail()

        // If connectedAccountId is provided, verify it belongs to the user
        if (data.connectedAccountId) {
          await ConnectedAccount.query()
            .where('id', data.connectedAccountId)
            .where('user_id', user.id)
            .where('is_active', true)
            .firstOrFail()
          
          customReport.connectedAccountId = data.connectedAccountId
        }

        await customReport.merge({ widgetLayout: data.widgetLayout }).save()
        return response.json({ success: true, report: customReport })
      } else {
        // Create new report - connectedAccountId is required for new reports
        if (!data.connectedAccountId) {
          return response.status(400).json({ 
            success: false, 
            error: 'Connected account is required for new reports' 
          })
        }

        // Verify the connected account belongs to the user
        const connectedAccount = await ConnectedAccount.query()
          .where('id', data.connectedAccountId)
          .where('user_id', user.id)
          .where('is_active', true)
          .firstOrFail()

        const customReport = await CustomReport.create({
          userId: user.id,
          connectedAccountId: data.connectedAccountId,
          name: data.name || `Custom Report ${new Date().toISOString().split('T')[0]}`,
          description: data.description || '',
          platform: data.platform || connectedAccount.platform,
          metrics: ['impressions', 'clicks', 'cost'], // Default metrics
          dateRangeType: 'last_30_days',
          status: 'active',
          widgetLayout: data.widgetLayout
        })

        return response.json({ success: true, report: customReport })
      }
    } catch (error) {
      logger.error('Error saving widget layout:', error)
      return response.status(400).json({ success: false, error: error.message || 'Failed to save layout' })
    }
  }

  /**
   * Load widget layout for a custom report
   */
  async loadLayout({ params, auth, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      
      const customReport = await CustomReport.query()
        .where('id', params.id)
        .where('user_id', user.id)
        .firstOrFail()

      return response.json({ success: true, layout: customReport.widgetLayout })
    } catch (error) {
      logger.error('Error loading widget layout:', error)
      return response.status(500).json({ success: false, error: 'Failed to load layout' })
    }
  }

  /**
   * Preview a custom report with widget layout
   */
  async preview({ request, auth, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const data = await request.validateUsing(previewReportValidator)

      // If connectedAccountId is provided, verify it belongs to the user
      if (data.connectedAccountId) {
        await ConnectedAccount.query()
          .where('id', data.connectedAccountId)
          .where('user_id', user.id)
          .where('is_active', true)
          .firstOrFail()
      }

      // If reportId is provided, get actual data, otherwise use sample data
      let reportData = null
      if (data.reportId) {
        const customReport = await CustomReport.query()
          .where('id', data.reportId)
          .where('user_id', user.id)
          .preload('connectedAccount')
          .firstOrFail()
        reportData = customReport
      }

      return response.json({ 
        success: true, 
        layout: data.widgetLayout,
        reportData: reportData,
        sampleData: this.getSampleData()
      })
    } catch (error) {
      logger.error('Error generating preview:', error)
      return response.status(400).json({ success: false, error: error.message || 'Failed to generate preview' })
    }
  }

  /**
   * Get sample data for preview
   */
  private getSampleData() {
    return {
      metrics: {
        spend: 2450.50,
        impressions: 145680,
        clicks: 4720,
        conversions: 142,
        ctr: 3.24,
        cpc: 0.52,
        cpa: 17.26
      },
      chartData: {
        line: {
          labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
          datasets: [{
            label: 'Spend',
            data: [1200, 1350, 1100, 1800, 1650, 2100],
            borderColor: '#3B82F6',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            tension: 0.4
          }]
        },
        bar: {
          labels: ['Google Ads', 'Meta Ads', 'LinkedIn Ads'],
          datasets: [{
            label: 'Spend',
            data: [1500, 800, 150],
            backgroundColor: ['#3B82F6', '#10B981', '#8B5CF6']
          }]
        },
        pie: {
          labels: ['Google Ads', 'Meta Ads', 'LinkedIn Ads'],
          datasets: [{
            data: [60, 32, 8],
            backgroundColor: ['#3B82F6', '#10B981', '#8B5CF6']
          }]
        }
      },
      tableData: {
        campaigns: [
          { name: 'Brand Campaign', spend: 1250, clicks: 2100, ctr: '3.2%' },
          { name: 'Product Campaign', spend: 890, clicks: 1580, ctr: '2.8%' },
          { name: 'Retargeting Campaign', spend: 310, clicks: 1040, ctr: '4.1%' }
        ],
        platforms: [
          { platform: 'Google Ads', spend: 1500, impressions: 85000, clicks: 2800 },
          { platform: 'Meta Ads', spend: 800, impressions: 45000, clicks: 1620 },
          { platform: 'LinkedIn Ads', spend: 150, impressions: 15680, clicks: 300 }
        ]
      }
    }
  }
}