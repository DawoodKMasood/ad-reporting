import type { HttpContext } from '@adonisjs/core/http'

export default class DashboardController {
  /**
   * Display dashboard index page
   */
  async index({ view, auth }: HttpContext) {
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
    })
  }

  /**
   * Display dashboard overview
   */
  async overview({ view, auth }: HttpContext) {
    const user = auth.getUserOrFail()

    return view.render('pages/dashboard/overview', {
      user,
    })
  }
}
