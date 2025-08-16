import type { HttpContext } from '@adonisjs/core/http'
import ConnectedAccount from '#models/connected_account'
import CustomReport from '#models/custom_report'
import logger from '@adonisjs/core/services/logger'

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
      const data = request.only([
        'name',
        'description',
        'connected_account_id',
        'platform',
        'filters',
        'metrics',
        'dimensions',
        'date_range_type',
        'start_date',
        'end_date',
        'is_scheduled',
        'schedule_frequency'
      ])

      const customReport = await CustomReport.create({
        userId: user.id,
        ...data
      })

      return response.redirect().toRoute('reports.index')
    } catch (error) {
      logger.error('Error creating custom report:', error)
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
      const data = request.only([
        'name',
        'description',
        'filters',
        'metrics',
        'dimensions',
        'date_range_type',
        'start_date',
        'end_date',
        'is_scheduled',
        'schedule_frequency'
      ])

      const customReport = await CustomReport.query()
        .where('id', params.id)
        .where('user_id', user.id)
        .firstOrFail()

      await customReport.merge(data).save()

      return response.redirect().toRoute('reports.index')
    } catch (error) {
      logger.error('Error updating custom report:', error)
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
}
